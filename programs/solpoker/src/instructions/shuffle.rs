//! Verifiable shuffle: player salts combined with VRF.
//!
//! VRF alone would mean trusting the oracle. Player salts alone would mean
//! trusting whoever reveals last. Combining them means the deck is unbiased
//! unless the oracle *and* every seated player collude.
//!
//! The order matters and is the whole security argument:
//!
//! 1. Every player commits `sha256(salt)`. Nobody has seen anyone else's salt.
//! 2. Every player reveals their salt, checked against their commitment. Salts
//!    are now fixed and public.
//! 3. Only then is VRF requested, with a caller seed derived from the salts. The
//!    seed is deterministic, so nobody can grind it by re-requesting.
//! 4. The shuffle seed is `VRF output XOR salt_1 XOR ... XOR salt_n`.
//!
//! Because the salts are locked before the VRF is drawn, no player can pick a
//! salt that steers the result. Because the caller seed is a function of those
//! salts, no requester can shop for a better VRF output either.
//!
//! Everything needed to recheck this is published on chain: each seat keeps its
//! salt, and the hand keeps the raw VRF output and the final seed.
//!
//! Committing and revealing happen twice per hand, so like the betting action
//! they accept a session key. Two wallet prompts per hand would make the game
//! unplayable for the same reason one prompt per bet would. The salt is still
//! generated on the player's own machine, so the fairness argument above is
//! unchanged: a session key signs the same salt its owner chose.

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};
use ephemeral_rollups_sdk::{
    anchor::{vrf, vrf_callback},
    vrf::{
        self as vrf_api,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    },
};

use crate::errors::PokerError;
use crate::state::*;

pub const SALT_NONE: u8 = 0;
pub const SALT_COMMITTED: u8 = 1;
pub const SALT_REVEALED: u8 = 2;

pub const SHUFFLE_IDLE: u8 = 0;
pub const SHUFFLE_REQUESTED: u8 = 1;
pub const SHUFFLE_FULFILLED: u8 = 2;

/// Submit `sha256(salt)` for a seat, before any salt is public.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.payer.key(),
    SessionError::InvalidToken
)]
pub fn commit_salt(ctx: Context<SaltCtx>, seat_index: u8, commitment: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.hand.shuffle_state == SHUFFLE_IDLE,
        PokerError::HandInProgress
    );
    let seat = &mut ctx.accounts.seat;
    require!(seat.seat_index == seat_index, PokerError::SeatOrderMismatch);
    require_keys_eq!(
        seat.occupant,
        ctx.accounts.authority.key(),
        PokerError::NotSeated
    );

    seat.salt_commit = commitment;
    seat.salt = [0u8; 32];
    seat.salt_state = SALT_COMMITTED;
    Ok(())
}

/// Reveal a salt and fold it into the hand's running XOR.
#[session_auth_or(
    ctx.accounts.authority.key() == ctx.accounts.payer.key(),
    SessionError::InvalidToken
)]
pub fn reveal_salt(ctx: Context<SaltCtx>, seat_index: u8, salt: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.hand.shuffle_state == SHUFFLE_IDLE,
        PokerError::HandInProgress
    );
    let seat = &mut ctx.accounts.seat;
    require!(seat.seat_index == seat_index, PokerError::SeatOrderMismatch);
    require_keys_eq!(
        seat.occupant,
        ctx.accounts.authority.key(),
        PokerError::NotSeated
    );
    require!(
        seat.salt_state == SALT_COMMITTED,
        PokerError::SaltNotCommitted
    );
    let mut digest = Sha256::new();
    digest.update(salt);
    let expected: [u8; 32] = digest.finalize().into();
    require!(expected == seat.salt_commit, PokerError::SaltMismatch);

    seat.salt = salt;
    seat.salt_state = SALT_REVEALED;

    let hand = &mut ctx.accounts.hand;
    for (i, b) in salt.iter().enumerate() {
        hand.salt_xor[i] ^= b;
    }
    hand.salt_mask |= 1 << seat_index;

    msg!("seat {} revealed its salt", seat_index);
    Ok(())
}

/// Ask the VRF oracle for randomness, seeded from the revealed salts.
///
/// The caller seed is a hash of the salts and hand number rather than anything
/// the caller chooses, so re-requesting cannot produce a different draw.
///
/// The randomness is delivered to the deck, not the hand. The hand is a public
/// account, the salts are public once revealed, and seed = VRF XOR salts, so
/// VRF output on a readable account would let anyone recompute the whole deck
/// before a card is dealt. The callback therefore touches only the private
/// deck, which also keeps the oracle's transaction (whose arguments carry the
/// randomness) out of anyone's reach.
pub fn request_shuffle(ctx: Context<RequestShuffle>) -> Result<()> {
    let hand = &ctx.accounts.hand;
    require!(
        hand.shuffle_state == SHUFFLE_IDLE,
        PokerError::ShuffleAlreadyRequested
    );
    require!(hand.salt_mask.count_ones() >= 2, PokerError::NotEnoughSalts);

    let mut digest = Sha256::new();
    digest.update(hand.salt_xor);
    digest.update(hand.hand_number.to_le_bytes());
    let caller_seed: [u8; 32] = digest.finalize().into();

    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ShuffleCallback::DISCRIMINATOR.to_vec(),
        caller_seed,
        accounts_metas: Some(vec![vrf_api::types::SerializableAccountMeta {
            pubkey: ctx.accounts.deck.key(),
            is_signer: false,
            is_writable: true,
        }]),
        ..Default::default()
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    ctx.accounts.deck.shuffle_state = SHUFFLE_REQUESTED;
    ctx.accounts.hand.shuffle_state = SHUFFLE_REQUESTED;
    msg!("shuffle randomness requested");
    Ok(())
}

/// Oracle callback. Stores the raw randomness on the private deck.
///
/// Nothing public changes here on purpose. Clients cannot see fulfillment
/// arrive; they try `start_hand` on a cadence and are refused with
/// `ShuffleNotReady` until this has landed. The seed itself is combined with
/// the salts inside `start_hand`, so it exists nowhere readable.
pub fn shuffle_callback(ctx: Context<ShuffleCallback>, randomness: [u8; 32]) -> Result<()> {
    let deck = &mut ctx.accounts.deck;
    // A late callback for a superseded request must not overwrite a live deck.
    require!(
        deck.shuffle_state == SHUFFLE_REQUESTED,
        PokerError::NoShuffleRequested
    );

    deck.vrf_randomness = randomness;
    deck.shuffle_state = SHUFFLE_FULFILLED;

    msg!("shuffle randomness delivered");
    Ok(())
}

#[derive(Accounts, Session)]
#[instruction(seat_index: u8)]
pub struct SaltCtx<'info> {
    /// Whoever pays for and signs this transaction: either the player's wallet or
    /// their session key.
    pub payer: Signer<'info>,
    /// CHECK: the player this salt is for. Verified against the seat occupant,
    /// and bound to `payer` by the session token when a session is used.
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub hand: Account<'info, Hand>,
    #[account(mut, seeds = [SEAT_SEED, hand.table.as_ref(), &[seat_index]], bump = seat.bump)]
    pub seat: Account<'info, Seat>,
    #[session(signer = payer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub hand: Account<'info, Hand>,
    #[account(mut, seeds = [DECK_SEED, hand.table.as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,
    /// CHECK: the oracle queue, constrained to the known queues
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf_api::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_TEST_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ShuffleCallback<'info> {
    #[account(mut)]
    pub deck: Account<'info, Deck>,
}
