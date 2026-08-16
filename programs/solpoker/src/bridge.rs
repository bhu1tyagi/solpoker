//! Bridge between on-chain accounts and the `poker-engine` state machine.
//!
//! The engine owns all the rules; these accounts are only storage. Every
//! instruction that touches betting loads the accounts into a
//! [`poker_engine::betting::Betting`], lets the engine decide what is legal and
//! what happens, then writes the result straight back. No poker rule is
//! reimplemented here. That is the point of keeping the engine a separate,
//! property-tested crate.
//!
//! `Seat::in_hand` maps to the engine's `occupied`, not `Seat::occupant`. A player
//! who sits down mid-hand holds the seat but is not in the hand, and the engine
//! must not deal them action.

use anchor_lang::prelude::*;
use poker_engine::betting::{Betting, SeatState, Street};

use crate::state::*;

pub fn street_to_u8(s: Street) -> u8 {
    match s {
        Street::PreFlop => 0,
        Street::Flop => 1,
        Street::Turn => 2,
        Street::River => 3,
        Street::Showdown => 4,
    }
}

pub fn street_from_u8(v: u8) -> Street {
    match v {
        0 => Street::PreFlop,
        1 => Street::Flop,
        2 => Street::Turn,
        3 => Street::River,
        _ => Street::Showdown,
    }
}

/// Rebuild the engine's view of the hand from stored accounts.
pub fn load_betting(hand: &Hand, seats: &[&Seat; MAX_SEATS], config: &TableConfig) -> Betting {
    let mut b = Betting {
        seats: [SeatState::default(); MAX_SEATS],
        button: hand.button as usize,
        street: street_from_u8(hand.street),
        to_act: if hand.to_act == NO_SEAT {
            None
        } else {
            Some(hand.to_act as usize)
        },
        current_bet: hand.current_bet,
        min_raise: hand.min_raise,
        small_blind: config.small_blind,
        big_blind: config.big_blind,
        last_aggressor: if hand.last_aggressor == NO_SEAT {
            None
        } else {
            Some(hand.last_aggressor as usize)
        },
    };

    for (i, seat) in seats.iter().enumerate() {
        b.seats[i] = SeatState {
            occupied: seat.in_hand,
            stack: seat.stack,
            street_committed: seat.committed_street,
            total_committed: seat.committed_total,
            folded: seat.folded,
            all_in: seat.all_in,
            needs_action: seat.needs_action,
            may_raise: seat.may_raise,
        };
    }
    b
}

/// Write the engine's state back into the accounts.
pub fn store_betting(b: &Betting, hand: &mut Hand, seats: &mut [&mut Seat; MAX_SEATS]) {
    hand.street = street_to_u8(b.street);
    hand.current_bet = b.current_bet;
    hand.min_raise = b.min_raise;
    hand.to_act = b.to_act.map(|s| s as u8).unwrap_or(NO_SEAT);
    hand.button = b.button as u8;
    hand.last_aggressor = b.last_aggressor.map(|s| s as u8).unwrap_or(NO_SEAT);

    for (i, seat) in seats.iter_mut().enumerate() {
        let s = &b.seats[i];
        seat.stack = s.stack;
        seat.committed_street = s.street_committed;
        seat.committed_total = s.total_committed;
        seat.folded = s.folded;
        seat.all_in = s.all_in;
        seat.needs_action = s.needs_action;
        seat.may_raise = s.may_raise;
        seat.in_hand = s.occupied;
    }
}

/// Collect the six seat accounts in index order, rejecting a mismatched set.
///
/// Seat accounts are passed positionally, so this verifies each one is the PDA it
/// claims to be for its slot. Without this a caller could swap two seats and have
/// the engine act on the wrong stacks.
pub fn check_seat_order(seats: &[&Seat; MAX_SEATS], table: &Pubkey) -> Result<()> {
    for (i, seat) in seats.iter().enumerate() {
        require_keys_eq!(
            seat.table,
            *table,
            crate::errors::PokerError::SeatTableMismatch
        );
        require!(
            seat.seat_index as usize == i,
            crate::errors::PokerError::SeatOrderMismatch
        );
    }
    Ok(())
}

/// Reject a config account that belongs to some other table.
///
/// Three instructions take a config without being able to constrain it the way
/// `StartHand` and `SettleHand` do with `address = table.config`: they never load
/// the table, because `Table` carries a 192-byte seat map and adding it to a
/// context that already holds six seats overflows the BPF stack frame. That left
/// the account entirely unchecked, and a config is not inert data. It carries the
/// blinds the engine computes the minimum raise from, and the action timeout that
/// becomes the turn clock, so anyone could create a table with a one-second
/// timeout, pass its config while acting at someone else's table, and then time
/// every opponent out before they could physically respond.
///
/// A config's `table_id` is fixed at creation and is the seed of its own PDA, so
/// re-deriving the table address from it proves the pair belong together without
/// loading the table itself. Same self-derivation trick as [`check_seat_order`].
pub fn check_config(config: &TableConfig, table: &Pubkey) -> Result<()> {
    let (expected_table, _) = Pubkey::find_program_address(
        &[TABLE_SEED, &config.table_id.to_le_bytes()],
        &crate::ID,
    );
    require_keys_eq!(
        expected_table,
        *table,
        crate::errors::PokerError::ConfigTableMismatch
    );
    Ok(())
}

/// Borrow the six seat accounts of a context as an ordered array.
///
/// Anchor exposes each seat as its own field, and Rust allows disjoint mutable
/// borrows of distinct struct fields, so this is just a readability wrapper.
#[macro_export]
macro_rules! seats_ref {
    ($accounts:expr) => {
        [
            &*$accounts.seat_0,
            &*$accounts.seat_1,
            &*$accounts.seat_2,
            &*$accounts.seat_3,
            &*$accounts.seat_4,
            &*$accounts.seat_5,
        ]
    };
}

#[macro_export]
macro_rules! seats_mut {
    ($accounts:expr) => {
        [
            &mut *$accounts.seat_0,
            &mut *$accounts.seat_1,
            &mut *$accounts.seat_2,
            &mut *$accounts.seat_3,
            &mut *$accounts.seat_4,
            &mut *$accounts.seat_5,
        ]
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_for(table_id: u64) -> TableConfig {
        TableConfig {
            table_id,
            creator: Pubkey::default(),
            small_blind: 50,
            big_blind: 100,
            min_buy_in: 1_000,
            max_buy_in: 10_000,
            max_seats: MAX_SEATS as u8,
            action_timeout_secs: 30,
            bump: 255,
        }
    }

    fn table_pda(table_id: u64) -> Pubkey {
        Pubkey::find_program_address(&[TABLE_SEED, &table_id.to_le_bytes()], &crate::ID).0
    }

    #[test]
    fn accepts_the_config_of_its_own_table() {
        assert!(check_config(&config_for(7), &table_pda(7)).is_ok());
    }

    /// The attack this check exists for.
    ///
    /// `player_action`, `advance_street` and `force_timeout` all write
    /// `now + config.action_timeout_secs` into the hand's deadline, and none of
    /// them load the table, so before this the config was accepted unchecked.
    /// Anyone could create a table with a one-second timeout, pass its config
    /// while acting at someone else's table, and then call the permissionless
    /// `force_timeout` on each opponent in turn before they could physically
    /// respond, taking every pot uncontested.
    #[test]
    fn rejects_a_config_belonging_to_another_table() {
        let attacker_config = config_for(1);
        let victim_table = table_pda(2);
        assert!(check_config(&attacker_config, &victim_table).is_err());
    }

    #[test]
    fn rejects_a_config_for_every_other_table_id() {
        let victim_table = table_pda(42);
        for other in [0u64, 1, 41, 43, u64::MAX] {
            assert!(
                check_config(&config_for(other), &victim_table).is_err(),
                "config for table {other} was accepted at table 42",
            );
        }
    }
}
