//! SolPoker — real-time on-chain Texas Hold'em.
//!
//! Play money only. Chips enter through a rate-limited faucet and there is no
//! instruction in this program that converts them to SOL, a token, or anything
//! else of value.
//!
//! Execution is split across two layers:
//!
//! - **Base layer** holds chip custody ([`state::Player`]) and immutable table
//!   parameters. Never delegated.
//! - **Ephemeral Rollup** runs the game itself — table, seats, hand, deck — where
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

declare_id!("CJT1DDJe5cFsSVcwTAWr3wEo7QEqNjrXwmWkw1pdxmJd");

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

    pub fn claim_faucet(ctx: Context<ClaimFaucet>) -> Result<()> {
        instructions::player::claim_faucet(ctx)
    }

    // --- base layer: tables and seats --------------------------------------

    pub fn create_table(
        ctx: Context<CreateTable>,
        table_id: u64,
        small_blind: u64,
        big_blind: u64,
        min_buy_in: u64,
        max_buy_in: u64,
    ) -> Result<()> {
        instructions::table::create_table(
            ctx,
            table_id,
            small_blind,
            big_blind,
            min_buy_in,
            max_buy_in,
        )
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

    pub fn start_hand(ctx: Context<StartHand>, shuffle_seed: [u8; 32]) -> Result<()> {
        instructions::hand::start_hand(ctx, shuffle_seed)
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

    pub fn settle_hand(ctx: Context<SettleHand>) -> Result<()> {
        instructions::settle::settle_hand(ctx)
    }
}
