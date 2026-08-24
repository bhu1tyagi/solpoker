//! On-chain account layouts.
//!
//! Defined up front and in one place, because account layout is the thing that
//! is painful to change once anything is deployed.
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
//! | [`Deck`]      | delegated to ER, TEE-private | Card order must never be publicly readable. |
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

/// Bits in [`Deck::fulfilled_mask`], one per outstanding randomness draw.
pub const VRF_BOARD_BIT: u8 = 1 << 0;
pub const VRF_HOLE_BIT: u8 = 1 << 1;

// The faucet is retired: chips are bought with SOL and sold back for SOL, and
// nothing may mint an unbacked one. The Player field `last_faucet_ts` remains
// in the layout so existing accounts keep their shape.

/// The narrowest and widest turn clock a table may be created with.
///
/// A creator sets their own table's clock, and `check_config` correctly proves
/// the config belongs to the table — which means a hostile clock on the
/// attacker's *own* table is entirely legitimate as far as that check is
/// concerned. The clock is not decoration: `force_timeout` is permissionless
/// and folds anyone who owes chips, so a one-second clock lets the creator
/// raise and then time every opponent out before a human can physically
/// respond, taking every pot and cashing the chips out for SOL.
///
/// The floor is what stops that. The ceiling stops the mirror image: a clock so
/// long that one absent player freezes a hand, and with it every chip committed
/// to the pot, for practical purposes forever.
pub const MIN_ACTION_TIMEOUT_SECS: i64 = 10;
pub const MAX_ACTION_TIMEOUT_SECS: i64 = 300;

/// Clamp a stored clock into the legal range.
///
/// Applied at every point of use as well as at creation, so a config written by
/// an earlier build — when the only rule was "greater than zero" — cannot be
/// used to run a one-second table today.
pub fn clamped_timeout(secs: i64) -> i64 {
    secs.clamp(MIN_ACTION_TIMEOUT_SECS, MAX_ACTION_TIMEOUT_SECS)
}

/// The ephemeral rollup validator every table is delegated to.
///
/// This is the MagicBlock TEE validator: an Intel TDX enclave, and the reason
/// hole cards are not simply world-readable account data. Delegation is
/// permissionless, so leaving the choice to the caller meant anyone could send
/// an unstarted table to a rollup of their own choosing, where the permission
/// model protecting every card may not be enforced at all.
///
/// The same identity on devnet and on mainnet. MagicBlock runs one TEE
/// validator key across both clusters — only the endpoint differs
/// (`devnet-tee.magicblock.app` against `mainnet-tee.magicblock.app`) — so
/// this constant does not change when the program moves to mainnet, and the
/// cluster is chosen entirely by which RPC the client is pointed at.
pub const TEE_VALIDATOR: Pubkey = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");

// --- the rake ------------------------------------------------------------
//
// How the house earns, and the whole design goal is that nobody at the table
// notices. Three rules do that work, and all three are what live poker rooms
// and every major online site already do, so they read as normal rather than
// as a charge:
//
//   1. **No flop, no drop.** A hand that ends before the flop is never raked.
//      Steal the blinds, win the pot whole. This is the rule players check for,
//      and its absence is the first thing they complain about.
//   2. **A percentage, not a fee.** Taken from the pot at showdown, so it comes
//      out of money that was never the winner's to begin with. A fixed
//      per-hand charge would be felt on every small pot; a percentage scales
//      with the win.
//   3. **A hard cap.** Big pots are where the percentage would start to sting,
//      so it stops climbing at a few big blinds. The effective rate falls as
//      pots grow, which is exactly backwards from a fee and exactly what makes
//      it invisible to the players who generate the most volume.
//
// 2.5% against an industry norm of 2.5-5%, capped at three big blinds.

/// Rake in basis points of the pot. 250 = 2.5%.
pub const RAKE_BPS: u64 = 250;
/// The most any single hand can be raked, as a multiple of the big blind.
pub const RAKE_CAP_BIG_BLINDS: u64 = 3;
/// Pots at or below this many big blinds are never raked at all.
///
/// Stops the house taking a chip off a pot that is barely more than the blinds,
/// which is the case where a rake is most visible and least worth collecting.
pub const RAKE_FREE_BIG_BLINDS: u64 = 1;

/// What the house takes from a finished pot.
///
/// `saw_flop` is the no-flop-no-drop rule and comes from the board, not from a
/// street counter: if the flop was never dealt there is nothing to rake.
/// Saturating throughout — a rake calculation must never be the thing that
/// panics settlement, because a hand that cannot settle is a hand whose chips
/// nobody can reach.
pub fn rake_for(pot: u64, big_blind: u64, saw_flop: bool) -> u64 {
    if !saw_flop || big_blind == 0 {
        return 0;
    }
    if pot <= big_blind.saturating_mul(RAKE_FREE_BIG_BLINDS) {
        return 0;
    }
    let pct = (pot as u128)
        .saturating_mul(RAKE_BPS as u128)
        .checked_div(10_000)
        .unwrap_or(0) as u64;
    let cap = big_blind.saturating_mul(RAKE_CAP_BIG_BLINDS);
    // Never take more than the pot, however the constants are set later.
    pct.min(cap).min(pot)
}

/// Who may cash the house's chips out for SOL.
///
/// The treasury is an ordinary [`Player`] account belonging to this key, which
/// means rake needs no special custody path: it becomes chips like anyone
/// else's and leaves through the same `sell_chips` the players use, backed by
/// the same vault. Nothing here can mint a chip.
pub const TREASURY_AUTHORITY: Pubkey = pubkey!("FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq");

/// The only mints this program will ever take a deposit in, or pay one out of.
///
/// One binary serves both clusters, so both addresses are compiled in and
/// exactly one of them exists at a time. Circle's USDC has no account on
/// devnet; the test mint's own keypair was destroyed the moment it was created,
/// and instantiating an account at a keypair address needs that key's
/// signature, so nothing can ever bring it into being on mainnet. In both
/// directions the wrong mint simply has no account behind it, and
/// `Account<Mint>` refuses to load.
///
/// The list is not decoration. Creating an associated token account is
/// permissionless: without this check anyone could open the vault's ATA for a
/// mint they print themselves, buy chips with worthless tokens, and sell those
/// chips back for real USDC. Both buy and sell check it.
pub const USDC_MINT_MAINNET: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const USDC_MINT_DEVNET_TEST: Pubkey = pubkey!("CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq");

pub fn is_allowed_usdc_mint(mint: &Pubkey) -> bool {
    *mint == USDC_MINT_MAINNET || *mint == USDC_MINT_DEVNET_TEST
}

/// How long a hand may sit past its deadline before anyone may unwind it.
///
/// The break-glass, and deliberately a long way out. Every ordinary way a hand
/// gets stuck is already handled by something faster: an absent player is
/// folded by `force_timeout` on a 10-300 second clock, a dead shuffle is
/// cleared by `reset_shuffle` after 90 seconds. Reaching an hour past the
/// deadline means none of those applied — a hand that cannot settle — and at
/// that point the chips in the pot are unreachable by any other route.
///
/// Long enough, too, that it cannot be used to escape a losing hand: anyone at
/// the table can end a hand properly with a permissionless `force_timeout`, and
/// they have the whole hour to do it.
pub const ABANDON_HAND_SECS: i64 = 60 * 60;

/// How long a shuffle request may sit unfulfilled before anyone may clear it.
///
/// The VRF request is the one step of a hand that depends on something outside
/// this program, and until this existed there was no way back from it: an
/// unfulfilled request left `shuffle_state` at `SHUFFLE_REQUESTED` forever, and
/// every route out of that state — `start_hand`, `settle_hand`, a fresh
/// `request_shuffle` — is refused while it holds. The table, and every chip on
/// its seats, stayed there.
pub const VRF_TIMEOUT_SECS: i64 = 90;

pub const PLAYER_SEED: &[u8] = b"player";
/// Owns the token account holding the USDC that backs every outstanding chip.
/// The PDA itself holds nothing; it signs for the account that does.
pub const VAULT_SEED: &[u8] = b"vault";
pub const CONFIG_SEED: &[u8] = b"config";
pub const TABLE_SEED: &[u8] = b"table";
pub const SEAT_SEED: &[u8] = b"seat";
pub const HAND_SEED: &[u8] = b"hand";
pub const DECK_SEED: &[u8] = b"deck";
pub const HOLE_SEED: &[u8] = b"hole";
pub const HISTORY_SEED: &[u8] = b"history";

/// A player's chip balance. **Never delegated.**
///
/// This is the only account that holds chips at rest, and it stays on the base
/// layer so a player's balance is always settled on Solana rather than living
/// inside a rollup.
///
/// Chips are **not** play money. They are bought with USDC and sold back for
/// USDC at a fixed rate, one to one against the program vault, so a chip is a
/// claim on real dollars and every instruction that touches one is handling
/// somebody's money. An earlier version of this comment said the opposite,
/// which was true when a faucet minted them and has been wrong since it was
/// removed. `last_faucet_ts` survives only so the layout does not move.
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
    /// Rake taken at this table and not yet moved to the treasury.
    ///
    /// It accumulates here rather than going straight to the house because
    /// settlement runs on the rollup and the treasury balance is a base-layer
    /// [`Player`] account, which the rollup cannot write. So the chips wait on
    /// the table — which is delegated, and therefore writable at settlement —
    /// and `sweep_rake` moves them once the table is back on Solana.
    ///
    /// Chips are conserved the whole way: they leave the seats at settlement,
    /// sit here, and land in the treasury's balance. None are created, and the
    /// vault backs them exactly as it backed them when a player bought them.
    pub rake_accrued: u64,
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
    /// Has `secure_hole` ever pointed this seat's permission at its occupant?
    ///
    /// Advisory only. `start_hand` deliberately does **not** gate on it, and the
    /// long comment there explains why: a hole-card permission can only be
    /// updated by the member it already names, so a seat secured while empty
    /// names nobody and can never be re-pointed once someone sits down. Refusing
    /// to deal on that basis wedges the table permanently.
    ///
    /// Cleared when the occupant changes, so a client can see that the
    /// permission is stale and try to fix it while it still can.
    pub cards_secured: bool,
}

impl Seat {
    pub fn is_occupied(&self) -> bool {
        self.occupant != Table::EMPTY_SEAT
    }

    /// Reset the per-hand fields, leaving the occupant and stack alone.
    ///
    /// Also clears everything tied to *who* is sitting here, because every
    /// caller of this is a seat changing hands. A permission still naming the
    /// last occupant would let them read the next one's cards, and an inherited
    /// salt commitment would belong to a player who is no longer at the table.
    pub fn reset_for_new_hand(&mut self, dealt_in: bool) {
        self.committed_street = 0;
        self.committed_total = 0;
        self.folded = false;
        self.all_in = false;
        self.needs_action = dealt_in;
        self.may_raise = dealt_in;
        self.in_hand = dealt_in;
        self.cards_secured = false;
        self.salt_state = 0;
        self.salt_commit = [0u8; 32];
        self.salt = [0u8; 32];
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
    ///
    /// This seed governs the **board only**. It is published at settlement, and
    /// everything it determines becomes public with it.
    pub shuffle_seed: [u8; 32],
    /// A second, independent VRF draw that decides who gets which hole cards,
    /// and which is **never published**.
    ///
    /// One draw cannot do both jobs. Proving the board was fair means
    /// publishing the value it came from, and any hole cards derived from that
    /// same value are published along with it — XOR is reversible and hashing
    /// the two apart does not help, because a verifier who cannot see the input
    /// cannot check the output either. So the board gets a seed that is
    /// published and the hole cards get one that never leaves this account.
    ///
    /// That split is exactly the trust model this project already states:
    /// provably fair shuffle, TEE-protected hole cards. The board is checkable
    /// by anyone with no trust required; the hole cards rest on the enclave,
    /// as they always did. What changes is that a folded hand now stays folded.
    pub hole_randomness: [u8; 32],
    /// The five community cards, dealt at `start_hand` and revealed a street at
    /// a time. They live here, on the private deck, rather than being dealt off
    /// the top as each street opens: the board has to come from the published
    /// seed while the hole cards come from the secret one, so the two are drawn
    /// from different places and the board is settled before any hole card is.
    pub board: [u8; 5],
    /// The private half of the shuffle state machine. The public half on the
    /// hand only ever says "requested", because fulfillment arriving is itself
    /// information about when the deck became computable inside the enclave.
    ///
    /// Two draws are outstanding at once, so `SHUFFLE_FULFILLED` means both
    /// have landed. [`Deck::fulfilled_mask`] tracks them separately until then.
    pub shuffle_state: u8,
    /// Which of the two randomness draws have arrived: bit 0 the board, bit 1
    /// the hole cards. They are requested together and answered independently,
    /// in either order.
    pub fulfilled_mask: u8,
    pub bump: u8,
    /// Has `secure_deck` locked this deck to nobody yet?
    ///
    /// `start_hand` refuses without it. The VRF output lands here and the salts
    /// are public, so a deck that is still world-readable when a hand starts is
    /// the whole deck in the open: anyone can XOR the two together and deal the
    /// board out ahead of the table. Nothing else on chain enforced the order of
    /// these calls, so this is the bit that does.
    ///
    /// Not cleared by [`Deck::zeroize`]: the permission is created once and
    /// outlives the hand, so re-securing every hand would be work with no effect.
    pub secured: bool,
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
    /// layer. See docs/SPEC.md §4. Undelegation refuses a deck in any other state.
    pub fn zeroize(&mut self) {
        self.cards = [NO_CARD; 52];
        self.next_index = 0;
        self.vrf_randomness = [0u8; 32];
        self.shuffle_seed = [0u8; 32];
        // The hole draw is the one value here that must never reach the base
        // layer, so it goes with everything else at hand end rather than
        // persisting for the table's life. A fresh pair is drawn every hand.
        self.hole_randomness = [0u8; 32];
        self.board = [NO_CARD; 5];
        self.shuffle_state = 0;
        self.fulfilled_mask = 0;
    }


    /// Both randomness draws have landed and the deck can be dealt.
    pub fn fully_fulfilled(&self) -> bool {
        self.fulfilled_mask & (VRF_BOARD_BIT | VRF_HOLE_BIT) == (VRF_BOARD_BIT | VRF_HOLE_BIT)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A typo here is not a bug that shows up in review, it is a mainnet where
    /// nobody can deposit: `Account<Mint>` would find no account at a
    /// mistyped address and every buy would fail account validation. The
    /// address is famous enough to have near-misses in circulation, so pin it
    /// to the one anchor-spl ships rather than to a human's reading of it.
    #[test]
    fn the_mainnet_mint_is_circles_usdc() {
        assert_eq!(USDC_MINT_MAINNET, anchor_spl::mint::USDC);
    }

    /// Both allowlisted mints pass, nothing else does. The devnet entry is a
    /// mint whose keypair no longer exists, so it can never be created on
    /// mainnet; the check is what stops a mint anyone *can* create from
    /// standing in for the real one.
    #[test]
    fn the_allowlist_admits_exactly_two_mints() {
        assert!(is_allowed_usdc_mint(&USDC_MINT_MAINNET));
        assert!(is_allowed_usdc_mint(&USDC_MINT_DEVNET_TEST));
        assert!(!is_allowed_usdc_mint(&Pubkey::default()));
        assert!(!is_allowed_usdc_mint(&TREASURY_AUTHORITY));
    }

    /// The attack the floor exists for.
    ///
    /// `force_timeout` is permissionless and folds whoever owes chips, and a
    /// devnet action round trip is 257-865ms. A one-second clock on a table the
    /// attacker legitimately created lets them raise and then time every
    /// opponent out before a human can answer, hand after hand, and `sell_chips`
    /// turns the proceeds into SOL. `check_config` cannot see it, because the
    /// config really does belong to the table.
    #[test]
    fn a_one_second_clock_is_raised_to_something_a_human_can_answer() {
        assert_eq!(clamped_timeout(1), MIN_ACTION_TIMEOUT_SECS);
        assert_eq!(clamped_timeout(0), MIN_ACTION_TIMEOUT_SECS);
        assert_eq!(clamped_timeout(i64::MIN), MIN_ACTION_TIMEOUT_SECS);
    }

    /// The mirror image: a clock long enough that one absent player freezes the
    /// pot, and every chip in it, for practical purposes forever. `i64::MAX`
    /// also overflows `now + timeout`, and the release profile has
    /// `overflow-checks = true`, so unclamped it panics and the hand can never
    /// advance at all.
    #[test]
    fn an_endless_clock_is_cut_back_to_a_bounded_one() {
        assert_eq!(clamped_timeout(i64::MAX), MAX_ACTION_TIMEOUT_SECS);
        assert_eq!(clamped_timeout(86_400), MAX_ACTION_TIMEOUT_SECS);
    }

    #[test]
    fn ordinary_clocks_pass_through_unchanged() {
        for secs in [
            MIN_ACTION_TIMEOUT_SECS,
            15,
            30,
            60,
            MAX_ACTION_TIMEOUT_SECS,
        ] {
            assert_eq!(clamped_timeout(secs), secs, "clock of {secs}s was altered");
        }
    }

    /// `now + clamped_timeout(..)` must never be able to overflow, whatever a
    /// config holds, because a panic on the rollup is a hand that cannot move.
    #[test]
    fn a_clamped_clock_cannot_overflow_a_plausible_now() {
        let now: i64 = 4_102_444_800; // 2100-01-01
        for secs in [i64::MIN, -1, 0, 1, i64::MAX] {
            assert!(now.checked_add(clamped_timeout(secs)).is_some());
        }
    }

    // --- the rake --------------------------------------------------------

    /// The rule players check for first, and the one whose absence they
    /// complain about: a hand that never saw a flop is never raked.
    #[test]
    fn no_flop_no_drop() {
        assert_eq!(rake_for(10_000, 100, false), 0);
        // The same pot, once a flop exists, is raked normally.
        assert_eq!(rake_for(10_000, 100, true), 250);
    }

    /// Small pots go unraked entirely, so the charge is never visible on a hand
    /// that was barely more than the blinds.
    #[test]
    fn a_pot_no_bigger_than_the_blind_is_left_alone() {
        assert_eq!(rake_for(100, 100, true), 0);
        assert_eq!(rake_for(101, 100, true), 2);
    }

    /// The cap is what keeps the effective rate falling as pots grow, which is
    /// the opposite of how a fee behaves and the reason this stays unnoticed.
    #[test]
    fn the_cap_binds_on_big_pots() {
        let bb = 100;
        let cap = bb * RAKE_CAP_BIG_BLINDS;
        assert_eq!(rake_for(12_000, bb, true), cap, "2.5% of 12,000 exceeds the cap");
        assert_eq!(rake_for(1_000_000, bb, true), cap);
        // Effective rate on a huge pot is a small fraction of the headline.
        assert!(rake_for(1_000_000, bb, true) * 1_000 < 1_000_000);
    }

    /// A rake calculation must never be the thing that panics settlement: a
    /// hand that cannot settle is a hand whose chips nobody can reach.
    #[test]
    fn no_input_can_make_the_rake_panic_or_exceed_the_pot() {
        for pot in [0u64, 1, 100, u64::MAX] {
            for bb in [0u64, 1, 100, u64::MAX] {
                for flop in [true, false] {
                    let r = rake_for(pot, bb, flop);
                    assert!(r <= pot, "rake {r} exceeded pot {pot}");
                }
            }
        }
    }
}
