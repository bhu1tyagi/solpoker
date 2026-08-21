//! SolPoker, real-time on-chain Texas Hold'em.
//!
//! **Not play money.** Chips are bought with SOL and sold back for SOL at a
//! fixed rate, backed one to one by lamports in the program vault, so every
//! instruction that touches one is handling somebody's money. The faucet this
//! comment used to describe was removed; nothing here can mint an unbacked
//! chip. The house takes a percentage of raked pots, which redistributes chips
//! that already existed rather than creating any.
//!
//! Execution is split across two layers:
//!
//! - **Base layer** holds chip custody ([`state::Player`]) and immutable table
//!   parameters. Never delegated.
//! - **Ephemeral Rollup** runs the game itself, table, seats, hand, deck, where
//!   actions need to land in tens of milliseconds rather than hundreds.
//!
//! Custody transitions only ever happen on the base layer while the table is
//! undelegated, so a rollup can move chips between seats but can never mint them
//! or reach a player's balance.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod bridge;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");

// Injects the undelegation callback the delegation program CPIs into, plus the
// commit/undelegate intent builders. Must sit above `#[program]`.
#[ephemeral]
#[program]
pub mod solpoker {
    use super::*;

    // --- base layer: player accounts and chips -----------------------------

    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        instructions::player::init_player(ctx)
    }

    pub fn buy_chips(ctx: Context<BuyChips>, chips: u64) -> Result<()> {
        instructions::player::buy_chips(ctx, chips)
    }

    /// Move a table's accrued rake into the treasury balance. Permissionless;
    /// the destination is fixed.
    pub fn sweep_rake(ctx: Context<SweepRake>) -> Result<()> {
        instructions::player::sweep_rake(ctx)
    }

    pub fn sell_chips(ctx: Context<SellChips>, chips: u64) -> Result<()> {
        instructions::player::sell_chips(ctx, chips)
    }

    // --- base layer: tables and seats --------------------------------------

    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        small_blind: u64,
        big_blind: u64,
        min_buy_in: u64,
        max_buy_in: u64,
        action_timeout_secs: i64,
    ) -> Result<()> {
        instructions::table::create_table(
            ctx,
            table_id,
            small_blind,
            big_blind,
            min_buy_in,
            max_buy_in,
            action_timeout_secs,
        )
    }

    pub fn create_history(ctx: Context<CreateHistory>) -> Result<()> {
        instructions::history::create_history(ctx)
    }

    pub fn create_seat(ctx: Context<CreateSeat>, seat_index: u8) -> Result<()> {
        instructions::table::create_seat(ctx, seat_index)
    }

    pub fn join_table(ctx: Context<JoinTable>, seat_index: u8, buy_in: u64) -> Result<()> {
        instructions::table::join_table(ctx, seat_index, buy_in)
    }

    pub fn leave_table(ctx: Context<LeaveTable>, seat_index: u8) -> Result<()> {
        instructions::table::leave_table(ctx, seat_index)
    }

    pub fn vacate_seat(ctx: Context<VacateSeat>, seat_index: u8) -> Result<()> {
        instructions::table::vacate_seat(ctx, seat_index)
    }

    pub fn close_table(ctx: Context<CloseTable>) -> Result<()> {
        instructions::table::close_table(ctx)
    }

    pub fn create_hole(ctx: Context<CreateHole>, seat_index: u8) -> Result<()> {
        instructions::hand::create_hole(ctx, seat_index)
    }

    // --- moving on and off the ephemeral rollup ----------------------------

    pub fn delegate_core(ctx: Context<DelegateCore>, table_id: u64) -> Result<()> {
        instructions::delegation::delegate_core(ctx, table_id)
    }

    pub fn delegate_seat(ctx: Context<DelegateSeat>, seat_index: u8) -> Result<()> {
        instructions::delegation::delegate_seat(ctx, seat_index)
    }

    pub fn undelegate_core(ctx: Context<UndelegateCore>) -> Result<()> {
        instructions::delegation::undelegate_core(ctx)
    }

    pub fn undelegate_seat(ctx: Context<UndelegateSeat>) -> Result<()> {
        instructions::delegation::undelegate_seat(ctx)
    }

    // --- the game itself, running on the ER --------------------------------

    // --- verifiable shuffle ------------------------------------------------

    pub fn commit_salt(
        ctx: Context<SaltCtx>,
        seat_index: u8,
        commitment: [u8; 32],
    ) -> Result<()> {
        instructions::shuffle::commit_salt(ctx, seat_index, commitment)
    }

    pub fn reveal_salt(ctx: Context<SaltCtx>, seat_index: u8, salt: [u8; 32]) -> Result<()> {
        instructions::shuffle::reveal_salt(ctx, seat_index, salt)
    }

    pub fn request_shuffle(ctx: Context<RequestShuffle>) -> Result<()> {
        instructions::shuffle::request_shuffle(ctx)
    }

    pub fn shuffle_callback(
        ctx: Context<ShuffleCallback>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::shuffle::shuffle_callback(ctx, randomness)
    }

    /// The second oracle callback: randomness for the hole cards, which is
    /// stored on the private deck and never published.
    pub fn hole_callback(
        ctx: Context<HoleCallback>,
        randomness: [u8; 32],
    ) -> Result<()> {
        instructions::shuffle::hole_callback(ctx, randomness)
    }

    /// Permissionless escape hatch for a shuffle request the oracle never
    /// answered. Time-gated, like `force_timeout`.
    pub fn reset_shuffle(ctx: Context<ResetShuffle>) -> Result<()> {
        instructions::shuffle::reset_shuffle(ctx)
    }

    pub fn start_hand(ctx: Context<StartHand>) -> Result<()> {
        instructions::hand::start_hand(ctx)
    }

    pub fn deal_hole_cards(ctx: Context<DealHoleCards>) -> Result<()> {
        instructions::hand::deal_hole_cards(ctx)
    }

    pub fn advance_street(ctx: Context<AdvanceStreet>) -> Result<()> {
        instructions::hand::advance_street(ctx)
    }

    pub fn player_action(ctx: Context<PlayerAction>, action: PlayerMove) -> Result<()> {
        instructions::action::player_action(ctx, action)
    }

    /// Lock the deck so no wallet can read it. Runs on the rollup.
    pub fn secure_deck(ctx: Context<SecureDeck>) -> Result<()> {
        instructions::privacy::secure_deck(ctx)
    }

    /// Restrict a seat's hole cards to its occupant. Runs on the rollup.
    pub fn secure_hole(ctx: Context<SecureHole>, seat_index: u8) -> Result<()> {
        instructions::privacy::secure_hole(ctx, seat_index)
    }

    /// Give up your own hole-card read right so the next occupant of the seat
    /// can be named. Runs on the rollup, between hands.
    pub fn release_hole(ctx: Context<ReleaseHole>, seat_index: u8) -> Result<()> {
        instructions::privacy::release_hole(ctx, seat_index)
    }

    pub fn settle_hand(ctx: Context<SettleHand>) -> Result<()> {
        instructions::settle::settle_hand(ctx)
    }

    /// Break-glass for a hand that can never settle: refunds every
    /// contribution and frees the table. Permissionless, and only an hour past
    /// the deadline.
    pub fn abandon_hand(ctx: Context<AbandonHand>) -> Result<()> {
        instructions::settle::abandon_hand(ctx)
    }

    /// Permissionless turn clock. Anyone may call it once the deadline passes.
    pub fn force_timeout(ctx: Context<ForceTimeout>) -> Result<()> {
        instructions::timeout::force_timeout(ctx)
    }

    /// Commit table state and record the last hand on the base layer.
    pub fn commit_results(ctx: Context<CommitResults>) -> Result<()> {
        instructions::history::commit_results(ctx)
    }

    /// Base-layer target of the post-commit Magic Action.
    pub fn record_hand_result(
        ctx: Context<RecordHandResult>,
        hand_number: u64,
        result_hash: [u8; 32],
    ) -> Result<()> {
        instructions::history::record_hand_result(ctx, hand_number, result_hash)
    }
}
