//! Compute-unit benchmark for `poker-engine`, measured on a real cluster.
//!
//! Native benchmarks say nothing about compute units, so this program runs the
//! engine inside the SBF VM and reports the actual CU each operation costs. It
//! exists only to produce a number for the Phase 1 gate, it is not part of the
//! game and never gets deployed to mainnet.
//!
//! Measurement works by bracketing the work with `sol_log_compute_units()`,
//! which emits `Program consumption: N units remaining`. The client subtracts
//! consecutive readings. Two back-to-back calls at the start measure the cost of
//! the instrumentation itself so it can be subtracted out.
//!
//! (`sol_remaining_compute_units()` would be tidier, it returns the value
//! directly, but that syscall fails to link on the devnet runtime, so the log
//! form is used instead.)
//!
//! Instruction data selects the workload:
//!
//! | byte 0 | workload                                                     |
//! |--------|--------------------------------------------------------------|
//! | 0      | instrumentation baseline only                                |
//! | 1      | one 7-card `evaluate`                                         |
//! | 2      | full 6-player showdown: 6 evaluates + pots + distribution     |
//! | 3      | one 52-card deterministic shuffle                            |

use core::hint::black_box;
use poker_engine::card::Deck;
use poker_engine::eval::evaluate;
use poker_engine::pots::{build_pots, distribute};
use poker_engine::{HandRank, MAX_SEATS};
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, log::sol_log_compute_units,
    msg, pubkey::Pubkey,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let mode = *instruction_data.first().unwrap_or(&0);

    // Readings 0 and 1 bracket nothing, so their difference is the cost of one
    // instrumentation call. Every later delta subtracts it.
    sol_log_compute_units();
    sol_log_compute_units();

    match mode {
        1 => {
            let mut cards = [0u8, 5, 9, 14, 22, 33, 47];
            if instruction_data.len() >= 8 {
                cards.copy_from_slice(&instruction_data[1..8]);
            }
            let rank = black_box(evaluate(black_box(&cards)));
            sol_log_compute_units();
            msg!("mode=1 evaluate_7cards rank={}", rank.0);
        }

        2 => {
            let mut seed = [0u8; 32];
            if instruction_data.len() >= 33 {
                seed.copy_from_slice(&instruction_data[1..33]);
            } else {
                seed[0] = 42;
            }

            // Deal outside the measured region: only settlement is timed.
            let deck = Deck::shuffled_from_seed(&seed);
            let mut hole = [[0u8; 2]; MAX_SEATS];
            for (i, h) in hole.iter_mut().enumerate() {
                *h = [deck.cards[i * 2], deck.cards[i * 2 + 1]];
            }
            let board = [
                deck.cards[20],
                deck.cards[21],
                deck.cards[22],
                deck.cards[23],
                deck.cards[24],
            ];
            // Three distinct all-in depths, so this exercises real side pots.
            let contributions = black_box([100u64, 300, 300, 500, 500, 500]);
            let folded = [false; MAX_SEATS];

            sol_log_compute_units(); // reading 2: start of measured region

            let mut ranks = [None::<HandRank>; MAX_SEATS];
            for seat in 0..MAX_SEATS {
                let seven = [
                    hole[seat][0],
                    hole[seat][1],
                    board[0],
                    board[1],
                    board[2],
                    board[3],
                    board[4],
                ];
                ranks[seat] = Some(evaluate(&seven));
            }
            let pots = build_pots(&contributions, &folded);
            let dist = black_box(distribute(&pots, &ranks, 0));

            sol_log_compute_units(); // reading 3: end of measured region
            msg!(
                "mode=2 showdown_6players pots={} unclaimed={} paid={}",
                pots.len(),
                dist.unclaimed,
                dist.total_paid()
            );
        }

        3 => {
            let mut seed = [0u8; 32];
            if instruction_data.len() >= 33 {
                seed.copy_from_slice(&instruction_data[1..33]);
            } else {
                seed[0] = 42;
            }
            let deck = black_box(Deck::shuffled_from_seed(black_box(&seed)));
            sol_log_compute_units();
            msg!("mode=3 shuffle52 first_card={}", deck.cards[0]);
        }

        _ => {
            msg!("mode=0 baseline only");
        }
    }

    Ok(())
}
