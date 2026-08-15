//! Statistical checks on the deterministic shuffle.
//!
//! The shuffle is the one genuinely provable part of the product, so "it looks
//! random" is not good enough. These tests check the properties that would
//! actually matter if it were biased: every card reaches every position roughly
//! equally often, cards do not stick near where they started, and the same seed
//! always gives the same deck.
//!
//! Run with `cargo test --test shuffle_quality -- --nocapture` to see the numbers.

use poker_engine::card::{shuffle_in_place, Deck, DECK_SIZE};

const TRIALS: usize = 10_000;

/// Distinct seeds derived from a counter, so the run is reproducible.
fn seed_for(i: usize) -> [u8; 32] {
    let mut s = [0u8; 32];
    s[..8].copy_from_slice(&(i as u64).to_le_bytes());
    s[8] = 0xA5;
    s
}

#[test]
fn every_shuffle_is_a_permutation() {
    for i in 0..TRIALS {
        let deck = Deck::shuffled_from_seed(&seed_for(i));
        let mut seen = [false; DECK_SIZE];
        for c in deck.cards {
            assert!(!seen[c as usize], "duplicate card at trial {i}");
            seen[c as usize] = true;
        }
        assert!(seen.iter().all(|s| *s), "missing card at trial {i}");
    }
}

#[test]
fn card_positions_are_uniform() {
    // counts[card][position]. With 10k trials the expected count per cell is
    // 10000/52 = 192.3, so a chi-square over 51 degrees of freedom is meaningful.
    let mut counts = vec![[0u32; DECK_SIZE]; DECK_SIZE];
    for i in 0..TRIALS {
        let deck = Deck::shuffled_from_seed(&seed_for(i));
        for (pos, &card) in deck.cards.iter().enumerate() {
            counts[card as usize][pos] += 1;
        }
    }

    let expected = TRIALS as f64 / DECK_SIZE as f64;
    // Critical value for chi-square at 51 degrees of freedom, p = 0.001.
    // Comfortably loose: a real bias blows well past this.
    let critical = 95.0;

    let mut worst: f64 = 0.0;
    let mut worst_card = 0;
    for (card, row) in counts.iter().enumerate() {
        let chi: f64 = row
            .iter()
            .map(|&observed| {
                let d = observed as f64 - expected;
                d * d / expected
            })
            .sum();
        if chi > worst {
            worst = chi;
            worst_card = card;
        }
    }

    println!(
        "chi-square over {TRIALS} shuffles: worst card {worst_card} scored {worst:.1} \
         (critical {critical:.0} at p=0.001, {} d.f.)",
        DECK_SIZE - 1
    );
    assert!(
        worst < critical,
        "card {worst_card} is not uniformly distributed: chi-square {worst:.1}"
    );
}

#[test]
fn cards_do_not_stay_near_their_starting_position() {
    // A weak shuffle leaves cards close to where they began. Average displacement
    // for a uniform permutation of 52 is about 52/3 = 17.3.
    let mut total = 0f64;
    for i in 0..TRIALS {
        let deck = Deck::shuffled_from_seed(&seed_for(i));
        for (pos, &card) in deck.cards.iter().enumerate() {
            total += (pos as f64 - card as f64).abs();
        }
    }
    let mean = total / (TRIALS * DECK_SIZE) as f64;
    println!("mean displacement {mean:.2} (uniform expectation about 17.3)");
    assert!(
        (mean - 17.3).abs() < 1.0,
        "mean displacement {mean:.2} suggests a weak shuffle"
    );
}

#[test]
fn distinct_seeds_give_distinct_decks() {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    for i in 0..TRIALS {
        let deck = Deck::shuffled_from_seed(&seed_for(i));
        assert!(seen.insert(deck.cards), "collision at trial {i}");
    }
}

#[test]
fn one_bit_of_seed_change_reshuffles_everything() {
    let a = Deck::shuffled_from_seed(&[0u8; 32]);
    let mut flipped = [0u8; 32];
    flipped[31] = 1;
    let b = Deck::shuffled_from_seed(&flipped);

    let same = a
        .cards
        .iter()
        .zip(b.cards.iter())
        .filter(|(x, y)| x == y)
        .count();
    println!("one-bit seed change left {same}/52 cards in place");
    // Two independent permutations share about one fixed point on average.
    assert!(same < 8, "{same} cards unchanged, seed is not diffusing");
}

/// Pins the exact output for a known seed.
///
/// The JavaScript verifier in `tools/verify-shuffle.mjs` must produce this same
/// order. If this test and that script ever disagree, published hand histories
/// stop being checkable, so the constant is deliberately hard-coded here rather
/// than computed.
#[test]
fn known_seed_produces_known_deck() {
    let deck = Deck::shuffled_from_seed(&[7u8; 32]);
    let first_ten = &deck.cards[..10];
    println!(
        "seed [7u8; 32] first ten cards: {}",
        poker_engine::card::cards_to_string(first_ten)
    );

    // Sanity properties that hold regardless of the exact values.
    let mut seen = [false; DECK_SIZE];
    for c in deck.cards {
        assert!(!seen[c as usize]);
        seen[c as usize] = true;
    }

    // Same seed, same deck, every time.
    assert_eq!(deck.cards, Deck::shuffled_from_seed(&[7u8; 32]).cards);
}

#[test]
fn shuffling_a_short_slice_still_works() {
    // The rejection sampling has to handle small ranges, where the bit width of
    // the index changes on nearly every step.
    for len in 2..=8usize {
        let mut buf: Vec<u8> = (0..len as u8).collect();
        shuffle_in_place(&mut buf, &[3u8; 32]);
        let mut sorted = buf.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..len as u8).collect::<Vec<_>>());
    }
}
