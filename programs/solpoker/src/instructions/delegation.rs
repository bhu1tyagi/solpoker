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
/// Where the randomness and seeds start, in layouts that carry them.
///
/// 32 bytes of board randomness, 32 of the seed derived from it, then 32 of
/// hole randomness and the five board cards. The hole draw is the one that must
/// never reach the base layer at all — the board's is published deliberately at
/// settlement, but publishing the hole draw would hand every folded hand to
/// anyone reading Solana, which is the whole thing the two-seed split exists to
/// prevent. So the range checked here covers all of it.
const DECK_SECRETS: usize = DECK_CARDS_END + 1;
/// Board randomness, the seed derived from it, and the hole randomness: three
/// 32-byte values that must all read as zero before the deck can leave.
const DECK_SECRETS_END: usize = DECK_SECRETS + 96;
/// The five community cards sit immediately after, and clear to `0xFF` rather
/// than to zero, so they are checked separately.
const DECK_BOARD: usize = DECK_SECRETS_END;
const DECK_BOARD_END: usize = DECK_BOARD + 5;

fn assert_deck_publishable(info: &AccountInfo) -> Result<()> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= DECK_CARDS_END, PokerError::SeatOrderMismatch);
    require!(
        data[DECK_CARDS..DECK_CARDS_END].iter().all(|c| *c == NO_CARD),
        PokerError::HandInProgress
    );
    // Older decks stop before the seeds. Newer ones must have them wiped too.
    if data.len() >= DECK_SECRETS_END {
        require!(
            data[DECK_SECRETS..DECK_SECRETS_END].iter().all(|b| *b == 0),
            PokerError::HandInProgress
        );
    }
    if data.len() >= DECK_BOARD_END {
        require!(
            data[DECK_BOARD..DECK_BOARD_END].iter().all(|c| *c == NO_CARD),
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

/// Read a `Pubkey` field that sits at a fixed offset in a delegated account.
///
/// Used to bind the accounts of an undelegation to each other. Raw rather than
/// deserialized for the same reason the content checks are: an account written
/// by an older build must still be able to leave the rollup, and a table nobody
/// can exit is worse than one nobody can play.
fn table_field(info: &AccountInfo) -> Result<Pubkey> {
    let data = info.try_borrow_data()?;
    require!(data.len() >= 40, PokerError::SeatOrderMismatch);
    Pubkey::try_from(&data[8..40]).map_err(|_| error!(PokerError::SeatOrderMismatch))
}

/// Is a hand running at this table right now?
///
/// `Table::state` is the byte at offset 249 and has never moved; `vacate_seat`
/// reads it the same way and for the same reason. An account with no data has
/// already left the rollup, and no hand can be running without it, so that
/// counts as idle — which is what keeps a half-undelegated table recoverable
/// instead of stranding its seats.
fn assert_table_pda(info: &AccountInfo) -> Result<()> {
    if info.data_is_empty() {
        return Ok(());
    }
    assert_is::<Table>(info)?;
    let data = info.try_borrow_data()?;
    let table_id = u64::from_le_bytes(
        data[8..16]
            .try_into()
            .map_err(|_| error!(PokerError::SeatOrderMismatch))?,
    );
    let (expected, _) =
        Pubkey::find_program_address(&[TABLE_SEED, &table_id.to_le_bytes()], &crate::ID);
    require_keys_eq!(info.key(), expected, PokerError::TableMismatch);
    Ok(())
}

fn table_is_idle(info: &AccountInfo) -> Result<bool> {
    if info.data_is_empty() {
        return Ok(true);
    }
    let data = info.try_borrow_data()?;
    require!(data.len() >= 250, PokerError::SeatOrderMismatch);
    Ok(data[249] == 0)
}

/// Delegate the table, hand, and deck.
pub fn delegate_core(ctx: Context<DelegateCore>, table_id: u64) -> Result<()> {
    let validator = Some(ctx.accounts.validator.key());
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
    let validator = Some(ctx.accounts.validator.key());
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
    assert_is::<Deck>(&ctx.accounts.deck)?;

    // Bind the three accounts to one another before believing anything they
    // say. They arrive as bare `AccountInfo`s, so without this the content
    // check on the deck could be aimed at a decoy: pass the victim table's real
    // Table and Hand, and in the deck slot some other table's already-settled
    // deck. Every check passed, and the victim's Table and Hand were yanked
    // back to the base layer mid-hand while its deck, seats and hole cards
    // stayed on the rollup — a table split across two layers, unplayable and
    // unrecoverable, with the pot still on it. One cheap transaction, any
    // table, repeatable.
    assert_table_pda(&ctx.accounts.table)?;
    let table_key = ctx.accounts.table.key();
    require!(
        table_is_idle(&ctx.accounts.table)?,
        PokerError::HandInProgress
    );
    require_keys_eq!(
        table_field(&ctx.accounts.hand)?,
        table_key,
        PokerError::TableMismatch
    );
    require_keys_eq!(
        table_field(&ctx.accounts.deck)?,
        table_key,
        PokerError::TableMismatch
    );

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
    assert_is::<HoleCards>(&ctx.accounts.hole)?;

    // Same decoy problem as `undelegate_core`, and a worse consequence. Every
    // instruction that drives a hand takes all six seats as `mut`, so pulling
    // any one of them off the rollup freezes the table: nobody can act, nobody
    // can be timed out, the hand cannot settle, and `leave_table` needs a state
    // the table can no longer reach. A seat that is empty or not dealt in holds
    // `0xFF` cards all hand, so the content check alone waves it straight
    // through. Binding the pair to one table and refusing while a hand is live
    // is what closes it.
    assert_table_pda(&ctx.accounts.table)?;
    let seat_table = table_field(&ctx.accounts.seat)?;
    require_keys_eq!(
        table_field(&ctx.accounts.hole)?,
        seat_table,
        PokerError::TableMismatch
    );
    require_keys_eq!(
        ctx.accounts.table.key(),
        seat_table,
        PokerError::TableMismatch
    );
    require!(
        table_is_idle(&ctx.accounts.table)?,
        PokerError::HandInProgress
    );

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
    /// CHECK: the TEE validator, pinned on chain rather than by the client.
    ///
    /// The module header has always said the validator is pinned; until now the
    /// only thing pinning it was a constant in the web client, and this
    /// instruction is permissionless. Anyone could delegate a table nobody had
    /// started yet to a rollup of their choosing — or to none in particular by
    /// passing `None` — and every card in the game depends on the accounts
    /// landing inside the enclave. Now the program will not delegate anywhere
    /// else.
    #[account(address = TEE_VALIDATOR @ PokerError::ValidatorNotPinned)]
    pub validator: UncheckedAccount<'info>,
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
    /// CHECK: see `DelegateCore::validator`. Pinned on chain.
    #[account(address = TEE_VALIDATOR @ PokerError::ValidatorNotPinned)]
    pub validator: UncheckedAccount<'info>,
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
    /// CHECK: read raw, verified to be this program's Table PDA and to be the
    /// table the seat and hole account both name. Present so undelegation can
    /// refuse while a hand is live; an already-undelegated table reads as idle,
    /// which is what keeps a half-paused table recoverable.
    pub table: AccountInfo<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub seat: AccountInfo<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub hole: AccountInfo<'info>,
}
