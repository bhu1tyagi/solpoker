//! TEE privacy for the deck and hole cards.
//!
//! Two different permission shapes, for two different secrets:
//!
//! * The **deck** gets `is_private = true` with an empty member list, so no wallet
//!   can read it. Only program logic inside the enclave sees card order. This is
//!   what makes the enclave the dealer.
//! * Each **hole-card** account gets `is_private = true` with exactly one member,
//!   the seat's occupant. You can read your own cards and nobody else's.
//!
//! Permissions live on the rollup, not the base layer. The delegated account pays
//! its own permission rent and signs the CPI with its program seeds, which is why
//! both accounts are pre-funded when they are created.
//!
//! An empty member list still lets the program update the permission, so a table
//! can never lock itself out. Phase 0 measured this rather than assuming it.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::{
    instructions::{CreateEphemeralPermissionCpi, UpdateEphemeralPermissionCpi},
    structs::{
        EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG,
        TX_MESSAGE_FLAG,
    },
};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::errors::PokerError;
use crate::state::*;

/// Flags a member needs to actually read an account's state over the TEE RPC.
const READ_FLAGS: u8 = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;

/// Create the deck's permission and immediately lock it to nobody.
///
/// Idempotent, because clients retry rollup transactions.
pub fn secure_deck(ctx: Context<SecureDeck>) -> Result<()> {
    let table_key = ctx.accounts.deck.table;
    let signers: &[&[u8]] = &[DECK_SEED, table_key.as_ref(), &[ctx.accounts.deck.bump]];

    if ctx.accounts.permission.lamports() == 0 {
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.deck.to_account_info(),
            permissioned_account: ctx.accounts.deck.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[signers])?;
    }

    // Empty member list means nobody can read it, not even the table creator.
    UpdateEphemeralPermissionCpi {
        payer: ctx.accounts.deck.to_account_info(),
        permissioned_account: ctx.accounts.deck.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        authority: ctx.accounts.deck.to_account_info(),
        authority_is_signer: false,
        args: EphemeralMembersArgs {
            is_private: true,
            members: vec![],
        },
    }
    .invoke_signed(&[signers])?;

    // Record it, so start_hand can refuse a deck nobody locked.
    ctx.accounts.deck.secured = true;

    msg!("deck is now dealer-only");
    Ok(())
}

/// Create a seat's hole-card permission and restrict it to that seat's occupant.
///
/// Rebuilds the member list every call, so a seat changing hands hands the read
/// right over with it.
pub fn secure_hole(ctx: Context<SecureHole>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    require!(
        ctx.accounts.seat.seat_index == seat_index
            && ctx.accounts.hole.seat_index == seat_index,
        PokerError::SeatOrderMismatch
    );

    let table_key = ctx.accounts.hole.table;
    let bump = ctx.accounts.hole.bump;
    let signers: &[&[u8]] = &[HOLE_SEED, table_key.as_ref(), &[seat_index], &[bump]];

    if ctx.accounts.permission.lamports() == 0 {
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.hole.to_account_info(),
            permissioned_account: ctx.accounts.hole.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: false,
                members: vec![],
            },
        }
        .invoke_signed(&[signers])?;
    }

    // An empty seat has no reader, so it locks down completely.
    let members = if ctx.accounts.seat.is_occupied() {
        vec![Member {
            flags: READ_FLAGS,
            pubkey: ctx.accounts.seat.occupant,
        }]
    } else {
        vec![]
    };

    UpdateEphemeralPermissionCpi {
        payer: ctx.accounts.hole.to_account_info(),
        permissioned_account: ctx.accounts.hole.to_account_info(),
        permission: ctx.accounts.permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        authority: ctx.accounts.hole.to_account_info(),
        authority_is_signer: false,
        args: EphemeralMembersArgs {
            is_private: true,
            members,
        },
    }
    .invoke_signed(&[signers])?;

    // The permission now names whoever is in the seat right now. Any path that
    // changes that clears this again, so it can never vouch for a stale member.
    ctx.accounts.seat.cards_secured = true;

    msg!("seat {} hole cards restricted to its occupant", seat_index);
    Ok(())
}

#[derive(Accounts)]
pub struct SecureDeck<'info> {
    #[account(mut, seeds = [DECK_SEED, deck.table.as_ref()], bump = deck.bump)]
    pub deck: Account<'info, Deck>,
    /// CHECK: verified by the permission program; seeds match its layout
    #[account(
        mut,
        seeds = [PERMISSION_SEED, deck.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct SecureHole<'info> {
    #[account(mut, seeds = [HOLE_SEED, hole.table.as_ref(), &[seat_index]], bump = hole.bump)]
    pub hole: Account<'info, HoleCards>,
    #[account(mut, seeds = [SEAT_SEED, hole.table.as_ref(), &[seat_index]], bump = seat.bump)]
    pub seat: Account<'info, Seat>,
    /// CHECK: verified by the permission program; seeds match its layout
    #[account(
        mut,
        seeds = [PERMISSION_SEED, hole.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: verified by the magic program
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
}
