//! Showdown, payout, and clearing card data at hand end.
//!
//! # The rule that matters most
//!
//! `Deck` and `HoleCards` are zeroized here, at hand end, **before** any
//! undelegation path can run. A commit writes account contents back to public
//! Solana state permanently, so a deck committed mid-hand would publish every
//! card forever. Zeroizing at settlement is what makes the undelegate path in
//! [`crate::instructions::delegation`] safe. See SPEC.md §4.
//!
//! Hole-card accounts arrive as `remaining_accounts` rather than named accounts.
//! Adding six more `Account<HoleCards>` fields to a context that already holds six
//! seats overflows the BPF stack frame; raw `AccountInfo`s cost almost nothing.
//! Each one's PDA is re-derived and checked, so passing the wrong account fails.

use anchor_lang::prelude::*;
use poker_engine::eval::evaluate;
use poker_engine::pots::{build_pots, distribute};
use poker_engine::HandRank;

use crate::bridge::*;
use crate::errors::PokerError;
use crate::state::*;
use crate::{seats_mut, seats_ref};

/// Settle the hand: award the pots, then wipe all card data.
///
/// Permissionless, anyone may call it once the hand is over, so a disconnected
/// winner cannot leave the table stuck.
pub fn settle_hand(ctx: Context<SettleHand>) -> Result<()> {
    let table_key = ctx.accounts.table.key();
    let hand_number = ctx.accounts.hand.hand_number;
    let board = ctx.accounts.hand.board;

    let betting = {
        let seats = seats_ref!(ctx.accounts);
        check_seat_order(&seats, &table_key)?;
        load_betting(&ctx.accounts.hand, &seats, &ctx.accounts.config)
    };

    // Settlement is only legal once nobody can act again.
    let showdown = betting.street == poker_engine::betting::Street::Showdown;
    require!(
        betting.hand_is_over() || (showdown && betting.street_is_complete()),
        PokerError::StreetNotComplete
    );

    let contributions = betting.contributions();
    let folded = betting.folded();
    let pots = build_pots(&contributions, &folded);

    // Rank every player still holding cards. A hand that ended on a fold has one
    // such player, who wins without showing anything.
    let mut ranks = [None::<HandRank>; MAX_SEATS];
    let contested = betting
        .seats
        .iter()
        .filter(|s| s.occupied && !s.folded)
        .count();

    require!(
        ctx.remaining_accounts.len() == MAX_SEATS,
        PokerError::SeatOrderMismatch
    );

    for i in 0..MAX_SEATS {
        let info = &ctx.remaining_accounts[i];
        let (expected, _) =
            Pubkey::find_program_address(&[HOLE_SEED, table_key.as_ref(), &[i as u8]], &crate::ID);
        require_keys_eq!(info.key(), expected, PokerError::SeatOrderMismatch);

        let in_hand = betting.seats[i].occupied && !betting.seats[i].folded;
        if !in_hand {
            continue;
        }

        let data = info.try_borrow_data()?;
        let hole = HoleCards::try_deserialize(&mut &data[..])?;
        drop(data);

        // With more than one player left the board must be complete; a fold-out
        // winner never needs evaluating.
        if contested > 1 {
            require!(
                board.iter().all(|c| *c != NO_CARD),
                PokerError::StreetNotComplete
            );
            require!(
                hole.hand_number == hand_number,
                PokerError::HandNumberMismatch
            );
            let seven = [
                hole.cards[0],
                hole.cards[1],
                board[0],
                board[1],
                board[2],
                board[3],
                board[4],
            ];
            ranks[i] = Some(evaluate(&seven));
        } else {
            // Uncontested: any rank works, since there is nobody to compare to.
            ranks[i] = Some(HandRank::WORST);
        }
    }

    let dist = distribute(&pots, &ranks, betting.button);
    // The engine reports chips it could not assign an owner to. In a real hand
    // this is always zero; refusing to proceed otherwise means a settlement bug
    // can never silently destroy chips.
    require!(dist.unclaimed == 0, PokerError::UnclaimedChips);

    {
        let mut seats = seats_mut!(ctx.accounts);
        for i in 0..MAX_SEATS {
            seats[i].stack += dist.payouts[i];
            // Clear per-hand state so the next hand starts clean.
            seats[i].committed_street = 0;
            seats[i].committed_total = 0;
            seats[i].needs_action = false;
            seats[i].may_raise = false;
            seats[i].in_hand = false;
            seats[i].folded = false;
            seats[i].all_in = false;
        }
    }

    // --- wipe every card before anything can commit it to the base layer ---
    ctx.accounts.deck.zeroize();

    for i in 0..MAX_SEATS {
        let info = &ctx.remaining_accounts[i];
        require!(info.is_writable, PokerError::SeatOrderMismatch);
        let mut data = info.try_borrow_mut_data()?;
        let mut hole = HoleCards::try_deserialize(&mut &data[..])?;
        hole.zeroize();
        let mut cursor: &mut [u8] = &mut data;
        hole.try_serialize(&mut cursor)?;
    }

    {
        let hand = &mut ctx.accounts.hand;
        hand.board = [NO_CARD; 5];
        hand.to_act = NO_SEAT;
        hand.current_bet = 0;
        hand.min_raise = 0;
        hand.last_aggressor = NO_SEAT;
        hand.dealt_in = 0;
        hand.street = street_to_u8(poker_engine::betting::Street::Showdown);
    }
    ctx.accounts.table.state = TableState::Waiting;

    msg!(
        "hand {} settled: pot {}, payouts {:?}",
        hand_number,
        pots.total(),
        dist.payouts
    );
    Ok(())
}

#[derive(Accounts)]
pub struct SettleHand<'info> {
    // Boxed for the same stack-frame reason as StartHand.
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
    // remaining_accounts: the six HoleCards PDAs, in seat order, all writable.
}
