//! Recording finished hands on the base layer.
//!
//! A hand plays out entirely on the rollup, so nothing about it reaches Solana
//! unless we put it there. `commit_results` pushes the seat stacks and hand state
//! back and schedules a post-commit Magic Action that writes a digest of the hand
//! into a base-layer account. No separate user transaction and no relayer.
//!
//! Scheduling is not proof of execution. A Magic Action that fails is removed
//! from its transaction strategy and the commit is retried without it, so a
//! successful commit does not mean the action ran. Callers should read
//! `TableHistory` to confirm, which is why `hands_recorded` is a counter rather
//! than a flag.
//!
//! # The commit budget
//!
//! Every delegated account gets 10 free commits. A hundred-hand session that
//! committed after each hand would exhaust that in ten hands. So this is called
//! periodically rather than every hand, which is also what a real table wants:
//! play at rollup speed, settle to Solana on a slower cadence. Lifting the cap
//! properly needs the validator-scoped fee vault and a delegated fee payer.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{action, commit};
use ephemeral_rollups_sdk::ephem::{
    CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder,
};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

use crate::state::*;

/// Create the base-layer history account for a table. Idempotent.
pub fn create_history(ctx: Context<CreateHistory>) -> Result<()> {
    let table_key = ctx.accounts.table.key();
    let h = &mut ctx.accounts.history;
    if h.table == table_key {
        return Ok(());
    }
    h.table = table_key;
    h.hands_recorded = 0;
    h.last_hand_number = 0;
    h.last_result_hash = [0u8; 32];
    h.bump = ctx.bumps.history;
    Ok(())
}

/// Base-layer handler invoked by the post-commit action.
///
/// Takes the values as arguments rather than reading the committed hand account,
/// because the action may run before or after that account is readable depending
/// on strategy ordering.
pub fn record_hand_result(
    ctx: Context<RecordHandResult>,
    hand_number: u64,
    result_hash: [u8; 32],
) -> Result<()> {
    let h = &mut ctx.accounts.history;
    // Ignore replays and out-of-order deliveries rather than failing, since a
    // failing action would be stripped and silently retried without.
    if hand_number <= h.last_hand_number {
        msg!("hand {} already recorded, skipping", hand_number);
        return Ok(());
    }
    h.last_hand_number = hand_number;
    h.last_result_hash = result_hash;
    h.hands_recorded = h.hands_recorded.saturating_add(1);
    msg!("recorded hand {} on the base layer", hand_number);
    Ok(())
}

/// Commit table state from the rollup and record the last hand on Solana.
///
/// COMMIT AUDIT: commits `table` (seat map, button, hand number) and `hand`
/// (street, board, betting state, result hash). Neither holds live card data:
/// the board is public by definition and settlement zeroizes the deck and hole
/// cards, which are not committed here at all.
pub fn commit_results(ctx: Context<CommitResults>) -> Result<()> {
    let hand_number = ctx.accounts.hand.hand_number;
    let result_hash = ctx.accounts.hand.result_hash;

    let data = anchor_lang::InstructionData::data(&crate::instruction::RecordHandResult {
        hand_number,
        result_hash,
    });

    let action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![ShortAccountMeta {
            pubkey: ctx.accounts.history.key().to_bytes().into(),
            is_writable: true,
        }],
        args: ActionArgs::new(data),
        escrow_authority: ctx.accounts.payer.to_account_info(),
        compute_units: 50_000,
    };

    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit(&[
        ctx.accounts.table.to_account_info(),
        ctx.accounts.hand.to_account_info(),
    ])
    .add_post_commit_actions([action])
    .build_and_invoke()?;

    msg!("committed through hand {}", hand_number);
    Ok(())
}

#[derive(Accounts)]
pub struct CreateHistory<'info> {
    #[account(seeds = [TABLE_SEED, &table.table_id.to_le_bytes()], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + TableHistory::INIT_SPACE,
        seeds = [HISTORY_SEED, table.key().as_ref()],
        bump
    )]
    pub history: Account<'info, TableHistory>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[action]
#[derive(Accounts)]
pub struct RecordHandResult<'info> {
    #[account(mut, seeds = [HISTORY_SEED, history.table.as_ref()], bump = history.bump)]
    pub history: Account<'info, TableHistory>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitResults<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: delegated PDA being committed
    #[account(mut)]
    pub table: AccountInfo<'info>,
    #[account(mut)]
    pub hand: Box<Account<'info, Hand>>,
    /// CHECK: base-layer account written by the scheduled action
    pub history: UncheckedAccount<'info>,
    /// CHECK: destination program for the action, required in the outer context
    #[account(address = crate::ID)]
    pub program_id: UncheckedAccount<'info>,
}
