//! The turn clock.
//!
//! Poker needs a clock or one absent player halts the table forever. This is the
//! concrete advantage of making the enclave the dealer rather than using mental
//! poker: a player who vanishes mid-hand is simply folded and the hand carries
//! on. Nothing needs their key, because they never held one.
//!
//! `force_timeout` is permissionless on purpose. Anyone can call it once the
//! deadline passes, so the table does not depend on a particular client, a
//! server, or the absent player's own goodwill. A crank can call it on a timer,
//! but nothing breaks if the crank is down and another player calls it instead.
//!
//! Timing out is not the same as folding by choice. A player facing no bet is
//! checked down rather than folded, which is what a real dealer does, so an
//! unattended player only loses a pot they had actually put money into.

use anchor_lang::prelude::*;
use poker_engine::betting::Action;

use crate::bridge::*;
use crate::errors::PokerError;
use crate::state::*;
use crate::{seats_mut, seats_ref};

pub fn force_timeout(ctx: Context<ForceTimeout>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let hand = &ctx.accounts.hand;

    require!(hand.to_act != NO_SEAT, PokerError::StreetComplete);
    require!(now > hand.deadline, PokerError::DeadlineNotReached);

    let seat_index = hand.to_act as usize;
    let table_key = hand.table;

    // See check_config. This instruction is permissionless and rewrites the
    // deadline, so without this check one caller could hold the clock for the
    // rest of the hand and time every other player out in turn.
    check_config(&ctx.accounts.config, &table_key)?;

    let mut betting = {
        let seats = seats_ref!(ctx.accounts);
        check_seat_order(&seats, &table_key)?;
        load_betting(hand, &seats, &ctx.accounts.config)
    };

    // Check when nothing is owed, fold when something is. Never fold a player out
    // of a pot they could have stayed in for free.
    let owed = betting
        .current_bet
        .saturating_sub(betting.seats[seat_index].street_committed);
    let action = if owed == 0 { Action::Check } else { Action::Fold };

    betting
        .apply(seat_index, action)
        .map_err(|_| error!(PokerError::IllegalAction))?;

    {
        let mut seats = seats_mut!(ctx.accounts);
        store_betting(&betting, &mut ctx.accounts.hand, &mut seats);
    }
    ctx.accounts.hand.deadline = now + clamped_timeout(ctx.accounts.config.action_timeout_secs);

    msg!(
        "seat {} timed out and was {}",
        seat_index,
        if owed == 0 { "checked" } else { "folded" }
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ForceTimeout<'info> {
    #[account(mut)]
    pub hand: Box<Account<'info, Hand>>,
    pub config: Box<Account<'info, TableConfig>>,
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
    /// Anyone at all. The clock must not depend on a particular caller.
    pub payer: Signer<'info>,
}
