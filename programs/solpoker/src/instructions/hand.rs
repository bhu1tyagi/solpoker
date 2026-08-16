//! Starting hands, dealing, and moving between streets. All of this runs on the ER.
//!
//! Every poker rule comes from `poker-engine`: these instructions load the
//! accounts into the engine, ask it what happens, and write the answer back.
//!
//! Cards are dealt straight off the shuffled deck with no burn cards. Burning is
//! traditional but protects against nothing here, the shuffle is committed to a
//! published seed, and skipping it keeps the deal exactly reproducible by the
//! Phase 5 verifier.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;
use poker_engine::betting::Betting;

use crate::bridge::*;
use crate::errors::PokerError;
use crate::state::*;
use crate::{seats_mut, seats_ref};

/// Create one seat's hole-card PDA on the base layer. Idempotent.
pub fn create_hole(ctx: Context<CreateHole>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    let table_key = ctx.accounts.table.key();
    let hole = &mut ctx.accounts.hole;
    if hole.table == table_key {
        return Ok(());
    }
    hole.table = table_key;
    hole.seat_index = seat_index;
    hole.hand_number = 0;
    hole.cards = [NO_CARD; 2];
    hole.bump = ctx.bumps.hole;

    // Pre-fund for a one-member permission: the seat's occupant.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.hole.to_account_info(),
            },
        ),
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
    )?;
    Ok(())
}

/// Shuffle, post blinds, and open preflop betting.
///
/// The seed is `VRF XOR salts`, combined here inside the enclave: the VRF half
/// lives on the private deck where nobody can read it, and the salts are
/// public. It stays on the deck until settlement, which copies it to the hand
/// so anyone can recompute the deal afterwards. Until then a readable seed
/// would be the whole deck.
pub fn start_hand(ctx: Context<StartHand>) -> Result<()> {
    require!(
        ctx.accounts.table.state == TableState::Waiting,
        PokerError::HandInProgress
    );
    // Fulfillment is invisible from outside on purpose, so callers simply try
    // this until it stops being refused.
    require!(
        ctx.accounts.deck.shuffle_state == crate::instructions::shuffle::SHUFFLE_FULFILLED,
        PokerError::ShuffleNotReady
    );
    let mut shuffle_seed = ctx.accounts.deck.vrf_randomness;
    for (i, b) in ctx.accounts.hand.salt_xor.iter().enumerate() {
        shuffle_seed[i] ^= b;
    }
    ctx.accounts.deck.shuffle_seed = shuffle_seed;

    let table_key = ctx.accounts.table.key();
    {
        let seats = seats_ref!(ctx.accounts);
        check_seat_order(&seats, &table_key)?;
    }

    // Nothing may be dealt until the deck is actually hidden. It holds the VRF
    // output while the salts are public, so starting a hand against a deck that
    // is still world-readable publishes the whole deal, for every player at
    // once. The client has always locked it down first; this is what stops the
    // hand when it does not, and what stops anyone else calling this
    // permissionless instruction before it gets the chance.
    //
    // This flag is safe to gate on because it can never be stuck false. The
    // deck's permission has no members by design, and `secure_deck` sets this
    // the first time it runs, which is also the only time the permission does
    // not yet exist. False therefore always means "creatable", never "locked".
    //
    // The same is emphatically **not** true per seat, which is why there is no
    // matching `seat.cards_secured` check here. A hole-card permission names
    // exactly one member, and updating it means loading the account, which the
    // enclave refuses to anyone who is not already that member. Secure a seat
    // while it is empty and the member list is empty, so when someone sits down
    // nobody on earth can point the permission at them: not the new occupant,
    // not the crank, not the table creator. Gating the deal on that flag turned
    // a seat changing hands into a table that could not start a hand, could not
    // undelegate because the deck held randomness, and so could not be deleted
    // either. It cost a table on devnet before it was understood.
    //
    // The residual risk is real and smaller: a seat whose permission still names
    // a previous occupant lets that one player read the current occupant's hole
    // cards. Closing it needs a way to update a permission you are locked out
    // of, which is a MagicBlock question, not something this program can fix by
    // refusing to deal. See STATUS.md.
    require!(ctx.accounts.deck.secured, PokerError::CardsNotSecured);

    // Only seated players with chips are dealt in.
    let mut stacks = [0u64; MAX_SEATS];
    let mut dealt_in: u8 = 0;
    {
        let seats = seats_ref!(ctx.accounts);
        for (i, seat) in seats.iter().enumerate() {
            if seat.is_occupied() && seat.stack > 0 {
                stacks[i] = seat.stack;
                dealt_in |= 1 << i;
            }
        }
    }
    require!(dealt_in.count_ones() >= 2, PokerError::NotEnoughPlayers);

    // Move the button to the next seat that is actually in this hand.
    let mut button = ctx.accounts.table.button as usize;
    for _ in 0..MAX_SEATS {
        button = (button + 1) % MAX_SEATS;
        if dealt_in & (1 << button) != 0 {
            break;
        }
    }

    // Shuffle deterministically from the seed. Same seed, same deck, anywhere.
    let deck = &mut ctx.accounts.deck;
    let mut cards = [0u8; 52];
    for (i, c) in cards.iter_mut().enumerate() {
        *c = i as u8;
    }
    poker_engine::card::shuffle_in_place(&mut cards, &shuffle_seed);
    deck.cards = cards;
    deck.next_index = 0;

    // The engine posts blinds and works out who acts first.
    let betting = Betting::begin_hand(
        stacks,
        button,
        ctx.accounts.config.small_blind,
        ctx.accounts.config.big_blind,
    )
    .map_err(|_| error!(PokerError::NotEnoughPlayers))?;

    let hand_number = ctx.accounts.table.hand_number + 1;
    {
        let hand = &mut ctx.accounts.hand;
        hand.hand_number = hand_number;
        hand.board = [NO_CARD; 5];
        hand.dealt_in = dealt_in;
        hand.revealed = [[NO_CARD; 2]; MAX_SEATS];
        hand.revealed_mask = 0;
        hand.deadline = Clock::get()?.unix_timestamp + ctx.accounts.config.action_timeout_secs;
    }
    {
        let mut seats = seats_mut!(ctx.accounts);
        store_betting(&betting, &mut ctx.accounts.hand, &mut seats);
    }

    let table = &mut ctx.accounts.table;
    table.hand_number = hand_number;
    table.button = button as u8;
    table.state = TableState::HandInProgress;

    msg!(
        "hand {} started: {} players, button seat {}, to act {}",
        hand_number,
        dealt_in.count_ones(),
        button,
        ctx.accounts.hand.to_act
    );
    Ok(())
}

/// Deal two cards to every seat in the hand.
///
/// Takes only the hole-card accounts, not the seats, using `Hand::dealt_in` to
/// know who is in. Loading all six seats here as well would push the account
/// context over the BPF stack frame limit.
pub fn deal_hole_cards(ctx: Context<DealHoleCards>) -> Result<()> {
    let hand_number = ctx.accounts.hand.hand_number;
    let dealt_in = ctx.accounts.hand.dealt_in;
    let table_key = ctx.accounts.hand.table;
    require!(hand_number > 0, PokerError::NoHandInProgress);

    let deck = &mut ctx.accounts.deck;
    let mut holes = [
        &mut ctx.accounts.hole_0,
        &mut ctx.accounts.hole_1,
        &mut ctx.accounts.hole_2,
        &mut ctx.accounts.hole_3,
        &mut ctx.accounts.hole_4,
        &mut ctx.accounts.hole_5,
    ];

    for (i, hole) in holes.iter_mut().enumerate() {
        require_keys_eq!(hole.table, table_key, PokerError::SeatTableMismatch);
        require!(hole.seat_index as usize == i, PokerError::SeatOrderMismatch);

        // Already dealt for this hand: leave it alone so a retry is harmless.
        if hole.hand_number == hand_number {
            continue;
        }
        hole.hand_number = hand_number;
        if dealt_in & (1 << i) == 0 {
            hole.cards = [NO_CARD; 2];
            continue;
        }
        let a = deck.deal().ok_or(PokerError::DeckExhausted)?;
        let b = deck.deal().ok_or(PokerError::DeckExhausted)?;
        hole.cards = [a, b];
    }

    msg!("dealt hole cards for hand {}", hand_number);
    Ok(())
}

/// Close the current street and deal the next board cards.
///
/// Permissionless: anyone may call it once betting is complete, so a stalled
/// client cannot hold up the table.
pub fn advance_street(ctx: Context<AdvanceStreet>) -> Result<()> {
    let table_key = ctx.accounts.hand.table;
    // See check_config: this instruction sets the next turn deadline, so an
    // unchecked config hands the caller the clock.
    check_config(&ctx.accounts.config, &table_key)?;

    let mut betting = {
        let seats = seats_ref!(ctx.accounts);
        check_seat_order(&seats, &table_key)?;
        load_betting(&ctx.accounts.hand, &seats, &ctx.accounts.config)
    };

    require!(betting.street_is_complete(), PokerError::StreetNotComplete);
    require!(
        betting.street != poker_engine::betting::Street::Showdown,
        PokerError::StreetComplete
    );

    betting.advance_street();

    // Fill the board up to whatever the new street shows.
    let needed = betting.street.board_len();
    {
        let deck = &mut ctx.accounts.deck;
        let hand = &mut ctx.accounts.hand;
        for slot in 0..needed {
            if hand.board[slot] == NO_CARD {
                hand.board[slot] = deck.deal().ok_or(PokerError::DeckExhausted)?;
            }
        }
    }

    {
        let mut seats = seats_mut!(ctx.accounts);
        store_betting(&betting, &mut ctx.accounts.hand, &mut seats);
    }
    ctx.accounts.hand.deadline = Clock::get()?.unix_timestamp + ctx.accounts.config.action_timeout_secs;

    msg!(
        "street -> {}, to act {}",
        ctx.accounts.hand.street,
        ctx.accounts.hand.to_act
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct CreateHole<'info> {
    #[account(
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + HoleCards::INIT_SPACE,
        seeds = [HOLE_SEED, table.key().as_ref(), &[seat_index]],
        bump
    )]
    pub hole: Account<'info, HoleCards>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartHand<'info> {
    // Boxed onto the heap: with six seat accounts already in this context, the
    // 192-byte seat map inside Table pushes Anchor's generated account
    // resolution past the 4KB BPF stack frame.
    #[account(mut)]
    pub table: Box<Account<'info, Table>>,
    #[account(address = table.config)]
    pub config: Box<Account<'info, TableConfig>>,
    #[account(mut, seeds = [HAND_SEED, table.key().as_ref()], bump = hand.bump)]
    pub hand: Box<Account<'info, Hand>>,
    #[account(mut, seeds = [DECK_SEED, table.key().as_ref()], bump = deck.bump)]
    pub deck: Box<Account<'info, Deck>>,
    #[account(mut)]
    pub seat_0: Account<'info, Seat>,
    #[account(mut)]
    pub seat_1: Account<'info, Seat>,
    #[account(mut)]
    pub seat_2: Account<'info, Seat>,
    #[account(mut)]
    pub seat_3: Account<'info, Seat>,
    #[account(mut)]
    pub seat_4: Account<'info, Seat>,
    #[account(mut)]
    pub seat_5: Account<'info, Seat>,
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct DealHoleCards<'info> {
    #[account(mut)]
    pub hand: Account<'info, Hand>,
    #[account(mut, seeds = [DECK_SEED, hand.table.as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,
    #[account(mut)]
    pub hole_0: Account<'info, HoleCards>,
    #[account(mut)]
    pub hole_1: Account<'info, HoleCards>,
    #[account(mut)]
    pub hole_2: Account<'info, HoleCards>,
    #[account(mut)]
    pub hole_3: Account<'info, HoleCards>,
    #[account(mut)]
    pub hole_4: Account<'info, HoleCards>,
    #[account(mut)]
    pub hole_5: Account<'info, HoleCards>,
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdvanceStreet<'info> {
    // Boxed: Hand plus six seats does not fit the 4KB BPF stack frame.
    #[account(mut)]
    pub hand: Box<Account<'info, Hand>>,
    pub config: Box<Account<'info, TableConfig>>,
    #[account(mut, seeds = [DECK_SEED, hand.table.as_ref()], bump = deck.bump)]
    pub deck: Box<Account<'info, Deck>>,
    #[account(mut)]
    pub seat_0: Account<'info, Seat>,
    #[account(mut)]
    pub seat_1: Account<'info, Seat>,
    #[account(mut)]
    pub seat_2: Account<'info, Seat>,
    #[account(mut)]
    pub seat_3: Account<'info, Seat>,
    #[account(mut)]
    pub seat_4: Account<'info, Seat>,
    #[account(mut)]
    pub seat_5: Account<'info, Seat>,
    pub payer: Signer<'info>,
}
