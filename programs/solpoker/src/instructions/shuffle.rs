//! Verifiable shuffle: player salts combined with VRF.
//!
//! VRF alone would mean trusting the oracle. Player salts alone would mean
//! trusting whoever reveals last. Combining them means the deck is unbiased
//! unless the oracle *and* every player who contributed a salt collude.
//!
//! Read that last part precisely, because it is weaker than it sounds and the
//! code is the honest version: [`request_shuffle`] requires **two** revealed
//! salts, not one per seated player. A player who does not reveal is not
//! protected by their own salt, only by the two that did reveal and by the VRF.
//! Raising that threshold to every dealt-in seat is the obvious fix and is
//! deliberately not done yet: without a deadline for revealing, one player who
//! commits and then walks away would freeze the table for everyone, which
//! trades a conditional fairness weakness for an unconditional denial of
//! service. The threshold should go up at the same time a reveal timeout goes
//! in, not before. See SPEC.md.
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
//! Because the VRF is drawn after the salts are fixed, no player can pick a
//! salt that steers the result: the seed is `VRF XOR salt_xor`, and choosing
//! one half of an XOR against a half nobody knows yet chooses nothing. And
//! because the caller seed is derived from the table, the hand number and the
//! current slot rather than from the salts, no requester can shop for a better
//! draw either: none of the three is theirs to choose, and the deck stays
//! private throughout, so there is nothing to observe and nothing to steer
//! toward. The slot is in there so a retry is a genuinely new request rather
//! than a duplicate the oracle will ignore.
//!
//! That last part used to be the other way round, and it was backwards. A
//! caller seed derived from `salt_xor` handed the choice to whoever committed
//! last, since they could read every revealed salt and pick theirs to land the
//! total wherever they liked. Closing that by refusing late commits instead
//! turned a race between two browsers into a table that could never start.
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
    // A commitment may be replaced, but only while it still commits to nothing
    // anyone can see. Once the first salt is revealed, changing a commitment
    // means choosing a salt with knowledge of someone else's, which is exactly
    // what the commit phase exists to prevent: a player could otherwise commit,
    // reveal, then commit and reveal again, and since a second reveal XORs in
    // without XORing the first out, they would land on any `salt_xor` they
    // liked after watching everyone else. First-time commits stay open either
    // way, so a player who sits down late is not locked out of the hand.
    //
    // A first-time commit stays open after reveals have begun, and that
    // exemption is load-bearing. Every client does its own salt work with no
    // delay, because nobody else can do it for them, so two browsers race:
    // closing commits at the first reveal means whoever reveals first locks
    // every slower player out of the hand permanently. Two players, one salt,
    // `request_shuffle` needs two — the table waits forever. Measured in the
    // two-browser gate, not reasoned about.
    //
    // What that exemption used to cost is now paid for elsewhere. A late
    // committer can still read the running `salt_xor` and choose their salt to
    // land it on any value they like; what they cannot do is turn that into a
    // choice of deck, because the VRF is drawn after salts lock and
    // `request_shuffle` no longer derives its caller seed from `salt_xor`. The
    // final seed is `VRF XOR salt_xor` with the VRF still unknown, so steering
    // one half of an XOR against an unknown other half steers nothing.
    require!(
        ctx.accounts.hand.salt_mask == 0 || ctx.accounts.seat.salt_state == SALT_NONE,
        PokerError::SaltCommitClosed
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
    // The deck must be hidden *before* the randomness lands on it, not before
    // the hand starts. This was the gap: `start_hand` checked `secured`, but by
    // then the VRF output had already been written, and the salts that combine
    // with it are public on the seat accounts the moment they are revealed. A
    // deck that is still world-readable when the callback arrives is therefore
    // the entire deal in the open — every hole card and the whole board —
    // computable by anyone who can reach the rollup, before a card is turned.
    //
    // Checked here as well as in the callback because this is the instruction
    // that decides a request will happen at all, and refusing early means the
    // oracle is never asked rather than asked and then ignored.
    require!(ctx.accounts.deck.secured, PokerError::CardsNotSecured);

    let hand = &ctx.accounts.hand;
    require!(
        hand.shuffle_state == SHUFFLE_IDLE,
        PokerError::ShuffleAlreadyRequested
    );
    require!(hand.salt_mask.count_ones() >= 2, PokerError::NotEnoughSalts);

    // Derived from the table and the hand number, deliberately **not** from
    // `salt_xor`.
    //
    // Deriving it from the salts was meant to stop a requester shopping for a
    // better draw, and it did the opposite for whoever committed last: they
    // could read every revealed salt, pick theirs to land `salt_xor` wherever
    // they wanted, and so choose the caller seed. Table and hand number are
    // fixed before any salt exists and are not any player's to choose, so
    // re-requesting produces the identical request and there is nothing to
    // grind. It also makes a late commit harmless, which is what lets one stay
    // allowed — see `commit_salt`.
    // The slot is in here so that a retry is a *different* request.
    //
    // Without it this is `sha256(table || hand_number)`, and a hand that failed
    // to start never advances its number — so every retry after `reset_shuffle`
    // re-sent a byte-identical request, the oracle treated it as a duplicate,
    // and nothing was ever fulfilled again. One unlucky first draw turned into
    // a table that retried every ninety seconds forever. Measured on a live
    // table stuck at hand 5 while hands 1-4 had been fine.
    //
    // It stays unshoppable. A caller cannot choose the slot, and cannot predict
    // the VRF output from it; re-requesting is gated by `reset_shuffle`'s
    // ninety-second wait and the deck stays private throughout, so there is
    // nothing to observe and nothing to steer toward.
    let mut digest = Sha256::new();
    digest.update(hand.table.as_ref());
    digest.update(hand.hand_number.to_le_bytes());
    digest.update(Clock::get()?.slot.to_le_bytes());
    let caller_seed: [u8; 32] = digest.finalize().into();

    // Two draws, requested together and answered independently.
    //
    // The board's is published at settlement so the deal can be checked; the
    // hole cards' never leaves the deck. They have to be independent for that
    // to mean anything — one draw split two ways is still one secret, and
    // publishing it publishes both halves.
    let deck_meta = vec![vrf_api::types::SerializableAccountMeta {
        pubkey: ctx.accounts.deck.key(),
        is_signer: false,
        is_writable: true,
    }];
    for (discriminator, tag) in [
        (
            crate::instruction::ShuffleCallback::DISCRIMINATOR.to_vec(),
            b"board".as_slice(),
        ),
        (
            crate::instruction::HoleCallback::DISCRIMINATOR.to_vec(),
            b"hole".as_slice(),
        ),
    ] {
        let mut d = Sha256::new();
        d.update(caller_seed);
        d.update(tag);
        let scoped: [u8; 32] = d.finalize().into();
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: discriminator,
            caller_seed: scoped,
            accounts_metas: Some(deck_meta.clone()),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    }

    ctx.accounts.deck.shuffle_state = SHUFFLE_REQUESTED;
    ctx.accounts.hand.shuffle_state = SHUFFLE_REQUESTED;
    // Stamp when the request went out, so [`reset_shuffle`] can tell a slow
    // oracle from one that is never coming. `deadline` is free here: it only
    // means anything while a seat is to act, and between hands `to_act` is
    // `NO_SEAT`, so `force_timeout` refuses regardless. `start_hand` overwrites
    // it with the real turn clock the moment the hand actually begins.
    ctx.accounts.hand.deadline = Clock::get()?.unix_timestamp + VRF_TIMEOUT_SECS;
    msg!("shuffle randomness requested");
    Ok(())
}

/// Clear a shuffle request the oracle never answered.
///
/// Without this the table is stuck: an unfulfilled request leaves
/// `shuffle_state` at [`SHUFFLE_REQUESTED`], and every way out of that state is
/// refused while it holds. `start_hand` wants `SHUFFLE_FULFILLED`, a fresh
/// `request_shuffle` wants `SHUFFLE_IDLE`, salt commits and reveals want
/// `SHUFFLE_IDLE`, and `settle_hand` cannot run because no hand ever started.
/// The state survives undelegation because it is committed, so the table could
/// not be paused back to safety either — and every chip on its seats stayed
/// there with it.
///
/// Permissionless and time-gated, like `force_timeout`, so recovery never
/// depends on a particular client being awake.
///
/// The revealed salts are deliberately **not** cleared. They are already public,
/// and a late callback for the abandoned request can still only write
/// randomness that gets XORed with the same salts, so leaving them fixed means a
/// straggling fulfilment cannot be used to shop for a better deal.
pub fn reset_shuffle(ctx: Context<ResetShuffle>) -> Result<()> {
    require!(
        ctx.accounts.table.state == TableState::Waiting,
        PokerError::HandInProgress
    );
    require!(
        ctx.accounts.hand.shuffle_state == SHUFFLE_REQUESTED,
        PokerError::NoShuffleRequested
    );
    let now = Clock::get()?.unix_timestamp;
    require!(now > ctx.accounts.hand.deadline, PokerError::ShuffleNotStale);

    // Both halves of the state machine go back to idle together, and any
    // randomness that did land is wiped rather than kept: a deck holding a
    // fulfilled-but-unusable seed is exactly the thing that cannot undelegate.
    ctx.accounts.deck.zeroize();
    ctx.accounts.hand.shuffle_state = SHUFFLE_IDLE;

    msg!("stale shuffle request cleared; salts kept, deck wiped");
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
    // Belt and braces with the same check in `request_shuffle`. That one stops
    // the request being made; this one stops the answer being stored if the
    // deck somehow lost its permission in between. Refusing the delivery is the
    // safe direction: the request expires and `reset_shuffle` clears it, which
    // costs a hand. Storing it on a readable deck would cost every card.
    require!(deck.secured, PokerError::CardsNotSecured);

    deck.vrf_randomness = randomness;
    deck.fulfilled_mask |= VRF_BOARD_BIT;
    if deck.fully_fulfilled() {
        deck.shuffle_state = SHUFFLE_FULFILLED;
    }

    msg!("board randomness delivered");
    Ok(())
}

/// The second oracle callback: randomness that decides the hole cards.
///
/// Stored and never published. `settle_hand` copies the board's draw and seed
/// onto the public hand so the deal can be checked; this one is wiped by
/// `Deck::zeroize` along with the cards, and `assert_deck_publishable` refuses
/// to let a deck leave the rollup while it still holds one.
pub fn hole_callback(ctx: Context<HoleCallback>, randomness: [u8; 32]) -> Result<()> {
    let deck = &mut ctx.accounts.deck;
    require!(
        deck.shuffle_state == SHUFFLE_REQUESTED,
        PokerError::NoShuffleRequested
    );
    require!(deck.secured, PokerError::CardsNotSecured);

    deck.hole_randomness = randomness;
    deck.fulfilled_mask |= VRF_HOLE_BIT;
    if deck.fully_fulfilled() {
        deck.shuffle_state = SHUFFLE_FULFILLED;
    }

    msg!("hole randomness delivered");
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
    /// CHECK: pinned to the one queue that is actually serviced from inside a
    /// rollup. Accepting the whole family let a caller aim a request at a queue
    /// nobody operates — the base-layer queue, or the localnet test queue — and
    /// the fulfilment would then never arrive. Before `reset_shuffle` existed
    /// that was a one-transaction, permanent brick on any table; it is now a
    /// recoverable stall, and there is still no reason to allow it.
    #[account(mut, address = vrf_api::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ResetShuffle<'info> {
    #[account(mut, seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Box<Account<'info, Table>>,
    #[account(mut, seeds = [HAND_SEED, table.key().as_ref()], bump = hand.bump)]
    pub hand: Box<Account<'info, Hand>>,
    #[account(mut, seeds = [DECK_SEED, table.key().as_ref()], bump = deck.bump)]
    pub deck: Box<Account<'info, Deck>>,
    /// Anyone at all. Recovery must not depend on a particular caller, for the
    /// same reason `force_timeout` does not.
    pub payer: Signer<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct ShuffleCallback<'info> {
    #[account(mut)]
    pub deck: Account<'info, Deck>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct HoleCallback<'info> {
    #[account(mut)]
    pub deck: Account<'info, Deck>,
}
