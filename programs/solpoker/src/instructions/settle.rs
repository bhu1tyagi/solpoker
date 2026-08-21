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
use sha2::{Digest, Sha256};
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
    // Settlement is permissionless and several clients race to be the one who
    // lands it. The winner flips the table to Waiting, and this check is what
    // makes the losers bounce off: a second settle would re-run against
    // cleared seats, wiping the revealed cards and recomputing the result
    // hash over zero payouts.
    require!(
        ctx.accounts.table.state == TableState::HandInProgress,
        PokerError::NoHandInProgress
    );
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
    // Cards of players who reach showdown become public; everyone else mucks.
    let mut revealed = [[NO_CARD; 2]; MAX_SEATS];
    let mut revealed_mask: u8 = 0;
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
            revealed[i] = hole.cards;
            revealed_mask |= 1 << i;
        } else {
            // Uncontested: any rank works, since there is nobody to compare to.
            ranks[i] = Some(HandRank::WORST);
        }
    }

    let mut dist = distribute(&pots, &ranks, betting.button);
    // The engine reports chips it could not assign an owner to. In a real hand
    // this is always zero; refusing to proceed otherwise means a settlement bug
    // can never silently destroy chips.
    require!(dist.unclaimed == 0, PokerError::UnclaimedChips);

    // --- the rake -------------------------------------------------------
    //
    // Taken here, after the engine has decided who won what and before any of
    // it reaches a stack. No flop, no drop: a hand that ended before the flop
    // was dealt is never raked, and the board is the honest test for that.
    //
    // Spread across the winners in proportion to what each is owed, so a split
    // pot is raked once between them rather than once each, and a side-pot
    // winner taking a tenth of the money pays a tenth of the rake. The
    // remainder from the division goes to the largest payout, which is the same
    // rule the engine already uses for an odd chip.
    let saw_flop = board[0] != NO_CARD;
    let paid = dist.total_paid();
    let rake = rake_for(paid, ctx.accounts.config.big_blind, saw_flop);
    let mut taken: u64 = 0;
    if rake > 0 && paid > 0 {
        let mut largest = 0usize;
        for i in 0..MAX_SEATS {
            if dist.payouts[i] == 0 {
                continue;
            }
            if dist.payouts[i] > dist.payouts[largest] {
                largest = i;
            }
            let share = ((rake as u128 * dist.payouts[i] as u128) / paid as u128) as u64;
            dist.payouts[i] = dist.payouts[i].saturating_sub(share);
            taken = taken.saturating_add(share);
        }
        let remainder = rake.saturating_sub(taken);
        if remainder > 0 && dist.payouts[largest] >= remainder {
            dist.payouts[largest] -= remainder;
            taken = taken.saturating_add(remainder);
        }
        ctx.accounts.table.rake_accrued =
            ctx.accounts.table.rake_accrued.saturating_add(taken);
    }

    {
        let seats = seats_mut!(ctx.accounts);
        for (seat, payout) in seats.into_iter().zip(dist.payouts.iter()) {
            seat.stack += payout;
            // Clear per-hand state so the next hand starts clean.
            seat.committed_street = 0;
            seat.committed_total = 0;
            seat.needs_action = false;
            seat.may_raise = false;
            seat.in_hand = false;
            seat.folded = false;
            seat.all_in = false;
            // Salts are single use, so the next hand needs fresh commitments.
            seat.salt_state = crate::instructions::shuffle::SALT_NONE;
        }
    }

    // The hand is over, so the seed and randomness stop being dangerous and
    // start being the public record the verifier runs on. Publish them on the
    // hand before the deck is wiped, or they are gone.
    {
        let hand = &mut ctx.accounts.hand;
        hand.vrf_randomness = ctx.accounts.deck.vrf_randomness;
        hand.shuffle_seed = ctx.accounts.deck.shuffle_seed;
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
        // The board stays. It is public by definition and the shuffle verifier
        // needs it; start_hand clears it for the next deal.
        hand.to_act = NO_SEAT;
        hand.current_bet = 0;
        hand.min_raise = 0;
        hand.last_aggressor = NO_SEAT;
        hand.dealt_in = 0;
        hand.street = street_to_u8(poker_engine::betting::Street::Showdown);
        // Only contested hands are shown. A pot won on a fold reveals nothing,
        // which is the same as at a real table.
        hand.revealed = revealed;
        hand.revealed_mask = revealed_mask;

        // Reset the shuffle so the next hand draws a fresh seed. Without this a
        // table would reuse one deck order forever.
        hand.shuffle_state = crate::instructions::shuffle::SHUFFLE_IDLE;
        hand.salt_xor = [0u8; 32];
        hand.salt_mask = 0;

        // Digest of what happened, small enough to commit and enough to pin the
        // hand against a published history.
        let mut d = Sha256::new();
        d.update(hand.hand_number.to_le_bytes());
        d.update(hand.shuffle_seed);
        d.update(board);
        for p in dist.payouts.iter() {
            d.update(p.to_le_bytes());
        }
        hand.result_hash = d.finalize().into();
    }
    ctx.accounts.table.state = TableState::Waiting;

    msg!("hand {} rake {} (pot {})", hand_number, taken, paid);
    msg!(
        "hand {} settled: pot {}, payouts {:?}",
        hand_number,
        pots.total(),
        dist.payouts
    );
    Ok(())
}

/// Unwind a hand that can no longer finish, returning every chip to whoever
/// put it in.
///
/// The break-glass, and the only instruction here that does not decide a
/// winner. If settlement itself cannot run — a hole account that will not
/// deserialize, a distribution the engine refuses because it could not assign
/// every chip an owner — then the pot is unreachable: `settle_hand` fails
/// forever, the table never leaves `HandInProgress`, `leave_table` needs
/// `Waiting`, and undelegation refuses a deck that still holds cards. Every
/// chip on that table stops existing for its owner. On devnet that is an
/// annoyance. With real money behind the chips it is theft by accident, and
/// there was no route out of it at all.
///
/// This is the most conservative resolution available: nobody wins the pot,
/// every seat gets back exactly what it contributed, and the table returns to
/// `Waiting` so people can stand up and cash out. Chips are conserved to the
/// lamport — `stack + committed_total` is what the seat had before the hand
/// began.
///
/// Permissionless and time-gated, like `force_timeout` and `reset_shuffle`,
/// because recovery must never depend on a particular client being awake.
pub fn abandon_hand(ctx: Context<AbandonHand>) -> Result<()> {
    require!(
        ctx.accounts.table.state == TableState::HandInProgress,
        PokerError::NoHandInProgress
    );

    let now = Clock::get()?.unix_timestamp;
    require!(
        now > ctx.accounts.hand.deadline.saturating_add(ABANDON_HAND_SECS),
        PokerError::DeadlineNotReached
    );

    let table_key = ctx.accounts.table.key();
    {
        let seats = seats_ref!(ctx.accounts);
        check_seat_order(&seats, &table_key)?;
    }

    // Give every contribution straight back. Checked rather than wrapping: this
    // is the path that exists because something already went wrong, so it must
    // not be the one that quietly destroys a stack.
    let mut refunded: u64 = 0;
    {
        let seats = seats_mut!(ctx.accounts);
        for seat in seats {
            seat.stack = seat
                .stack
                .checked_add(seat.committed_total)
                .ok_or(PokerError::InsufficientChips)?;
            refunded = refunded.saturating_add(seat.committed_total);
            seat.committed_street = 0;
            seat.committed_total = 0;
            seat.needs_action = false;
            seat.may_raise = false;
            seat.in_hand = false;
            seat.folded = false;
            seat.all_in = false;
            seat.salt_state = crate::instructions::shuffle::SALT_NONE;
        }
    }

    // Wipe the cards before anything can commit them to the base layer, exactly
    // as settlement does. Nothing is published: an abandoned hand has no result
    // to verify, and the seed stays secret because the deal never completed.
    ctx.accounts.deck.zeroize();
    require!(
        ctx.remaining_accounts.len() == MAX_SEATS,
        PokerError::SeatOrderMismatch
    );
    for (i, info) in ctx.remaining_accounts.iter().enumerate() {
        let (expected, _) =
            Pubkey::find_program_address(&[HOLE_SEED, table_key.as_ref(), &[i as u8]], &crate::ID);
        require_keys_eq!(info.key(), expected, PokerError::SeatOrderMismatch);
        require!(info.is_writable, PokerError::SeatOrderMismatch);
        let mut data = info.try_borrow_mut_data()?;
        let mut hole = HoleCards::try_deserialize(&mut &data[..])?;
        hole.zeroize();
        let mut cursor: &mut [u8] = &mut data;
        hole.try_serialize(&mut cursor)?;
    }

    {
        let hand = &mut ctx.accounts.hand;
        hand.to_act = NO_SEAT;
        hand.current_bet = 0;
        hand.min_raise = 0;
        hand.last_aggressor = NO_SEAT;
        hand.dealt_in = 0;
        hand.board = [NO_CARD; 5];
        hand.revealed = [[NO_CARD; 2]; MAX_SEATS];
        hand.revealed_mask = 0;
        hand.street = street_to_u8(poker_engine::betting::Street::Showdown);
        hand.shuffle_state = crate::instructions::shuffle::SHUFFLE_IDLE;
        hand.salt_xor = [0u8; 32];
        hand.salt_mask = 0;
        // No result: this hand did not happen. A zero hash is what the history
        // record already skips, so nothing downstream mistakes it for a result.
        hand.result_hash = [0u8; 32];
    }
    ctx.accounts.table.state = TableState::Waiting;

    msg!(
        "hand {} abandoned, {} chips returned to their contributors",
        ctx.accounts.hand.hand_number,
        refunded
    );
    Ok(())
}

#[derive(Accounts)]
pub struct AbandonHand<'info> {
    // Boxed for the same stack-frame reason as SettleHand.
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
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
    /// Anyone at all. Recovery must not depend on a particular caller.
    pub payer: Signer<'info>,
    // remaining_accounts: the six HoleCards PDAs, in seat order, all writable.
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
