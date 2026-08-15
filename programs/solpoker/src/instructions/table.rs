//! Table creation and seat management.
//!
//! # Where chips are allowed to move
//!
//! Chip custody changes happen **only on the base layer, only while the table is
//! undelegated**. `join_table` moves chips from [`Player::chips`] into a seat
//! stack; `leave_table` moves them back. Both refuse to run once the table's PDAs
//! are delegated.
//!
//! That restriction is not incidental. [`Player`] is never delegated, so a single
//! instruction cannot write both a player's balance and a delegated seat, they
//! live on different layers. Forcing custody transitions through the base layer
//! gives a clean invariant: while a hand runs on the ER, chips may move *between*
//! seats but the total at the table cannot change, and player balances are
//! untouchable from inside the rollup.

use anchor_lang::prelude::*;

use crate::errors::PokerError;
use crate::state::*;

pub fn create_table(
    ctx: Context<CreateTable>,
    table_id: u64,
    small_blind: u64,
    big_blind: u64,
    min_buy_in: u64,
    max_buy_in: u64,
) -> Result<()> {
    require!(big_blind > 0 && small_blind > 0, PokerError::IllegalAction);
    require!(small_blind <= big_blind, PokerError::IllegalAction);
    require!(
        min_buy_in >= big_blind && max_buy_in >= min_buy_in,
        PokerError::BuyInOutOfRange
    );

    let config = &mut ctx.accounts.config;
    config.table_id = table_id;
    config.creator = ctx.accounts.creator.key();
    config.small_blind = small_blind;
    config.big_blind = big_blind;
    config.min_buy_in = min_buy_in;
    config.max_buy_in = max_buy_in;
    config.max_seats = MAX_SEATS as u8;
    config.bump = ctx.bumps.config;

    let table = &mut ctx.accounts.table;
    table.table_id = table_id;
    table.config = config.key();
    table.seats = [Table::EMPTY_SEAT; MAX_SEATS];
    table.button = 0;
    table.hand_number = 0;
    table.state = TableState::Waiting;
    table.bump = ctx.bumps.table;

    let hand = &mut ctx.accounts.hand;
    hand.table = table.key();
    hand.hand_number = 0;
    hand.street = 0;
    hand.board = [NO_CARD; 5];
    hand.current_bet = 0;
    hand.min_raise = 0;
    hand.to_act = NO_SEAT;
    hand.button = 0;
    hand.last_aggressor = NO_SEAT;
    hand.deadline = 0;
    hand.shuffle_seed = [0u8; 32];
    hand.bump = ctx.bumps.hand;

    let deck = &mut ctx.accounts.deck;
    deck.table = table.key();
    deck.cards = [NO_CARD; 52];
    deck.next_index = 0;
    deck.bump = ctx.bumps.deck;

    msg!(
        "table {} created: blinds {}/{}, buy-in {}..{}",
        table_id,
        small_blind,
        big_blind,
        min_buy_in,
        max_buy_in
    );
    Ok(())
}

/// Create one seat PDA for a table.
///
/// Split out from [`create_table`] because initialising all six seats alongside
/// the table, hand, and deck overflowed the 4KB BPF stack frame in Anchor's
/// generated `try_accounts` (4120 bytes against a 4096 limit), which surfaces at
/// runtime as a null-pointer access violation rather than a clean error.
///
/// Seats are created once and reused for the table's lifetime, so a seat address
/// is stable and never needs re-delegating as players come and go. Permissionless
/// and idempotent, so a client can safely retry.
pub fn create_seat(ctx: Context<CreateSeat>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );

    let table_key = ctx.accounts.table.key();
    let seat = &mut ctx.accounts.seat;

    // Already set up: leave it alone rather than wiping an occupied seat.
    if seat.table == table_key {
        return Ok(());
    }

    seat.table = table_key;
    seat.seat_index = seat_index;
    seat.occupant = Table::EMPTY_SEAT;
    seat.stack = 0;
    seat.reset_for_new_hand(false);
    seat.last_action_slot = 0;
    seat.bump = ctx.bumps.seat;
    Ok(())
}

/// Take a seat, moving `buy_in` chips from the player's balance to the seat stack.
pub fn join_table(ctx: Context<JoinTable>, seat_index: u8, buy_in: u64) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    // Custody moves only on the base layer. No explicit check is needed: while
    // the table is delegated its base-layer owner is the delegation program, so
    // Anchor's owner check on `Account<Table>` rejects this instruction outright.
    // On the ER the instruction fails too, because `Player` is never delegated
    // and so cannot be written there.

    let config = &ctx.accounts.config;
    require!(
        buy_in >= config.min_buy_in && buy_in <= config.max_buy_in,
        PokerError::BuyInOutOfRange
    );

    let authority = ctx.accounts.authority.key();
    require!(
        ctx.accounts.table.seat_of(&authority).is_none(),
        PokerError::AlreadySeated
    );
    require!(
        ctx.accounts.table.is_empty_seat(seat_index as usize),
        PokerError::SeatOccupied
    );

    let player = &mut ctx.accounts.player;
    require!(player.chips >= buy_in, PokerError::InsufficientChips);

    // The only place chips leave a player balance.
    player.chips -= buy_in;

    let seat = &mut ctx.accounts.seat;
    seat.occupant = authority;
    seat.stack = buy_in;
    seat.reset_for_new_hand(false);
    seat.last_action_slot = 0;

    ctx.accounts.table.seats[seat_index as usize] = authority;

    msg!(
        "player {} took seat {} with {} chips ({} left in balance)",
        authority,
        seat_index,
        buy_in,
        player.chips
    );
    Ok(())
}

/// Leave the table, returning the whole seat stack to the player's balance.
pub fn leave_table(ctx: Context<LeaveTable>, seat_index: u8) -> Result<()> {
    require!(
        (seat_index as usize) < MAX_SEATS,
        PokerError::SeatIndexOutOfRange
    );
    // See join_table: delegation state is enforced by account ownership.
    require!(
        ctx.accounts.table.state == TableState::Waiting,
        PokerError::HandInProgress
    );

    let authority = ctx.accounts.authority.key();
    let seat = &mut ctx.accounts.seat;
    require_keys_eq!(seat.occupant, authority, PokerError::NotSeated);

    let returned = seat.stack;
    let player = &mut ctx.accounts.player;
    player.chips = player
        .chips
        .checked_add(returned)
        .ok_or(PokerError::InsufficientChips)?;

    seat.occupant = Table::EMPTY_SEAT;
    seat.stack = 0;
    seat.reset_for_new_hand(false);

    ctx.accounts.table.seats[seat_index as usize] = Table::EMPTY_SEAT;

    msg!(
        "player {} left seat {} with {} chips (balance now {})",
        authority,
        seat_index,
        returned,
        player.chips
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(table_id: u64)]
pub struct CreateTable<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + TableConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, &table_id.to_le_bytes()],
        bump
    )]
    pub config: Account<'info, TableConfig>,
    #[account(
        init,
        payer = creator,
        space = 8 + Table::INIT_SPACE,
        seeds = [TABLE_SEED, &table_id.to_le_bytes()],
        bump
    )]
    pub table: Account<'info, Table>,

    #[account(
        init,
        payer = creator,
        space = 8 + Hand::INIT_SPACE,
        seeds = [HAND_SEED, table.key().as_ref()],
        bump
    )]
    pub hand: Account<'info, Hand>,
    #[account(
        init,
        payer = creator,
        space = 8 + Deck::INIT_SPACE,
        seeds = [DECK_SEED, table.key().as_ref()],
        bump
    )]
    pub deck: Account<'info, Deck>,

    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct CreateSeat<'info> {
    #[account(
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Seat::INIT_SPACE,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump
    )]
    pub seat: Account<'info, Seat>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Anchor resolves accounts in declaration order, so `table` must come before any
// account whose seeds reference `table.table_id`.
#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct JoinTable<'info> {
    #[account(
        mut,
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        seeds = [CONFIG_SEED, &table.table_id.to_le_bytes()],
        bump = config.bump
    )]
    pub config: Account<'info, TableConfig>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = seat.bump,
        constraint = seat.table == table.key() @ PokerError::SeatTableMismatch
    )]
    pub seat: Account<'info, Seat>,
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump,
        has_one = authority
    )]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(seat_index: u8)]
pub struct LeaveTable<'info> {
    #[account(
        mut,
        seeds = [TABLE_SEED, &table.table_id.to_le_bytes()],
        bump = table.bump
    )]
    pub table: Account<'info, Table>,
    #[account(
        mut,
        seeds = [SEAT_SEED, table.key().as_ref(), &[seat_index]],
        bump = seat.bump,
        constraint = seat.table == table.key() @ PokerError::SeatTableMismatch
    )]
    pub seat: Account<'info, Seat>,
    #[account(
        mut,
        seeds = [PLAYER_SEED, authority.key().as_ref()],
        bump = player.bump,
        has_one = authority
    )]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}
