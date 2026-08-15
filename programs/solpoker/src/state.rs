//! On-chain account layouts.
//!
//! The whole layout is defined here up front, including accounts that only come
//! alive in later phases, because account layout is the thing that is painful to
//! change once anything is deployed.
//!
//! Which layer each account lives on matters:
//!
//! | Account       | Layer                        | Why |
//! |---------------|------------------------------|-----|
//! | [`Player`]    | base only, never delegated   | Chip custody. Must stay readable and settled on Solana. |
//! | [`TableConfig`]| base only, never delegated  | Immutable params; nothing to mutate at speed. |
//! | [`Table`]     | delegated to ER              | Seat map and button move every hand. |
//! | [`Seat`]      | delegated to ER              | Stack and per-street state change on every action. |
//! | [`Hand`]      | delegated to ER              | Street, board, and betting state change constantly. |
//! | [`Deck`]      | delegated to ER, private in Phase 4 | Card order must never be publicly readable. |
//!
//! Card bytes use the `poker-engine` encoding directly (`rank = card / 4`,
//! `suit = card % 4`, `0xFF` = none), so no conversion layer is needed.

use anchor_lang::prelude::*;

/// Seats at a table. SolPoker v1 is 6-max, matching `poker_engine::MAX_SEATS`.
pub const MAX_SEATS: usize = poker_engine::MAX_SEATS;

/// Sentinel for "no seat" in `to_act` and similar fields.
pub const NO_SEAT: u8 = 0xFF;

/// Sentinel for an undealt board slot.
pub const NO_CARD: u8 = poker_engine::card::NO_CARD;

/// Play-money chips handed out per faucet claim.
pub const FAUCET_AMOUNT: u64 = 10_000;

/// Minimum wait between faucet claims, in seconds.
pub const FAUCET_COOLDOWN_SECS: i64 = 24 * 60 * 60;

/// How long a player has to act before anyone may time them out.
pub const ACTION_TIMEOUT_SECS: i64 = 30;

pub const PLAYER_SEED: &[u8] = b"player";
pub const CONFIG_SEED: &[u8] = b"config";
pub const TABLE_SEED: &[u8] = b"table";
pub const SEAT_SEED: &[u8] = b"seat";
pub const HAND_SEED: &[u8] = b"hand";
pub const DECK_SEED: &[u8] = b"deck";
pub const HOLE_SEED: &[u8] = b"hole";
pub const HISTORY_SEED: &[u8] = b"history";

/// A player's chip balance and faucet state. **Never delegated.**
///
/// This is the only account that holds chips at rest, and it stays on the base
/// layer so a player's balance is always settled on Solana rather than living
/// inside a rollup. Chips are play money: they enter only through the faucet and
/// can never leave for anything of value.
#[account]
#[derive(InitSpace)]
pub struct Player {
    pub authority: Pubkey,
    /// Chips not currently committed to a seat.
    pub chips: u64,
    pub last_faucet_ts: i64,
    pub hands_played: u64,
    pub bump: u8,
}

/// Immutable table parameters. **Never delegated.**
#[account]
#[derive(InitSpace)]
pub struct TableConfig {
    pub table_id: u64,
    pub creator: Pubkey,
    pub small_blind: u64,
    pub big_blind: u64,
    pub min_buy_in: u64,
    pub max_buy_in: u64,
    pub max_seats: u8,
    /// Seconds a player has to act before anyone may time them out. Per table so
    /// a fast game and a slow game can coexist.
    pub action_timeout_secs: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum TableState {
    /// No hand running; players may join and leave freely.
    Waiting,
    /// A hand is live. Joining and leaving are restricted.
    HandInProgress,
}

/// Mutable table state. **Delegated to the ER.**
#[account]
#[derive(InitSpace)]
pub struct Table {
    pub table_id: u64,
    pub config: Pubkey,
    /// Occupant of each seat, or `Pubkey::default()` when empty.
    pub seats: [Pubkey; MAX_SEATS],
    pub button: u8,
    pub hand_number: u64,
    pub state: TableState,
    pub bump: u8,
    /// When the last player left, or 0 while anyone is still seated.
    ///
    /// Appended after `bump` on purpose: every field before it keeps the
    /// offset it has always had, so a client reading a table written by an
    /// older build gets the same answers and simply finds nothing here.
    ///
    /// An abandoned table would otherwise sit in the lobby forever, because
    /// only its creator can delete it and creators lose keys. This is the
    /// clock that lets anyone sweep one once it has been empty long enough.
    pub empty_since: i64,
}

/// How long a table must sit empty before anyone may sweep it away.
pub const ABANDONED_AFTER_SECS: i64 = 60 * 60;

impl Table {
    pub const EMPTY_SEAT: Pubkey = Pubkey::new_from_array([0u8; 32]);

    /// Is anybody sitting here?
    pub fn is_vacant(&self) -> bool {
        self.seats.iter().all(|s| *s == Self::EMPTY_SEAT)
    }

    /// Start or stop the abandonment clock to match who is seated.
    pub fn touch_vacancy(&mut self, now: i64) {
        if self.is_vacant() {
            if self.empty_since == 0 {
                self.empty_since = now;
            }
        } else {
            self.empty_since = 0;
        }
    }

    pub fn is_empty_seat(&self, index: usize) -> bool {
        self.seats[index] == Self::EMPTY_SEAT
    }

    pub fn occupied_count(&self) -> usize {
        self.seats
            .iter()
            .filter(|s| **s != Self::EMPTY_SEAT)
            .count()
    }

    pub fn seat_of(&self, player: &Pubkey) -> Option<usize> {
        self.seats.iter().position(|s| s == player)
    }
}

/// One seat's chips and per-hand state. **Delegated to the ER.**
///
/// One PDA per seat index, created with the table and reused for its lifetime, so
/// a seat's address is stable and never needs re-delegating as players come and go.
#[account]
#[derive(InitSpace)]
pub struct Seat {
    pub table: Pubkey,
    pub seat_index: u8,
    /// Current occupant, or `Pubkey::default()` when empty.
    pub occupant: Pubkey,
    /// Chips in front of this seat. Moves to and from [`Player::chips`].
    pub stack: u64,
    /// Chips pushed forward on the current street.
    pub committed_street: u64,
    /// Chips pushed forward across the whole hand.
    pub committed_total: u64,
    pub folded: bool,
    pub all_in: bool,
    /// Still owes an action this street.
    pub needs_action: bool,
    /// May raise if it acts. Cleared by an under-raise all-in, per poker rules.
    pub may_raise: bool,
    /// Dealt in for the current hand. False for someone who joined mid-hand.
    pub in_hand: bool,
    pub last_action_slot: u64,
    /// SHA-256 of this seat's shuffle salt, submitted before the deal.
    pub salt_commit: [u8; 32],
    /// The revealed salt. Published so anyone can recompute the shuffle.
    pub salt: [u8; 32],
    /// 0 none, 1 committed, 2 revealed.
    pub salt_state: u8,
    pub bump: u8,
}

impl Seat {
    pub fn is_occupied(&self) -> bool {
        self.occupant != Table::EMPTY_SEAT
    }

    /// Reset the per-hand fields, leaving the occupant and stack alone.
    pub fn reset_for_new_hand(&mut self, dealt_in: bool) {
        self.committed_street = 0;
        self.committed_total = 0;
        self.folded = false;
        self.all_in = false;
        self.needs_action = dealt_in;
        self.may_raise = dealt_in;
        self.in_hand = dealt_in;
    }
}

/// The hand in progress. **Delegated to the ER.**
///
/// One PDA per table, overwritten each hand rather than created per hand, so no
/// new account has to be delegated between hands.
#[account]
#[derive(InitSpace)]
pub struct Hand {
    pub table: Pubkey,
    pub hand_number: u64,
    /// Encodes [`poker_engine::betting::Street`].
    pub street: u8,
    /// Community cards; `0xFF` for undealt slots.
    pub board: [u8; 5],
    /// Highest street commitment anyone must match.
    pub current_bet: u64,
    /// Minimum raise increment over `current_bet`.
    pub min_raise: u64,
    /// Seat to act, or [`NO_SEAT`] when the street is complete.
    pub to_act: u8,
    pub button: u8,
    pub last_aggressor: u8,
    /// Bitmask of seats dealt into this hand. Lets instructions that only touch
    /// hole cards avoid loading all six seat accounts, which keeps them inside
    /// the BPF stack frame.
    pub dealt_in: u8,
    /// Unix time after which anyone may force a timeout on `to_act`.
    pub deadline: i64,
    /// Seed the deck was shuffled from, published at hand end so the shuffle can
    /// be verified. Phase 5 fills this from VRF combined with player salts.
    pub shuffle_seed: [u8; 32],
    /// Hole cards of players who reached showdown, copied here at settlement so
    /// they become public. Everyone else is mucked and stays `0xFF`.
    pub revealed: [[u8; 2]; MAX_SEATS],
    /// Bitmask of seats whose cards were revealed rather than mucked.
    pub revealed_mask: u8,
    /// XOR of every revealed salt, accumulated as players reveal.
    pub salt_xor: [u8; 32],
    /// Bitmask of seats that have revealed a salt this hand.
    pub salt_mask: u8,
    /// Raw VRF output, kept alongside the salts so the combination is checkable.
    pub vrf_randomness: [u8; 32],
    /// 0 idle, 1 requested, 2 fulfilled.
    pub shuffle_state: u8,
    /// Digest of the finished hand: number, seed, board and payouts. Committed to
    /// the base layer so a hand can be pinned without publishing every detail.
    pub result_hash: [u8; 32],
    pub bump: u8,
}

/// The shuffled deck. **Delegated to the ER; made TEE-private in Phase 4.**
///
/// Until Phase 4 this account is world-readable, which is exactly why Phase 3
/// plays face-up: the privacy work is what makes hidden cards possible, and
/// pretending otherwise before then would be dishonest.
#[account]
#[derive(InitSpace)]
pub struct Deck {
    pub table: Pubkey,
    pub cards: [u8; 52],
    pub next_index: u8,
    /// Raw VRF output, delivered here rather than to the public hand.
    ///
    /// The deck account is the one place nobody can read, and the seed must be
    /// secret while the hand runs: salts are public once revealed, so seed and
    /// VRF output on a readable account would let anyone recompute the entire
    /// deck mid-hand. Both are copied to the hand at settlement, which is when
    /// the verifier needs them and the moment they stop being dangerous.
    pub vrf_randomness: [u8; 32],
    /// `vrf_randomness XOR salt_xor`, fixed when the hand starts.
    pub shuffle_seed: [u8; 32],
    /// The private half of the shuffle state machine. The public half on the
    /// hand only ever says "requested", because fulfillment arriving is itself
    /// information about when the deck became computable inside the enclave.
    pub shuffle_state: u8,
    pub bump: u8,
}

impl Deck {
    /// Deal the next card off the top.
    pub fn deal(&mut self) -> Option<u8> {
        if (self.next_index as usize) >= self.cards.len() {
            return None;
        }
        let c = self.cards[self.next_index as usize];
        self.next_index += 1;
        Some(c)
    }

    /// Overwrite every secret. Called at hand end so neither card data nor the
    /// seed that generates it can ever ride a commit back to the public base
    /// layer. See SPEC.md §4. Undelegation refuses a deck in any other state.
    pub fn zeroize(&mut self) {
        self.cards = [NO_CARD; 52];
        self.next_index = 0;
        self.vrf_randomness = [0u8; 32];
        self.shuffle_seed = [0u8; 32];
        self.shuffle_state = 0;
    }

    /// Is this deck safe to publish? True only when zeroize has run (or the
    /// deck has never held a shuffle at all).
    pub fn holds_no_secrets(&self) -> bool {
        self.cards.iter().all(|c| *c == NO_CARD)
            && self.vrf_randomness.iter().all(|b| *b == 0)
            && self.shuffle_seed.iter().all(|b| *b == 0)
    }
}

/// Base-layer record of hands played at a table. **Never delegated.**
///
/// Written by a post-commit Magic Action at settlement, so the rollup can leave a
/// permanent trace on Solana without anyone sending a separate transaction.
#[account]
#[derive(InitSpace)]
pub struct TableHistory {
    pub table: Pubkey,
    pub hands_recorded: u64,
    pub last_hand_number: u64,
    pub last_result_hash: [u8; 32],
    pub bump: u8,
}

/// Hole cards for one seat. **Delegated to the ER; TEE-private from Phase 4.**
///
/// Phase 3 keeps these public so the real-time loop can be built and verified
/// first. Phase 4 attaches an `EphemeralPermission` whose only member is the
/// seat's occupant.
#[account]
#[derive(InitSpace)]
pub struct HoleCards {
    pub table: Pubkey,
    pub seat_index: u8,
    pub hand_number: u64,
    pub cards: [u8; 2],
    pub bump: u8,
}

impl HoleCards {
    pub fn zeroize(&mut self) {
        self.cards = [NO_CARD; 2];
    }
}
