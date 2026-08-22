//! Player accounts and the chip economy.
//!
//! Chips are backed one to one by lamports in a program vault. They enter the
//! system only through [`buy_chips`], which moves SOL from the buyer into the
//! vault, and leave only through [`sell_chips`], which pays SOL back out. The
//! rate is fixed here in the program, so the price of a chip is not a market
//! and not a parameter anyone can move.
//!
//! There is no faucet. An unbacked chip would be a claim on someone else's
//! deposit, so nothing in this program may mint one. The vault's lamports,
//! minus a small rent floor, always cover every outstanding chip: buys add
//! exactly what they mint, sells burn exactly what they pay, and no other
//! instruction touches either side of that ledger.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::errors::PokerError;
use crate::state::*;

/// The fixed price of one chip: 1 SOL buys exactly 1,000 chips, so a chip is
/// 0.001 SOL and the smallest blind is real but not frightening. Changing this
/// while any chip is outstanding changes what those chips redeem for, so it
/// can only ever move together with a fresh ledger or a deliberate migration.
pub const LAMPORTS_PER_CHIP: u64 = 1_000_000;

/// Lamports the vault always keeps, so the account stays rent-exempt and
/// cannot be closed out from under the players by an exact-drain sell.
pub const VAULT_FLOOR_LAMPORTS: u64 = 2_000_000;

pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
    let player = &mut ctx.accounts.player;
    player.authority = ctx.accounts.authority.key();
    player.chips = 0;
    player.last_faucet_ts = 0;
    player.hands_played = 0;
    player.bump = ctx.bumps.player;
    msg!("player {} initialized", player.authority);
    Ok(())
}

/// Move a table's accrued rake into the treasury's balance.
///
/// Rake is taken at settlement, which runs on the rollup, where a base-layer
/// [`Player`] balance cannot be written. So it waits on the table until the
/// table is back on Solana, and this moves it the rest of the way.
///
/// Permissionless on purpose. The destination is fixed — the only account this
/// will credit is the treasury's, checked against [`TREASURY_AUTHORITY`] — so
/// there is nothing for a caller to gain by running it and no reason to make
/// the house the only one who can. Anyone tidying a table can sweep it.
///
/// No chip is created here. It left the seats at settlement and it lands in a
/// balance now, backed by the same vault lamports the whole way.
pub fn sweep_rake(ctx: Context<SweepRake>) -> Result<()> {
    // Delegation state is enforced by ownership, as everywhere else that
    // touches custody: while the table is on the rollup its base-layer owner is
    // the delegation program, so `Account<Table>` rejects this outright.
    require_keys_eq!(
        ctx.accounts.treasury.authority,
        TREASURY_AUTHORITY,
        PokerError::NotTableCreator
    );

    let amount = ctx.accounts.table.rake_accrued;
    require!(amount > 0, PokerError::InsufficientChips);

    ctx.accounts.treasury.chips = ctx
        .accounts
        .treasury
        .chips
        .checked_add(amount)
        .ok_or(PokerError::InsufficientChips)?;
    ctx.accounts.table.rake_accrued = 0;

    msg!("swept {} chips of rake to the treasury", amount);
    Ok(())
}

/// Buy chips with SOL, at the fixed rate.
///
/// The wallet signs and the lamports go into the vault, so every chip minted
/// here is fully backed the moment it exists.
pub fn buy_chips(ctx: Context<BuyChips>, chips: u64) -> Result<()> {
    require!(chips > 0, PokerError::IllegalAction);
    let lamports = chips
        .checked_mul(LAMPORTS_PER_CHIP)
        .ok_or(PokerError::InsufficientChips)?;

    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        lamports,
    )?;

    let player = &mut ctx.accounts.player;
    player.chips = player
        .chips
        .checked_add(chips)
        .ok_or(PokerError::InsufficientChips)?;

    msg!(
        "{} bought {} chips for {} lamports",
        player.authority,
        chips,
        lamports
    );
    Ok(())
}

/// Sell chips back for SOL, at the same fixed rate.
///
/// Only chips sitting in the balance can be sold; chips on a seat have to be
/// cashed out of the table first, which keeps this instruction entirely on the
/// base layer and entirely out of the rollup's reach.
pub fn sell_chips(ctx: Context<SellChips>, chips: u64) -> Result<()> {
    require!(chips > 0, PokerError::IllegalAction);
    let player = &mut ctx.accounts.player;
    require!(player.chips >= chips, PokerError::InsufficientChips);

    let lamports = chips
        .checked_mul(LAMPORTS_PER_CHIP)
        .ok_or(PokerError::InsufficientChips)?;

    // The floor keeps the vault alive. If this fires with honest accounting it
    // means chips exist that were never paid for, which is exactly the state
    // that must never be paid out of other people's deposits.
    let vault_lamports = ctx.accounts.vault.lamports();
    require!(
        vault_lamports >= lamports.saturating_add(VAULT_FLOOR_LAMPORTS),
        PokerError::InsufficientVault
    );

    player.chips -= chips;

    let bump = ctx.bumps.vault;
    transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.authority.to_account_info(),
            },
            &[&[VAULT_SEED, &[bump]]],
        ),
        lamports,
    )?;

    msg!(
        "{} sold {} chips for {} lamports",
        player.authority,
        chips,
        lamports
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Player::INIT_SPACE,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SweepRake<'info> {
    #[account(
        mut,
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    /// The house's own balance, and the only account this can credit.
    #[account(
        mut,
        seeds = [PLAYER_SEED, TREASURY_AUTHORITY.as_ref()],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, Player>,
    /// Anyone at all: the destination is fixed, so there is nothing to gain.
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyChips<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,
    /// CHECK: a system-owned PDA that only ever holds lamports. Its address is
    /// the guarantee; it has no data to check.
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellChips<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,
    /// CHECK: the same vault, paying back out under its own signature.
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: AccountInfo<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
