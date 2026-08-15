//! SolPoker rules engine, chain-agnostic Texas Hold'em.
//!
//! This crate is deliberately free of Solana dependencies. Everything here is
//! plain deterministic Rust so it can be unit-tested, property-tested, and
//! fuzzed off-chain at full speed, then linked into the on-chain program
//! unchanged. Types mirror the on-chain account layouts (cards as `u8`, chips as
//! `u64`) so no conversion layer is needed.
//!
//! The three pieces:
//!
//! - [`card`], card encoding, deck, deterministic shuffle
//! - [`eval`], table-free 7-card hand evaluation
//! - [`betting`], betting round state machine and legal-action rules
//! - [`pots`], main and side pot construction and distribution
//!
//! Chips are play-money throughout. Nothing in this crate touches tokens,
//! lamports, or any transfer path.

pub mod betting;
pub mod card;
pub mod eval;
pub mod pots;

pub use card::{Card, Deck, NO_CARD};
pub use eval::{evaluate, evaluate_hand, Category, HandRank};

/// Maximum seats at a table. SolPoker v1 is 6-max.
pub const MAX_SEATS: usize = 6;
