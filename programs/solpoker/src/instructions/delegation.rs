//! Moving the table's PDAs on and off the Ephemeral Rollup.
//!
//! Delegation is split across several small instructions rather than one large
//! one. A single context holding the table, hand, deck, six seats, and six
//! hole-card accounts overflows the 4KB BPF stack frame in Anchor's generated
//! account resolution, which surfaces at runtime as a null-pointer access
//! violation, not a clean error. Small contexts also keep each transaction well
//! inside its compute budget.
//!
//! The validator is always pinned explicitly. Letting it float would mean the ER
//! a table lands on could change between hands.

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
// The chained .commit_and_undelegate() methods are trait methods. #[ephemeral]
// injects this import inside the annotated program module only, so call sites
// in other modules must bring it in themselves.
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::errors::PokerError;
use crate::state::*;

/// Refuse to publish anything that still holds card data.
///
/// Undelegation commits account contents to public Solana state permanently,
/// and it is permissionless, so "the client only calls it after settlement" is
/// not a guarantee, it is a habit. This is the guarantee: every account leaving
/// the rollup is checked, by type, for the bytes it must not carry. The type
/// check matters as much as the content check, because the account slots here
/// are unchecked and a deck handed in through the table's slot would otherwise
/// ride out unexamined.
fn assert_is<T: Discriminator>(info: &AccountInfo) -> Result<()> {
    let data = info.try_borrow_data()?;
    require!(
        data.len() >= 8 && data[..8] == T::DISCRIMINATOR[..],
        PokerError::SeatOrderMismatch
    );
    Ok(())
}

/// Deck offsets, read raw rather than deserialized.
///
/// Deserializing would tie this check to the current layout, and an account
/// written by an older build would fail to deserialize and could then never
/// leave the rollup at all. A table that cannot be exited is worse than one
/// that cannot be played, so this reads the bytes it cares about and ignores
/// the rest.
const DECK_CARDS: usize = 8 + 32;
const DECK_CARDS_END: usize = DECK_CARDS + 52;
/// Where the randomness and seed start, in layouts that carry them.
const DECK_SECRETS: usize = DECK_CARDS_END + 1;
const DECK_SECRETS_END: usize = DECK_SECRETS + 64;

fn assert_deck_publishable(info: &AccountInfo) -> Result<()> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= DECK_CARDS_END, PokerError::SeatOrderMismatch);
    require!(
        data[DECK_CARDS..DECK_CARDS_END].iter().all(|c| *c == NO_CARD),
        PokerError::HandInProgress
    );
    // Older decks stop before the seed. Newer ones must have it wiped too.
    if data.len() >= DECK_SECRETS_END {
        require!(
            data[DECK_SECRETS..DECK_SECRETS_END].iter().all(|b| *b == 0),
            PokerError::HandInProgress
        );
    }
    Ok(())
}

const HOLE_CARDS: usize = 8 + 32 + 1 + 8;

fn assert_hole_publishable(info: &AccountInfo) -> Result<()> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= HOLE_CARDS + 2, PokerError::SeatOrderMismatch);
    require!(
        data[HOLE_CARDS] == NO_CARD && data[HOLE_CARDS + 1] == NO_CARD,
        PokerError::HandInProgress
    );
    Ok(())
}

fn config_for(validator: Option<Pubkey>) -> DelegateConfig {
    DelegateConfig {
        validator,
        ..Default::default()
    }
}

/// Delegate the table, hand, and deck.
pub fn delegate_core(ctx: Context<DelegateCore>, table_id: u64) -> Result<()> {
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    let table_key = ctx.accounts.table.key();

    ctx.accounts.delegate_table(
        &ctx.accounts.payer,
        &[TABLE_SEED, &table_id.to_le_bytes()],
        config_for(validator),
    )?;
    ctx.accounts.delegate_hand(
        &ctx.accounts.payer,
        &[HAND_SEED, table_key.as_ref()],
        config_for(validator),
    )?;
    ctx.accounts.delegate_deck(
        &ctx.accounts.payer,
        &[DECK_SEED, table_key.as_ref()],
        config_for(validator),
    )?;
    msg!("delegated table/hand/deck for table {}", table_id);
    Ok(())
}

/// Delegate one seat and its hole-card account together, since they always move
/// as a pair.
pub fn delegate_seat(ctx: Context<DelegateSeat>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        crate::errors::PokerError::SeatIndexOutOfRange
    );
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    let table_key = ctx.accounts.table.key();

    ctx.accounts.delegate_seat(
        &ctx.accounts.payer,
        &[SEAT_SEED, table_key.as_ref(), &[seat_index]],
        config_for(validator),
    )?;
    ctx.accounts.delegate_hole(
        &ctx.accounts.payer,
        &[HOLE_SEED, table_key.as_ref(), &[seat_index]],
        config_for(validator),
    )?;
    msg!("delegated seat {}", seat_index);
    Ok(())
}

/// Commit table/hand/deck state back to the base layer and undelegate.
///
/// COMMIT AUDIT: commits `table` (seat map, button, hand number), `hand`
/// (street, board, betting state, and the seed of the *settled* hand), and
/// `deck`.
///
/// The deck is only safe to commit because it is checked, right here, to be
/// zeroized: no cards, no VRF output, no seed. [`crate::instructions::settle`]
/// is what puts it in that state. Anyone calling this mid-hand is refused, so a
/// live deck cannot be published no matter who asks.
pub fn undelegate_core(ctx: Context<UndelegateCore>) -> Result<()> {
    assert_is::<Table>(&ctx.accounts.table)?;
    assert_is::<Hand>(&ctx.accounts.hand)?;
    assert_deck_publishable(&ctx.accounts.deck)?;

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.table.to_account_info(),
        ctx.accounts.hand.to_account_info(),
        ctx.accounts.deck.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

/// Commit one seat and its hole cards back to the base layer and undelegate.
///
/// COMMIT AUDIT: commits `seat` (occupant, stack, per-hand flags) and `hole`
/// (two card bytes). The hole account is checked, right here, to hold `0xFF`
/// padding rather than cards, so calling this mid-hand to expose an opponent's
/// hand is refused no matter who asks.
pub fn undelegate_seat(ctx: Context<UndelegateSeat>) -> Result<()> {
    assert_is::<Seat>(&ctx.accounts.seat)?;
    assert_hole_publishable(&ctx.accounts.hole)?;

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.seat.to_account_info(),
        ctx.accounts.hole.to_account_info(),
    ])
    .build_and_invoke()?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct DelegateCore<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA handed to the delegation program
    #[account(mut, del, seeds = [TABLE_SEED, &table_id.to_le_bytes()], bump)]
    pub table: AccountInfo<'info>,
    /// CHECK: PDA handed to the delegation program
    #[account(mut, del, seeds = [HAND_SEED, table.key().as_ref()], bump)]
    pub hand: AccountInfo<'info>,
    /// CHECK: PDA handed to the delegation program
    #[account(mut, del, seeds = [DECK_SEED, table.key().as_ref()], bump)]
    pub deck: AccountInfo<'info>,
    /// CHECK: ER validator to pin; checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct DelegateSeat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only used to derive the seat and hole-card PDAs
    pub table: UncheckedAccount<'info>,
    /// CHECK: PDA handed to the delegation program
    #[account(mut, del, seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]], bump)]
    pub seat: AccountInfo<'info>,
    /// CHECK: PDA handed to the delegation program
    #[account(mut, del, seeds = [HOLE_SEED, table.key().as_ref(), &[seat_index]], bump)]
    pub hole: AccountInfo<'info>,
    /// CHECK: ER validator to pin; checked by the delegation program
    pub validator: Option<UncheckedAccount<'info>>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateCore<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub table: AccountInfo<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub hand: AccountInfo<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub deck: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateSeat<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub seat: AccountInfo<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub hole: AccountInfo<'info>,
}
