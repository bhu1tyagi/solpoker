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

use session_keys::{Session, SessionTokenV2};

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

    // Existence is decided by whether the account has data, not by whether it
    // has lamports.
    //
    // Those are not the same thing here, and the difference cost a working
    // pause-and-restart. After a table goes off the rollup and comes back, its
    // permission account is still there — measured at 101 bytes — but carries
    // zero lamports. A `lamports() == 0` test reads that as "does not exist",
    // takes the create branch, and the permission program rejects creating an
    // account that already exists with `InvalidAccountData`. Every seat then
    // fails to secure, `start_hand` deals nobody in, and the table looks dead
    // for a reason nothing reports.
    if ctx.accounts.permission.data_is_empty() {
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

    // An empty seat must never be secured, and this one line is what makes the
    // per-seat deal gate in `start_hand` safe to have at all.
    //
    // A permission with `is_private = true` and no members is readable by
    // nobody, and — measured on devnet, not reasoned about — it is also
    // *updatable* by nobody, because updating it means loading the account and
    // the enclave refuses to load a private account for anyone outside its
    // member list. Lock a seat while it is empty and whoever sits there next
    // can never be named: not them, not the crank, not the creator. They are
    // dealt cards they cannot read, every hand, for the life of the table.
    //
    // The shipped client did exactly this to all six seats on every table it
    // started, and anyone could do it deliberately to a live table's empty
    // seats for a few lamports. Refusing here means a permission only ever
    // comes into existence naming somebody, so it is always updatable by that
    // somebody, and a seat changing hands is a permission that can be re-pointed
    // rather than one that is stranded.
    require!(ctx.accounts.seat.is_occupied(), PokerError::SeatEmpty);

    let table_key = ctx.accounts.hole.table;
    let bump = ctx.accounts.hole.bump;
    let signers: &[&[u8]] = &[HOLE_SEED, table_key.as_ref(), &[seat_index], &[bump]];

    if ctx.accounts.permission.data_is_empty() {
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

    // Exactly one member, always: the seat's current occupant. The empty-list
    // branch that used to live here is gone, along with the state it created.
    let members = vec![Member {
        flags: READ_FLAGS,
        pubkey: ctx.accounts.seat.occupant,
    }];

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

/// Hand the read right back, so the next player to take this seat can be named.
///
/// This is the way out of the dead chair. A hole-card permission names exactly
/// one member and only that member may update it, which is measured devnet
/// behaviour rather than a guess: the enclave refuses to load a private account
/// for anyone outside its member list, so the update transaction cannot even be
/// built. The permission also survives a table going off the rollup and coming
/// back. Put those together and a seat whose occupant changed while the table
/// was paused could never be re-secured — the new player was excluded from
/// every deal, permanently, on a table that otherwise looked fine.
///
/// The occupant is the one person who can fix that, because they are the member.
/// This drops the seat's permission back to public, which is safe precisely
/// because it happens when there are no cards to protect: the account holds
/// `0xFF` between hands, and `start_hand` will not deal to a seat until
/// `secure_hole` has pointed a fresh permission at whoever is sitting there.
/// Public and re-pointable beats private and stranded.
///
/// Signed by the occupant's wallet or their session key, so the client can do it
/// as part of standing up rather than asking for another prompt.
pub fn release_hole(ctx: Context<ReleaseHole>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    require!(
        ctx.accounts.seat.seat_index == seat_index
            && ctx.accounts.hole.seat_index == seat_index,
        PokerError::SeatOrderMismatch
    );
    // Only the player sitting here may give up their own read right.
    require_keys_eq!(
        ctx.accounts.seat.occupant,
        ctx.accounts.authority.key(),
        PokerError::NotSeated
    );
    // Never while cards are on the account. Between hands they are `0xFF`, and
    // making the permission public with a live hand on it would publish the
    // occupant's own cards to the table.
    require!(
        ctx.accounts.hole.cards.iter().all(|c| *c == NO_CARD),
        PokerError::HandInProgress
    );

    let table_key = ctx.accounts.hole.table;
    let bump = ctx.accounts.hole.bump;
    let signers: &[&[u8]] = &[HOLE_SEED, table_key.as_ref(), &[seat_index], &[bump]];

    // Nothing to release if the permission was never created. Same reasoning as
    // `secure_deck`: data, not lamports, says whether it exists.
    if ctx.accounts.permission.data_is_empty() {
        ctx.accounts.seat.cards_secured = false;
        return Ok(());
    }

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
            is_private: false,
            members: vec![],
        },
    }
    .invoke_signed(&[signers])?;

    ctx.accounts.seat.cards_secured = false;
    msg!("seat {} released its hole-card permission", seat_index);
    Ok(())
}

#[derive(Accounts, Session)]
#[instruction(seat_index: u8)]
pub struct ReleaseHole<'info> {
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
    /// Whoever pays: the player's wallet or their session key.
    pub payer: Signer<'info>,
    /// CHECK: the player this release is for, checked against the seat occupant
    /// and bound to `payer` by the session token when a session is used.
    pub authority: UncheckedAccount<'info>,
    #[session(signer = payer, authority = authority.key())]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
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
