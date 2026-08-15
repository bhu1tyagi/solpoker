//! Player accounts and the play-money faucet.
//!
//! Chips are play money by design and by hard constraint: the faucet is the only
//! way they enter the system, and there is no instruction anywhere in this program
//! that converts chips to SOL, to a token, or to anything else of value. Nothing
//! here touches a token program or moves lamports beyond ordinary rent.

use anchor_lang::prelude::*;

use crate::errors::PokerError;
use crate::state::*;

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

/// Grant the fixed daily chip allowance.
///
/// Deliberately permissionless in who may hold chips but rate-limited per player.
/// There is no purchase path, so this is the sole source of chips in the system.
pub fn claim_faucet(ctx: Context<ClaimFaucet>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let player = &mut ctx.accounts.player;

    require!(
        player.last_faucet_ts == 0 || now - player.last_faucet_ts >= FAUCET_COOLDOWN_SECS,
        PokerError::FaucetOnCooldown
    );

    player.chips = player
        .chips
        .checked_add(FAUCET_AMOUNT)
        .ok_or(PokerError::InsufficientChips)?;
    player.last_faucet_ts = now;

    msg!("faucet: +{} chips, balance {}", FAUCET_AMOUNT, player.chips);
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
pub struct ClaimFaucet<'info> {
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump,
        has_one = authority
    )]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}
