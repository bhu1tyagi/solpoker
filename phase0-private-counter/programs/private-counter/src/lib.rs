//! Phase 0 — prove the MagicBlock Private Ephemeral Rollup (TEE) pipe end to end.
//!
//! This reproduces the upstream `private-counter` example and adds one extra
//! instruction (`set_deck_privacy`) that exercises the exact permission shape
//! SolPoker's `Deck` account will need: `is_private = true` with an EMPTY member
//! list, i.e. readable by no wallet at all — only by program logic inside the
//! enclave. The upstream example never tests that combination (it always keeps
//! the authority as a member), so we validate it here before committing the
//! poker architecture to it.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::{
            CloseEphemeralPermissionCpi, CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi,
        },
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG,
            TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{commit, delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
};

declare_id!("E8bXPBMRqxoWys8TkZrAj4z4LNSkfndqGW2tgmkGZfzt");

pub const COUNTER_SEED: &[u8] = b"counter";

#[ephemeral]
#[program]
pub mod private_counter {
    use super::*;

    /// Initialize the counter on the base layer, pre-funding it with enough rent
    /// for the ephemeral permission account created on the ER after delegation.
    /// A delegated PDA cannot be topped up the normal way later, so this prefund
    /// is the only chance to cover permission rent.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.counter.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
        )?;

        let counter = &mut ctx.accounts.counter;
        counter.count = 0;
        counter.authority = ctx.accounts.authority.key();
        msg!(
            "PDA {} count: {} authority: {}",
            counter.key(),
            counter.count,
            counter.authority
        );
        Ok(())
    }

    /// Increment the counter. Runs on base layer before delegation, on the ER after.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.count += 1;
        if counter.count > 1000 {
            counter.count = 0;
        }
        msg!("PDA {} count: {}", counter.key(), counter.count);
        Ok(())
    }

    /// Delegate the counter to the pinned TEE ER validator. Permission setup
    /// happens separately on the ER via `init_permission`.
    pub fn delegate(ctx: Context<DelegateCounterPrivately>) -> Result<()> {
        if ctx.accounts.counter.owner != &ephemeral_rollups_sdk::id() {
            let validator = ctx.accounts.validator.as_ref();
            ctx.accounts.delegate_counter(
                &ctx.accounts.authority,
                &[COUNTER_SEED, ctx.accounts.authority.key().as_ref()],
                DelegateConfig {
                    validator: validator.map(|v| v.key()),
                    ..Default::default()
                },
            )?;
        } else {
            msg!("Counter already delegated");
        }
        Ok(())
    }

    /// Create the ephemeral permission directly on the ER. Payer is the counter
    /// PDA itself (delegated, carries its prefunded lamports onto the ER).
    /// Idempotent per the docs — skip if it already exists. Starts public.
    pub fn init_permission(ctx: Context<PermissionContext>) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            msg!("Permission already exists, skipping creation");
            return Ok(());
        }
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// Toggle privacy with the AUTHORITY retained as sole member — the
    /// `HoleCards` model (owner can read, everyone else is blocked).
    /// The member list is rebuilt on every call so the authority can never
    /// lock itself out.
    pub fn set_privacy(ctx: Context<PermissionContext>, is_private: bool) -> Result<()> {
        msg!("Toggling privacy to {} (authority retained as member)", is_private);
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        let members = if is_private {
            vec![Member {
                flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
                pubkey: ctx.accounts.counter.authority,
            }]
        } else {
            vec![]
        };
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.counter.to_account_info(),
            authority_is_signer: false, // PDA signs via seeds above
            args: EphemeralMembersArgs { is_private, members },
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// THE DECK MODEL — `is_private = true` with an EMPTY member list.
    ///
    /// Per the PER access-control docs: "If members field is set to empty list,
    /// the permissioned account is fully restricted and private. Only the owner
    /// of permissioned account can modify the permission."
    ///
    /// For SolPoker this is what makes the shuffled `Deck` dealer-only: no wallet,
    /// not even the table authority, can read it over the TEE RPC. The program can
    /// still mutate it (PDA-signed CPI), so the enclave remains the dealer and we
    /// are never locked out of turning privacy back off.
    ///
    /// Phase 0 must prove that even the authority is denied reads here. If the
    /// authority CAN still read, the Deck design has to change.
    pub fn set_deck_privacy(ctx: Context<PermissionContext>) -> Result<()> {
        msg!("Applying DECK model: is_private=true, members=[] (nobody can read)");
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        UpdateEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.counter.to_account_info(),
            authority_is_signer: false,
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![],
            },
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// Close the ephemeral permission on the ER, refunding rent to the counter PDA.
    pub fn close_permission(ctx: Context<PermissionContext>) -> Result<()> {
        let signers = [
            COUNTER_SEED,
            ctx.accounts.counter.authority.as_ref(),
            &[ctx.bumps.counter],
        ];
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.counter.to_account_info(),
            permissioned_account: ctx.accounts.counter.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.counter.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[&signers])?;
        Ok(())
    }

    /// Manual commit of counter state from the ER to the base layer.
    /// COMMIT AUDIT: commits `counter` only — a public u64 + authority pubkey.
    /// Contains no hidden information. (In SolPoker, Deck/HoleCards must never
    /// appear at a call site like this.)
    pub fn commit(ctx: Context<IncrementAndCommit>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Commit and undelegate in one atomic ER transaction.
    /// COMMIT AUDIT: same as `commit` — public counter state only.
    pub fn undelegate(ctx: Context<UndelegateCounter>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.counter.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + core::mem::size_of::<Counter>(),
        seeds = [COUNTER_SEED, authority.key().as_ref()],
        bump
    )]
    pub counter: Account<'info, Counter>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCounterPrivately<'info> {
    pub authority: Signer<'info>,
    /// CHECK: The counter PDA to delegate
    #[account(mut, del, seeds = [COUNTER_SEED, authority.key().as_ref()], bump)]
    pub counter: UncheckedAccount<'info>,
    /// CHECK: Checked by the delegate program; pinned to the TEE validator by the client
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.as_ref()], bump)]
    pub counter: Account<'info, Counter>,
}

/// Shared context for init_permission / set_privacy / set_deck_privacy /
/// close_permission — all run on the ER against the ephemeral permission.
#[derive(Accounts)]
pub struct PermissionContext<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [COUNTER_SEED, counter.authority.as_ref()],
        has_one = authority,
        bump
    )]
    pub counter: Account<'info, Counter>,
    /// CHECK: verified by permission program; seeds match the on-chain layout
    #[account(
        mut,
        seeds = [PERMISSION_SEED, counter.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Permission Program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Magic Program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct IncrementAndCommit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.as_ref()], bump)]
    pub counter: Account<'info, Counter>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateCounter<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COUNTER_SEED, counter.authority.as_ref()], bump)]
    pub counter: Account<'info, Counter>,
}

#[account]
pub struct Counter {
    pub count: u64,
    pub authority: Pubkey,
}
