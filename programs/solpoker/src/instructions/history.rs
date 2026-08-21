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
/// A hand number further ahead than this is not a late delivery, it is garbage.
///
/// The counter only has to survive gaps left by the commit budget, which is ten
/// commits per delegation cycle, so any real jump is small. The cap exists
/// because `last_hand_number` only ever moves forward: one absurd value would
/// make every later hand look like a replay and stop recording for the life of
/// the table, with no instruction able to undo it.
///
/// Be clear about what this does and does not buy. Since this instruction has
/// no caller authentication (see [`RecordHandResult`]), it turns "one cheap
/// transaction permanently bricks a table's history" into "brick it by a bounded
/// amount per transaction, repeatedly". That is a real reduction in a one-shot
/// attack and no defence at all against a determined one. It is a stopgap until
/// the arguments stop being trusted.
pub const MAX_HAND_ADVANCE: u64 = 100;

pub fn record_hand_result(
    ctx: Context<RecordHandResult>,
    hand_number: u64,
    result_hash: [u8; 32],
) -> Result<()> {
    // Nothing below ever returns `Err`. A Magic Action that fails is stripped
    // from its transaction strategy and the commit is retried without it, so a
    // refusal that fails loudly would silently disable history for the table
    // instead of protecting it. Every rejection here is a quiet `Ok`.

    // --- the arguments are no longer trusted ------------------------------
    //
    // This instruction still has no caller authentication and still cannot get
    // any: `#[action]` supplies two `UncheckedAccount`s and nothing else, and
    // declaring the escrow a `Signer` was measured on devnet to stop every
    // action landing. So instead of authenticating the caller, this
    // authenticates the *claim*: the base-layer `Hand` PDA for this history's
    // own table is passed through the action's account list, and only values
    // that already match it are recorded.
    //
    // An attacker can therefore write nothing that is not already true on
    // chain. The cost is a skipped record when the action runs ahead of its
    // commit and the account still holds the previous hand, which is precisely
    // the case `hands_recorded` is a counter rather than a flag for.
    let table = ctx.accounts.history.table;
    let (expected_hand, _) =
        Pubkey::find_program_address(&[HAND_SEED, table.as_ref()], &crate::ID);
    if ctx.accounts.hand.key() != expected_hand {
        msg!("hand account is not this table's hand, ignoring");
        return Ok(());
    }

    // Read it raw rather than as `Account<Hand>`. While the table is delegated
    // the base-layer hand is owned by the delegation program, so Anchor's owner
    // check would reject it and take the whole action down with it.
    // `try_deserialize` still checks the discriminator, and the address above
    // proves whose account it is.
    let on_chain = {
        let data = ctx.accounts.hand.try_borrow_data()?;
        match Hand::try_deserialize(&mut &data[..]) {
            Ok(h) => h,
            Err(_) => {
                msg!("hand account is not readable yet, skipping");
                return Ok(());
            }
        }
    };
    if on_chain.hand_number != hand_number || on_chain.result_hash != result_hash {
        msg!(
            "claimed hand {} does not match the committed hand {}, ignoring",
            hand_number,
            on_chain.hand_number
        );
        return Ok(());
    }

    let h = &mut ctx.accounts.history;
    // Ignore replays and out-of-order deliveries rather than failing, since a
    // failing action would be stripped and silently retried without.
    if hand_number <= h.last_hand_number {
        msg!("hand {} already recorded, skipping", hand_number);
        return Ok(());
    }
    // Same reasoning for a number from the far future: refuse it, but refuse it
    // quietly, so a single malformed delivery cannot strip the action either.
    if hand_number > h.last_hand_number.saturating_add(MAX_HAND_ADVANCE) {
        msg!("hand {} is implausibly far ahead, ignoring", hand_number);
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

    // The account list the action runs with is built here, by the program, from
    // accounts this instruction has already constrained — which is the only
    // reason `record_hand_result` can authenticate anything at all. `hand` is
    // the same address on both layers, so passing its key gives the base-layer
    // handler the committed copy to check the claim against.
    let action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            ShortAccountMeta {
                pubkey: ctx.accounts.history.key().to_bytes().into(),
                is_writable: true,
            },
            ShortAccountMeta {
                pubkey: ctx.accounts.hand.key().to_bytes().into(),
                is_writable: false,
            },
        ],
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

/// # This instruction has no caller authentication, and cannot yet get any
///
/// `#[action]` appends `escrow_auth` and `escrow`, both as `UncheckedAccount`,
/// and nothing else about the caller is available. So anyone can invoke this
/// directly with two arbitrary addresses and write into any table's history.
///
/// The SDK documents `escrow` as "a `signer` in callback", which would be
/// exactly the authentication needed. It is not one in practice: declaring it
/// `Signer<'info>` compiles, deploys, and then silently stops every Magic
/// Action from landing, because a failing action is stripped from its
/// transaction strategy and the commit is retried without it. That was measured
/// on devnet, not reasoned about, and it is why this is back to `UncheckedAccount`.
///
/// That is still true, and it no longer matters, because the caller no longer
/// gets to decide what is written. `commit_results` builds this action's own
/// account list, so it can hand over the base-layer `Hand` PDA alongside the
/// history, and the handler records only values that already match it. An
/// unauthenticated caller can still invoke this all day; the worst they can
/// achieve is writing something that was already true.
#[action]
#[derive(Accounts)]
pub struct RecordHandResult<'info> {
    #[account(mut, seeds = [HISTORY_SEED, history.table.as_ref()], bump = history.bump)]
    pub history: Account<'info, TableHistory>,
    /// CHECK: address re-derived from `history.table` in the handler, and read
    /// raw. It cannot be `Account<'info, Hand>`: while the table is delegated
    /// this account is owned by the delegation program, so Anchor's owner check
    /// would reject it and the action would be stripped rather than refused.
    pub hand: UncheckedAccount<'info>,
}

// Declaration order matters: Anchor resolves accounts in the order they appear,
// so `hand` has to come before anything whose seeds mention `hand.table`.
#[commit]
#[derive(Accounts)]
pub struct CommitResults<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub hand: Box<Account<'info, Hand>>,
    /// CHECK: delegated PDA being committed, bound to the hand it belongs to.
    #[account(mut, address = hand.table @ crate::errors::PokerError::TableMismatch)]
    pub table: AccountInfo<'info>,
    /// CHECK: base-layer account written by the scheduled action. Derived from
    /// the hand's own table so a commit at one table cannot aim its action at
    /// another table's history.
    #[account(seeds = [HISTORY_SEED, hand.table.as_ref()], bump)]
    pub history: UncheckedAccount<'info>,
    /// CHECK: destination program for the action, required in the outer context
    #[account(address = crate::ID)]
    pub program_id: UncheckedAccount<'info>,
}
