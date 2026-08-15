//! A worked three-way side-pot hand, played through the real engine.
//!
//! Three players with different stacks all get their chips in. Because they are
//! all-in for different amounts the pot splits into layers, and the short stack
//! can only win the part it could match.
//!
//!     cargo run --example three_way_side_pot

// Seat indices line up with bitmask positions, so indexed loops read
// better here than iterator adapters.
#![allow(clippy::needless_range_loop)]

use poker_engine::betting::{Action, Betting, Street};
use poker_engine::card::{card_to_string, cards_to_string, Deck};
use poker_engine::eval::evaluate;
use poker_engine::pots::{build_pots, distribute};
use poker_engine::{HandRank, MAX_SEATS};

fn main() {
    let mut stacks = [0u64; MAX_SEATS];
    stacks[0] = 100; // short stack
    stacks[1] = 300; // medium
    stacks[2] = 500; // covers everyone

    let starting_chips: u64 = stacks.iter().sum();
    let button = 2;

    println!("=== Three-way all-in at different stack depths ===\n");
    println!("  seat 0   stack {:>4}", stacks[0]);
    println!("  seat 1   stack {:>4}", stacks[1]);
    println!("  seat 2   stack {:>4}   (button)", stacks[2]);
    println!("  blinds 5/10\n");

    let mut b = Betting::begin_hand(stacks, button, 5, 10).unwrap();
    println!(
        "  seat 0 posts small blind 5, seat 1 posts big blind 10\n\
         --- preflop ---"
    );

    // Everyone shoves.
    while let Some(seat) = b.to_act {
        b.apply(seat, Action::AllIn).unwrap();
        println!(
            "  seat {seat} all-in for {:>4}  (total committed {:>4})",
            b.seats[seat].total_committed, b.seats[seat].total_committed
        );
    }

    // No one can act any more, so the board just runs out.
    while b.street != Street::Showdown {
        b.advance_street();
    }

    let contributions = b.contributions();
    println!("\n  contributions: {contributions:?}");
    println!("  total in the middle: {}", b.pot_total());

    // Deal a board and hole cards off a fixed deck so the output is stable.
    let deck = Deck::shuffled_from_seed(&[9u8; 32]);
    let hole = [
        [deck.cards[0], deck.cards[1]],
        [deck.cards[2], deck.cards[3]],
        [deck.cards[4], deck.cards[5]],
    ];
    let board = [
        deck.cards[10],
        deck.cards[11],
        deck.cards[12],
        deck.cards[13],
        deck.cards[14],
    ];

    println!("\n--- showdown ---");
    println!("  board: {}", cards_to_string(&board));

    let mut ranks = [None::<HandRank>; MAX_SEATS];
    for seat in 0..3 {
        let seven = [
            hole[seat][0],
            hole[seat][1],
            board[0],
            board[1],
            board[2],
            board[3],
            board[4],
        ];
        let r = evaluate(&seven);
        ranks[seat] = Some(r);
        println!(
            "  seat {seat}  {} {}   {}",
            card_to_string(hole[seat][0]),
            card_to_string(hole[seat][1]),
            r.describe()
        );
    }

    let pots = build_pots(&contributions, &b.folded());
    println!("\n--- pot layers ---");
    for (i, pot) in pots.iter().enumerate() {
        let label = if i == 0 {
            "main pot".to_string()
        } else {
            format!("side pot {i}")
        };
        println!(
            "  {label:<11} {:>4} chips   contested by seats {:?}",
            pot.amount,
            pot.eligible_seats()
        );
    }
    println!("  {:<11} {:>4}", "total", pots.total());

    let dist = distribute(&pots, &ranks, b.button);
    println!("\n--- settlement ---");
    for seat in 0..3 {
        let net = dist.payouts[seat] as i64 - contributions[seat] as i64;
        println!(
            "  seat {seat}  wins {:>4}   (put in {:>4}, net {:+})",
            dist.payouts[seat], contributions[seat], net
        );
    }

    let ending_chips: u64 = (0..MAX_SEATS)
        .map(|i| b.seats[i].stack + dist.payouts[i])
        .sum();
    println!("\n  unclaimed:      {}", dist.unclaimed);
    println!("  chips at start: {starting_chips}");
    println!("  chips at end:   {ending_chips}");
    assert_eq!(starting_chips, ending_chips, "chip conservation must hold");
    println!("  conserved:      yes");
}
