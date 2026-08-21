//! The betting action, the one instruction that runs on every keystroke.
//!
//! This is the hot path, so it is the one that gets session keys. A player
//! authorises a short-lived key once, and every fold/call/raise after that is
//! signed by that key with no wallet prompt. Without this, poker on chain is
//! unplayable: a wallet popup per action is not a poker client.
//!
//! Session authority is *additional* to, not a replacement for, application
//! authorisation. The session token proves "this key may act for this wallet on
//! this program"; this instruction still checks that the wallet in question
//! actually occupies the seat that is to act. A valid session for the wrong
//! player is worth nothing.
//!
//! Deliberately kept wallet-only: joining, leaving, and anything that moves chips
//! between a seat and a player balance. A leaked session key can therefore lose
//! chips at the table it was scoped to, but can never cash out or touch a balance.

use anchor_lang::prelude::*;
use poker_engine::betting::{Action, BettingError};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

use crate::bridge::*;
use crate::errors::PokerError;
use crate::state::*;
use crate::{seats_mut, seats_ref};

/// A betting action, in the shape the client sends it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PlayerMove {
    Fold,
    Check,
    Call,
    /// Raise the street's total commitment to this many chips. Also an opening bet.
    RaiseTo(u64),
    /// Commit the whole remaining stack.
    AllIn,
}

impl From<PlayerMove> for Action {
    fn from(m: PlayerMove) -> Action {
        match m {
            PlayerMove::Fold => Action::Fold,
            PlayerMove::Check => Action::Check,
            PlayerMove::Call => Action::Call,
            PlayerMove::RaiseTo(to) => Action::RaiseTo(to),
            PlayerMove::AllIn => Action::AllIn,
        }
    }
}

/// Translate an engine rules violation into a program error, so clients get a
/// specific reason rather than a generic failure.
fn map_betting_error(e: BettingError) -> Error {
    match e {
        BettingError::NoActionPending => error!(PokerError::StreetComplete),
        BettingError::OutOfTurn => error!(PokerError::OutOfTurn),
        BettingError::SeatNotActive => error!(PokerError::NotSeated),
        BettingError::CannotCheck => error!(PokerError::CannotCheck),
        BettingError::NothingToCall => error!(PokerError::NothingToCall),
        BettingError::CannotRaise => error!(PokerError::CannotRaise),
        BettingError::RaiseTooSmall => error!(PokerError::RaiseTooSmall),
        BettingError::BelowMinRaise => error!(PokerError::BelowMinRaise),
        BettingError::InsufficientChips => error!(PokerError::InsufficientChips),
        BettingError::NotEnoughPlayers => error!(PokerError::NotEnoughPlayers),
    }
}

/// Take a betting action for the seat that is to act.
///
/// The `session_auth_or` guard accepts either the player's own wallet signing
/// directly, or an approved session key signing on their behalf.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.payer.key(),
    SessionError::InvalidToken
)]
pub fn player_action(ctx: Context<PlayerAction>, action: PlayerMove) -> Result<()> {
    let hand = &ctx.accounts.hand;
    require!(hand.to_act != NO_SEAT, PokerError::StreetComplete);
    let seat_index = hand.to_act as usize;

    let table_key = hand.table;
    let authority = ctx.accounts.authority.key();

    // The config decides the minimum raise and the turn clock, so a config from
    // another table is as dangerous as a seat from another table.
    check_config(&ctx.accounts.config, &table_key)?;

    let mut betting = {
        let seats = seats_ref!(ctx.accounts);
        check_seat_order(&seats, &table_key)?;
        // Application authorisation: the wallet this action is for must actually
        // hold the seat that is to act. A valid session token for some other
        // player does not get past this.
        require_keys_eq!(seats[seat_index].occupant, authority, PokerError::OutOfTurn);
        load_betting(hand, &seats, &ctx.accounts.config)
    };

    betting
        .apply(seat_index, action.into())
        .map_err(map_betting_error)?;

    {
        let mut seats = seats_mut!(ctx.accounts);
        store_betting(&betting, &mut ctx.accounts.hand, &mut seats);
    }

    let slot = Clock::get()?.slot;
    let now = Clock::get()?.unix_timestamp;
    {
        let seats = seats_mut!(ctx.accounts);
        seats[seat_index].last_action_slot = slot;
    }
    // Clamped rather than trusted. The range is enforced at creation too, but a
    // config written before that rule existed still deserializes, and this is
    // one of the four places its value becomes the turn clock.
    ctx.accounts.hand.deadline = now + clamped_timeout(ctx.accounts.config.action_timeout_secs);

    msg!(
        "seat {} {:?}; bet {} to act {}",
        seat_index,
        action,
        ctx.accounts.hand.current_bet,
        ctx.accounts.hand.to_act
    );
    Ok(())
}

#[derive(Accounts, Session)]
pub struct PlayerAction<'info> {
    /// Whoever pays for and signs this transaction: either the player's wallet or
    /// their session key.
    pub payer: Signer<'info>,
    /// CHECK: the player this action is for. Verified against the seat occupant,
    /// and bound to `payer` by the session token when a session is used.
    pub authority: UncheckedAccount<'info>,
    // Boxed for the same stack-frame reason as AdvanceStreet.
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
    #[session(signer = payer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}
