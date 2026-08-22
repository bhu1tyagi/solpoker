//! Table creation and seat management.
//!
//! # Where chips are allowed to move
//!
//! Chip custody changes happen **only on the base layer, only while the table is
//! undelegated**. `join_table` moves chips from [`Player::chips`] into a seat
//! stack; `leave_table` moves them back. Both refuse to run once the table's PDAs
//! are delegated.
//!
//! That restriction is not incidental. [`Player`] is never delegated, so a single
//! instruction cannot write both a player's balance and a delegated seat, they
//! live on different layers. Forcing custody transitions through the base layer
//! gives a clean invariant: while a hand runs on the ER, chips may move *between*
//! seats but the total at the table cannot change, and player balances are
//! untouchable from inside the rollup.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;

use crate::errors::PokerError;
use crate::state::*;

pub fn create_table(
    ctx: Context<CreateTable>,
    table_id: u64,
    small_blind: u64,
    big_blind: u64,
    min_buy_in: u64,
    max_buy_in: u64,
    action_timeout_secs: i64,
) -> Result<()> {
    require!(big_blind > 0 && small_blind > 0, PokerError::IllegalAction);
    require!(small_blind <= big_blind, PokerError::IllegalAction);
    require!(
        min_buy_in >= big_blind && max_buy_in >= min_buy_in,
        PokerError::BuyInOutOfRange
    );

    let config = &mut ctx.accounts.config;
    config.table_id = table_id;
    config.creator = ctx.accounts.creator.key();
    config.small_blind = small_blind;
    config.big_blind = big_blind;
    config.min_buy_in = min_buy_in;
    config.max_buy_in = max_buy_in;
    config.max_seats = MAX_SEATS as u8;
    // A turn clock is a weapon if it is short enough. `force_timeout` is
    // permissionless and folds whoever owes chips, so a creator who set a
    // one-second clock on their own table could raise and then time every
    // opponent out before a human could answer, hand after hand, and cash the
    // proceeds out for SOL. `check_config` cannot catch that: the config really
    // does belong to the table. Only a bound does.
    require!(
        (MIN_ACTION_TIMEOUT_SECS..=MAX_ACTION_TIMEOUT_SECS).contains(&action_timeout_secs),
        PokerError::TimeoutOutOfRange
    );
    config.action_timeout_secs = action_timeout_secs;
    config.bump = ctx.bumps.config;

    let table = &mut ctx.accounts.table;
    table.table_id = table_id;
    table.config = config.key();
    table.seats = [Table::EMPTY_SEAT; MAX_SEATS];
    table.button = 0;
    table.hand_number = 0;
    table.state = TableState::Waiting;
    table.bump = ctx.bumps.table;
    table.empty_since = Clock::get()?.unix_timestamp;
    table.rake_accrued = 0;

    let hand = &mut ctx.accounts.hand;
    hand.table = table.key();
    hand.hand_number = 0;
    hand.street = 0;
    hand.board = [NO_CARD; 5];
    hand.current_bet = 0;
    hand.min_raise = 0;
    hand.to_act = NO_SEAT;
    hand.button = 0;
    hand.last_aggressor = NO_SEAT;
    hand.deadline = 0;
    hand.result_hash = [0u8; 32];
    hand.shuffle_seed = [0u8; 32];
    hand.revealed = [[NO_CARD; 2]; MAX_SEATS];
    hand.revealed_mask = 0;
    hand.bump = ctx.bumps.hand;

    let deck = &mut ctx.accounts.deck;
    deck.table = table.key();
    deck.cards = [NO_CARD; 52];
    deck.next_index = 0;
    deck.vrf_randomness = [0u8; 32];
    deck.shuffle_seed = [0u8; 32];
    // Every field undelegation checks must leave `init` in its cleared state,
    // not Anchor's zero-fill. `board` clears to NO_CARD, and a deck born with
    // it zeroed fails `assert_deck_publishable` until a first hand settles —
    // so a table delegated and then abandoned before ever dealing could not be
    // pulled back to the base layer, and its seats' chips were stuck with it.
    // Found on the first mainnet table, which wedged exactly that way.
    deck.hole_randomness = [0u8; 32];
    deck.board = [NO_CARD; 5];
    deck.fulfilled_mask = 0;
    deck.shuffle_state = 0;
    deck.bump = ctx.bumps.deck;

    // Pre-fund the deck for the ephemeral permission it will create on the
    // rollup. A delegated PDA cannot be topped up later, so this is the only
    // chance. The deck's permission has no members, hence size_of(0).
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.deck.to_account_info(),
            },
        ),
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(0) as u32),
    )?;

    msg!(
        "table {} created: blinds {}/{}, buy-in {}..{}",
        table_id,
        small_blind,
        big_blind,
        min_buy_in,
        max_buy_in
    );
    Ok(())
}

/// Create one seat PDA for a table.
///
/// Split out from [`create_table`] because initialising all six seats alongside
/// the table, hand, and deck overflowed the 4KB BPF stack frame in Anchor's
/// generated `try_accounts` (4120 bytes against a 4096 limit), which surfaces at
/// runtime as a null-pointer access violation rather than a clean error.
///
/// Seats are created once and reused for the table's lifetime, so a seat address
/// is stable and never needs re-delegating as players come and go. Permissionless
/// and idempotent, so a client can safely retry.
pub fn create_seat(ctx: Context<CreateSeat>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );

    let table_key = ctx.accounts.table.key();
    let seat = &mut ctx.accounts.seat;

    // Already set up: leave it alone rather than wiping an occupied seat.
    if seat.table == table_key {
        return Ok(());
    }

    seat.table = table_key;
    seat.seat_index = seat_index;
    seat.occupant = Table::EMPTY_SEAT;
    seat.stack = 0;
    seat.reset_for_new_hand(false);
    seat.last_action_slot = 0;
    seat.bump = ctx.bumps.seat;
    Ok(())
}

/// Take a seat, moving `buy_in` chips from the player's balance to the seat stack.
pub fn join_table(ctx: Context<JoinTable>, seat_index: u8, buy_in: u64) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    // Custody moves only on the base layer. No explicit check is needed: while
    // the table is delegated its base-layer owner is the delegation program, so
    // Anchor's owner check on `Account<Table>` rejects this instruction outright.
    // On the ER the instruction fails too, because `Player` is never delegated
    // and so cannot be written there.

    let config = &ctx.accounts.config;
    require!(
        buy_in >= config.min_buy_in && buy_in <= config.max_buy_in,
        PokerError::BuyInOutOfRange
    );

    let authority = ctx.accounts.authority.key();
    require!(
        ctx.accounts.table.seat_of(&authority).is_none(),
        PokerError::AlreadySeated
    );
    require!(
        ctx.accounts.table.is_empty_seat(seat_index as usize),
        PokerError::SeatOccupied
    );

    let player = &mut ctx.accounts.player;
    require!(player.chips >= buy_in, PokerError::InsufficientChips);

    // The only place chips leave a player balance.
    player.chips -= buy_in;

    let seat = &mut ctx.accounts.seat;
    seat.occupant = authority;
    seat.stack = buy_in;
    seat.reset_for_new_hand(false);
    seat.last_action_slot = 0;

    ctx.accounts.table.seats[seat_index as usize] = authority;
    ctx.accounts.table.empty_since = 0;

    msg!(
        "player {} took seat {} with {} chips ({} left in balance)",
        authority,
        seat_index,
        buy_in,
        player.chips
    );
    Ok(())
}

/// Leave the table, returning the whole seat stack to the player's balance.
pub fn leave_table(ctx: Context<LeaveTable>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    // See join_table: delegation state is enforced by account ownership.
    require!(
        ctx.accounts.table.state == TableState::Waiting,
        PokerError::HandInProgress
    );

    let authority = ctx.accounts.authority.key();
    let seat = &mut ctx.accounts.seat;
    require_keys_eq!(seat.occupant, authority, PokerError::NotSeated);

    let returned = seat.stack;
    let player = &mut ctx.accounts.player;
    player.chips = player
        .chips
        .checked_add(returned)
        .ok_or(PokerError::InsufficientChips)?;

    seat.occupant = Table::EMPTY_SEAT;
    seat.stack = 0;
    seat.reset_for_new_hand(false);

    ctx.accounts.table.seats[seat_index as usize] = Table::EMPTY_SEAT;
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.table.touch_vacancy(now);

    msg!(
        "player {} left seat {} with {} chips (balance now {})",
        authority,
        seat_index,
        returned,
        player.chips
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + TableConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, &table_id.to_le_bytes()],
        bump
    )]
    pub config: Account<'info, TableConfig>,
    #[account(
        init,
        payer = creator,
        space = 8 + Table::INIT_SPACE,
        seeds = [TABLE_SEED, &table_id.to_le_bytes()],
        bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = creator,
        space = 8 + Hand::INIT_SPACE,
        seeds = [HAND_SEED, table.key().as_ref()],
        bump
    )]
    pub hand: Account<'info, Hand>,
    #[account(
        init,
        payer = creator,
        space = 8 + Deck::INIT_SPACE,
        seeds = [DECK_SEED, table.key().as_ref()],
        bump
    )]
    pub deck: Account<'info, Deck>,

    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct CreateSeat<'info> {
    #[account(
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Seat::INIT_SPACE,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump
    )]
    pub seat: Account<'info, Seat>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Anchor resolves accounts in declaration order, so `table` must come before any
// account whose seeds reference `table.table_id`.
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct JoinTable<'info> {
    #[account(
        mut,
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        seeds = [CONFIG_SEED, &table.table_id.to_le_bytes()],
        bump = config.bump
    )]
    pub config: Account<'info, TableConfig>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = seat.bump,
        constraint = seat.table == table.key() @ PokerError::SeatTableMismatch
    )]
    pub seat: Account<'info, Seat>,
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump,
        has_one = authority
    )]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct LeaveTable<'info> {
    #[account(
        mut,
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = seat.bump,
        constraint = seat.table == table.key() @ PokerError::SeatTableMismatch
    )]
    pub seat: Account<'info, Seat>,
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump,
        has_one = authority
    )]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}

/// Send a seated player home, with their chips.
///
/// The creator can clear a seat at any time between hands. Anyone else can
/// too, once the table has been game-stale for an hour: tables get abandoned
/// with players still seated, creators lose keys, and without this those
/// seats and the chips on them would be stuck forever. Staleness is judged by
/// the hand's action deadline, which every hand keeps fresh while anyone is
/// actually playing.
///
/// Whoever calls it, the chips go to the seat occupant's own balance and
/// nowhere else, so this can move a player out of a chair but can never take
/// anything from them.
///
/// The table is read and written raw rather than deserialized, so seats on
/// tables from older builds can still be cleared. Recovering people's chips is
/// the one job that must not break when a layout changes.
pub fn vacate_seat(ctx: Context<VacateSeat>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );

    let table_info = &ctx.accounts.table;
    require_keys_eq!(*table_info.owner, crate::ID, PokerError::SeatTableMismatch);

    let now = Clock::get()?.unix_timestamp;
    let (config_key, stored_creator) = {
        let data = table_info.try_borrow_data()?;
        require!(data.len() >= 250, PokerError::SeatOrderMismatch);

        let table_id = u64::from_le_bytes(
            data[8..16].try_into().map_err(|_| error!(PokerError::SeatOrderMismatch))?,
        );
        let (expected, _) =
            Pubkey::find_program_address(&[TABLE_SEED, &table_id.to_le_bytes()], &crate::ID);
        require_keys_eq!(table_info.key(), expected, PokerError::SeatOrderMismatch);

        // Between hands only. Byte 249 is the state and has never moved.
        require!(data[249] == 0, PokerError::HandInProgress);

        let config_key = Pubkey::try_from(&data[16..48])
            .map_err(|_| error!(PokerError::SeatOrderMismatch))?;
        require_keys_eq!(*ctx.accounts.config.key, config_key, PokerError::SeatTableMismatch);
        require_keys_eq!(*ctx.accounts.config.owner, crate::ID, PokerError::SeatTableMismatch);
        let cfg = ctx.accounts.config.try_borrow_data()?;
        require!(cfg.len() >= 48, PokerError::SeatOrderMismatch);
        let stored_creator = Pubkey::try_from(&cfg[16..48])
            .map_err(|_| error!(PokerError::SeatOrderMismatch))?;

        // The table's seat map must agree with the seat account being cleared.
        let at = 48 + (seat_index as usize) * 32;
        let mapped = Pubkey::try_from(&data[at..at + 32])
            .map_err(|_| error!(PokerError::SeatOrderMismatch))?;
        require_keys_eq!(mapped, ctx.accounts.seat.occupant, PokerError::SeatTableMismatch);

        (config_key, stored_creator)
    };
    let _ = config_key;

    if ctx.accounts.payer.key() != stored_creator {
        // Not the creator, so the table must have been dead for a while. The
        // deadline is refreshed by every action of every hand, so an hour past
        // it with the table idle means nobody is coming back for now.
        let hand = &ctx.accounts.hand;
        require!(
            hand.hand_number > 0 && now - hand.deadline > ABANDONED_AFTER_SECS,
            PokerError::TableNotAbandoned
        );
    }

    let seat = &mut ctx.accounts.seat;
    require!(seat.is_occupied(), PokerError::SeatEmpty);
    // The balance being credited must belong to whoever is in the seat.
    require_keys_eq!(
        ctx.accounts.player.authority,
        seat.occupant,
        PokerError::NotSeated
    );

    let returned = seat
        .stack
        .checked_add(seat.committed_total)
        .ok_or(PokerError::InsufficientChips)?;
    let player = &mut ctx.accounts.player;
    player.chips = player
        .chips
        .checked_add(returned)
        .ok_or(PokerError::InsufficientChips)?;

    seat.occupant = Table::EMPTY_SEAT;
    seat.stack = 0;
    seat.reset_for_new_hand(false);

    // Clear the slot in the raw seat map and keep the vacancy clock honest.
    {
        let mut data = table_info.try_borrow_mut_data()?;
        let at = 48 + (seat_index as usize) * 32;
        data[at..at + 32].fill(0);
        let vacant = (0..MAX_SEATS).all(|i| {
            let a = 48 + i * 32;
            data[a..a + 32].iter().all(|b| *b == 0)
        });
        if data.len() >= 259 {
            let stamp: i64 = if vacant { now } else { 0 };
            data[251..259].copy_from_slice(&stamp.to_le_bytes());
        }
    }

    msg!("seat {} vacated, {} chips returned", seat_index, returned);
    Ok(())
}

// `assert_creator` used to live here. It was dead: both `vacate_seat` and
// `close_table` read the creator out of the config themselves, raw, because
// each needs slightly different surrounding state. A security helper that
// nothing calls is worse than no helper, because it reads like a control that
// is in force somewhere.

/// Delete a table, refunding its rent to whoever paid for it.
///
/// Every seat must be empty, so no chips can be destroyed here: what is left is
/// the empty scaffolding of a table nobody is at. Use [`vacate_seat`] to send
/// anyone still sitting home with their chips first.
///
/// The creator can delete their own table whenever it is empty. Anyone else
/// has to wait an hour. Solana has no timers, so "abandoned tables clean
/// themselves up" really means any client may sweep one once it has sat empty
/// that long, and the lobby does exactly that in the background. Without it an
/// abandoned table would sit there forever, because creators lose keys and
/// nobody else could ever remove it. Sweeping earns nothing: the rent goes back
/// to the creator either way.
///
/// The table is read raw rather than deserialized, like everything else here.
/// The one job of a delete path is to clear away old things, so it must not be
/// the thing that stops working when a layout changes.
pub fn close_table(ctx: Context<CloseTable>) -> Result<()> {
    let table_info = &ctx.accounts.table;
    require_keys_eq!(*table_info.owner, crate::ID, PokerError::SeatTableMismatch);

    let (table_id, config_key, occupied, empty_since, rake_accrued) = {
        let data = table_info.try_borrow_data()?;
        // 8 discriminator, 8 table_id, 32 config, 6 x 32 seats, then the rest.
        require!(data.len() >= 240, PokerError::SeatOrderMismatch);
        let table_id = u64::from_le_bytes(
            data[8..16].try_into().map_err(|_| error!(PokerError::SeatOrderMismatch))?,
        );
        let config_key = Pubkey::try_from(&data[16..48])
            .map_err(|_| error!(PokerError::SeatOrderMismatch))?;
        let occupied = (0..MAX_SEATS)
            .any(|i| data[48 + i * 32..80 + i * 32].iter().any(|b| *b != 0));
        // Appended after bump at offset 251, so older tables simply stop
        // before it and read as never-empty.
        let empty_since = if data.len() >= 259 {
            i64::from_le_bytes(
                data[251..259].try_into().map_err(|_| error!(PokerError::SeatOrderMismatch))?,
            )
        } else {
            0
        };
        // Rake sits at 259, appended after `empty_since`. A table written by a
        // build that predates the rake stops before it and reads as zero, which
        // is the truth for those tables.
        let rake = if data.len() >= 267 {
            u64::from_le_bytes(
                data[259..267].try_into().map_err(|_| error!(PokerError::SeatOrderMismatch))?,
            )
        } else {
            0
        };
        (table_id, config_key, occupied, empty_since, rake)
    };

    let (expected_table, _) =
        Pubkey::find_program_address(&[TABLE_SEED, &table_id.to_le_bytes()], &crate::ID);
    require_keys_eq!(table_info.key(), expected_table, PokerError::SeatOrderMismatch);
    require!(!occupied, PokerError::TableNotEmpty);
    // Deleting the table would destroy chips that belong to the house, and
    // chips are backed by real lamports in the vault, so this would quietly
    // break the one-to-one backing. `sweep_rake` is permissionless, so
    // whoever wants the table gone can always clear this first.
    require!(rake_accrued == 0, PokerError::UnclaimedChips);

    // Rent always returns to whoever paid it, whoever asked for the delete.
    require_keys_eq!(*ctx.accounts.config.key, config_key, PokerError::SeatTableMismatch);
    require_keys_eq!(*ctx.accounts.config.owner, crate::ID, PokerError::SeatTableMismatch);
    let stored_creator = {
        let data = ctx.accounts.config.try_borrow_data()?;
        require!(data.len() >= 48, PokerError::SeatOrderMismatch);
        Pubkey::try_from(&data[16..48]).map_err(|_| error!(PokerError::SeatOrderMismatch))?
    };
    require_keys_eq!(
        ctx.accounts.creator.key(),
        stored_creator,
        PokerError::NotTableCreator
    );

    if ctx.accounts.payer.key() != stored_creator {
        let now = Clock::get()?.unix_timestamp;
        // Two ways a table counts as abandoned: it has sat empty for an hour,
        // or its last game action was over an hour ago. The second matters
        // because seats can be cleared by anyone once the game is stale, and
        // the husk left behind should not need its own extra hour.
        let empty_long_enough = empty_since != 0 && now - empty_since >= ABANDONED_AFTER_SECS;
        let game_stale = {
            let hand = ctx.accounts.hand.try_borrow_data()?;
            if hand.len() >= 82 {
                let hand_number = u64::from_le_bytes(
                    hand[40..48].try_into().map_err(|_| error!(PokerError::SeatOrderMismatch))?,
                );
                let deadline = i64::from_le_bytes(
                    hand[74..82].try_into().map_err(|_| error!(PokerError::SeatOrderMismatch))?,
                );
                hand_number > 0 && now - deadline > ABANDONED_AFTER_SECS
            } else {
                false
            }
        };
        require!(
            empty_long_enough || game_stale,
            PokerError::TableNotAbandoned
        );
    }

    let table_key = table_info.key();
    require!(
        ctx.remaining_accounts.len() == MAX_SEATS * 2,
        PokerError::SeatOrderMismatch
    );

    for i in 0..MAX_SEATS {
        let seat_info = &ctx.remaining_accounts[i];
        let (expected, _) =
            Pubkey::find_program_address(&[SEAT_SEED, table_key.as_ref(), &[i as u8]], &crate::ID);
        require_keys_eq!(seat_info.key(), expected, PokerError::SeatOrderMismatch);
        drain(seat_info, &ctx.accounts.creator)?;

        let hole_info = &ctx.remaining_accounts[MAX_SEATS + i];
        let (expected_hole, _) =
            Pubkey::find_program_address(&[HOLE_SEED, table_key.as_ref(), &[i as u8]], &crate::ID);
        require_keys_eq!(hole_info.key(), expected_hole, PokerError::SeatOrderMismatch);
        drain(hole_info, &ctx.accounts.creator)?;
    }

    let expect = |seed: &[u8]| Pubkey::find_program_address(&[seed, table_key.as_ref()], &crate::ID).0;
    require_keys_eq!(ctx.accounts.hand.key(), expect(HAND_SEED), PokerError::SeatOrderMismatch);
    require_keys_eq!(ctx.accounts.deck.key(), expect(DECK_SEED), PokerError::SeatOrderMismatch);
    drain(&ctx.accounts.hand, &ctx.accounts.creator)?;
    drain(&ctx.accounts.deck, &ctx.accounts.creator)?;
    // History is optional: older tables may never have had one created.
    if ctx.accounts.history.owner == &crate::ID {
        require_keys_eq!(
            ctx.accounts.history.key(),
            expect(HISTORY_SEED),
            PokerError::SeatOrderMismatch
        );
        drain(&ctx.accounts.history, &ctx.accounts.creator)?;
    }
    drain(&ctx.accounts.config, &ctx.accounts.creator)?;
    drain(table_info, &ctx.accounts.creator)?;

    msg!("table {} closed", table_id);
    Ok(())
}

/// Close an account this program owns, refunding its rent to `to`.
///
/// The discriminator is overwritten so the account cannot be mistaken for a
/// live one if something recreates it at the same address later.
fn drain<'a, 'b>(account: &AccountInfo<'a>, to: &AccountInfo<'b>) -> Result<()> {
    // An account this program never created has no rent to return and no data
    // to erase, so there is nothing to do. Table creation is several
    // transactions, and one that stopped half way leaves seats that were never
    // made; refusing here left such a table impossible for anyone, creator
    // included, to ever close. The caller has already checked this address is
    // the right PDA, so skipping an empty one cannot skip a real account.
    if account.owner == &anchor_lang::solana_program::system_program::ID
        && account.data_is_empty()
    {
        return Ok(());
    }
    require_keys_eq!(*account.owner, crate::ID, PokerError::SeatOrderMismatch);
    let lamports = account.lamports();
    **account.try_borrow_mut_lamports()? = 0;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(lamports)
        .ok_or(PokerError::InsufficientChips)?;

    let mut data = account.try_borrow_mut_data()?;
    for byte in data.iter_mut() {
        *byte = 0;
    }
    Ok(())
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct VacateSeat<'info> {
    /// CHECK: address, id and seat map verified raw inside, then written raw,
    /// so seats on tables from older builds can still be cleared.
    #[account(mut)]
    pub table: AccountInfo<'info>,
    /// CHECK: read raw for the creator, so an older config layout still works.
    pub config: AccountInfo<'info>,
    /// The staleness clock for the non-creator path.
    #[account(seeds = [HAND_SEED, table.key().as_ref()], bump = hand.bump)]
    pub hand: Account<'info, Hand>,
    #[account(mut, seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]], bump = seat.bump)]
    pub seat: Account<'info, Seat>,
    #[account(mut, seeds = [PLAYER_SEED, player.authority.as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    /// The creator at any time, or anyone once the table is stale.
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseTable<'info> {
    /// CHECK: address re-derived from the table id inside, then drained. Not
    /// deserialized so a table from an older build is still deletable.
    #[account(mut)]
    pub table: AccountInfo<'info>,
    /// CHECK: address and creator checked against the table, then drained.
    #[account(mut)]
    pub config: AccountInfo<'info>,
    /// Whoever asked for this. Only matters as the fee payer: the rent goes to
    /// the creator regardless, so there is nothing to gain by sweeping someone
    /// else's empty table.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: seed checked, then drained. Not deserialized so an older layout
    /// cannot make a table impossible to delete.
    #[account(mut)]
    pub hand: AccountInfo<'info>,
    /// CHECK: same.
    #[account(mut)]
    pub deck: AccountInfo<'info>,
    /// CHECK: same, and older tables may never have had one.
    #[account(mut)]
    pub history: AccountInfo<'info>,
    /// CHECK: must match the creator recorded in config; receives the rent.
    #[account(mut)]
    pub creator: AccountInfo<'info>,
}
