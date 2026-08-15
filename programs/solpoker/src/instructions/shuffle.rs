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

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};
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
            pubkey: ctx.accounts.hand.key(),
            is_signer: false,
            is_writable: true,
        }]),
        ..Default::default()
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;

    ctx.accounts.hand.shuffle_state = SHUFFLE_REQUESTED;
    msg!("shuffle randomness requested");
    Ok(())
}

/// Oracle callback. Combines VRF output with the salts to fix the shuffle seed.
pub fn shuffle_callback(ctx: Context<ShuffleCallback>, randomness: [u8; 32]) -> Result<()> {
    let hand = &mut ctx.accounts.hand;
    // A late callback for a superseded request must not overwrite a live seed.
    require!(
        hand.shuffle_state == SHUFFLE_REQUESTED,
        PokerError::NoShuffleRequested
    );

    hand.vrf_randomness = randomness;
    let mut seed = randomness;
    for (i, b) in hand.salt_xor.iter().enumerate() {
        seed[i] ^= b;
    }
    hand.shuffle_seed = seed;
    hand.shuffle_state = SHUFFLE_FULFILLED;

    msg!("shuffle seed fixed for hand {}", hand.hand_number);
    Ok(())
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct SaltCtx<'info> {
    #[account(mut)]
    pub hand: Account<'info, Hand>,
    #[account(mut, seeds = [SEAT_SEED, hand.table.as_ref(), &[seat_index]], bump = seat.bump)]
    pub seat: Account<'info, Seat>,
    pub authority: Signer<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestShuffle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub hand: Account<'info, Hand>,
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
    pub hand: Account<'info, Hand>,
}
