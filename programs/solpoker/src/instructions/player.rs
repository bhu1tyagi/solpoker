//! Player accounts and the chip economy.
//!
//! Chips are backed one to one by USDC held in a token account the program's
//! vault PDA owns. They enter the system only through [`buy_chips`], which
//! moves USDC from the buyer into that account, and leave only through
//! [`sell_chips`], which pays it back out. The rate is fixed here in the
//! program, so the price of a chip is not a market and not a parameter anyone
//! can move — and because the deposit is a dollar stablecoin, a stack is worth
//! the same at the end of a session as it was at the start.
//!
//! There is no faucet. An unbacked chip would be a claim on someone else's
//! deposit, so nothing in this program may mint one. The vault's USDC balance
//! always covers every outstanding chip: buys add exactly what they mint, sells
//! burn exactly what they pay, and no other instruction touches either side of
//! that ledger.
//!
//! SOL still pays for gas, as it must — but it is no longer what a chip is
//! made of.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::errors::PokerError;
use crate::state::*;

/// The fixed price of one chip: one cent, in USDC's six-decimal base units.
///
/// A cent rather than a dime because rake is integer arithmetic on an integer
/// pot. At ten cents a chip, 2.5% of a twelve-chip pot was 0.3 chips, which
/// floors to nothing — so every pot under four dollars was raked zero and the
/// house's cut only appeared at stakes nobody was playing. A cent moves the
/// first raked chip down to a forty-cent pot and shrinks the rounding error to
/// less than a cent, without changing a single rule.
///
/// Changing this while any chip is outstanding changes what those chips redeem
/// for, so it can only ever move together with a fresh ledger or a deliberate
/// migration where every outstanding chip has been cashed out first.
pub const MICRO_USDC_PER_CHIP: u64 = 10_000;

/// USDC's decimal places. `transfer_checked` takes this and refuses if the mint
/// disagrees, which is a second lock on top of the address allowlist.
pub const USDC_DECIMALS: u8 = 6;

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

/// Buy chips with USDC, at the fixed rate.
///
/// The wallet signs and the USDC goes into the vault's token account, so every
/// chip minted here is fully backed the moment it exists.
pub fn buy_chips(ctx: Context<BuyChips>, chips: u64) -> Result<()> {
    require!(chips > 0, PokerError::IllegalAction);
    let micro_usdc = chips
        .checked_mul(MICRO_USDC_PER_CHIP)
        .ok_or(PokerError::InsufficientChips)?;

    // The token program would refuse this anyway; checking first turns a bare
    // 0x1 into an error the client can name.
    require!(
        ctx.accounts.buyer_ata.amount >= micro_usdc,
        PokerError::InsufficientUsdc
    );

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_ata.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        micro_usdc,
        USDC_DECIMALS,
    )?;

    let player = &mut ctx.accounts.player;
    player.chips = player
        .chips
        .checked_add(chips)
        .ok_or(PokerError::InsufficientChips)?;

    msg!(
        "{} bought {} chips for {} micro-USDC",
        player.authority,
        chips,
        micro_usdc
    );
    Ok(())
}

/// Sell chips back for USDC, at the same fixed rate.
///
/// Only chips sitting in the balance can be sold; chips on a seat have to be
/// cashed out of the table first, which keeps this instruction entirely on the
/// base layer and entirely out of the rollup's reach.
pub fn sell_chips(ctx: Context<SellChips>, chips: u64) -> Result<()> {
    require!(chips > 0, PokerError::IllegalAction);
    let player = &mut ctx.accounts.player;
    require!(player.chips >= chips, PokerError::InsufficientChips);

    let micro_usdc = chips
        .checked_mul(MICRO_USDC_PER_CHIP)
        .ok_or(PokerError::InsufficientChips)?;

    // A token account's rent is its own lamports, nothing to do with its
    // balance, so there is no floor to keep here: the only solvency question is
    // whether the vault holds the USDC. If this fires with honest accounting it
    // means chips exist that were never paid for, which is exactly the state
    // that must never be paid out of other people's deposits.
    require!(
        ctx.accounts.vault_ata.amount >= micro_usdc,
        PokerError::InsufficientVault
    );

    player.chips -= chips;

    let bump = ctx.bumps.vault;
    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_ata.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.seller_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[&[VAULT_SEED, &[bump]]],
        ),
        micro_usdc,
        USDC_DECIMALS,
    )?;

    msg!(
        "{} sold {} chips for {} micro-USDC",
        player.authority,
        chips,
        micro_usdc
    );
    Ok(())
}

/// Empty the pre-USDC SOL vault, once and for all.
///
/// Before the migration the same PDA held lamports and those lamports were what
/// a chip was worth. Afterwards the chips are backed by the token account and
/// the PDA's own balance backs nothing — it does not even need to be
/// rent-exempt to keep signing, because a PDA signs by its seeds. So this sends
/// the leftover home rather than leaving it stranded at an address nobody can
/// reach any other way.
///
/// Draining a system account to zero deletes it; a second call finds nothing
/// and stops on the guard below.
pub fn reclaim_legacy_vault(ctx: Context<ReclaimLegacyVault>) -> Result<()> {
    let lamports = ctx.accounts.vault.lamports();
    require!(lamports > 0, PokerError::InsufficientVault);

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

    msg!("reclaimed {} legacy lamports from the vault", lamports);
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
    /// CHECK: the custody authority. It holds no money itself any more; it owns
    /// the token account that does, and signs for it by its seeds.
    #[account(seeds = [VAULT_SEED], bump)]
    pub vault: AccountInfo<'info>,
    /// The one mint this cluster accepts. Anything else is refused here, before
    /// a single token moves.
    #[account(constraint = is_allowed_usdc_mint(&usdc_mint.key()) @ PokerError::WrongMint)]
    pub usdc_mint: Account<'info, Mint>,
    /// Where the backing lives: the vault's associated token account for that
    /// mint. The very first buy on a cluster creates it, and that buyer pays
    /// its rent — a couple of thousandths of a SOL, once, for everyone.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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
    /// CHECK: the same custody PDA, signing the payout out of its token account.
    #[account(seeds = [VAULT_SEED], bump)]
    pub vault: AccountInfo<'info>,
    #[account(constraint = is_allowed_usdc_mint(&usdc_mint.key()) @ PokerError::WrongMint)]
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
        associated_token::token_program = token_program,
    )]
    pub vault_ata: Account<'info, TokenAccount>,
    /// Recreated on the spot if the seller closed it. Getting your money out
    /// must never depend on having kept an account open.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = usdc_mint,
        associated_token::authority = authority,
        associated_token::token_program = token_program,
    )]
    pub seller_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReclaimLegacyVault<'info> {
    /// CHECK: the pre-USDC SOL vault, a bare system account being emptied for
    /// good. Nothing reads its data because it has none.
    #[account(mut, seeds = [VAULT_SEED], bump)]
    pub vault: AccountInfo<'info>,
    /// The house key, and only the house key: this moves money that was the
    /// operator's float, not any player's deposit.
    #[account(mut, address = TREASURY_AUTHORITY @ PokerError::NotTreasuryAuthority)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
