//! Seven-card hand evaluation.
//!
//! # Why there are no lookup tables here
//!
//! The fast evaluators in the literature trade memory for speed. The Two Plus Two
//! table is around 130 MB, which is a non-starter in a Solana program.
//!
//! This one is table-free. Everything comes from a 13-bit rank mask and a per-rank
//! count array. Straight detection is a four-shift AND rather than a search:
//!
//! ```text
//! s = m & (m>>1) & (m>>2) & (m>>3) & (m>>4)
//! ```
//!
//! A set bit in `s` at position `p` means ranks `p..=p+4` are all present, i.e. a
//! straight with high card `p+4`.
//!
//! # Scoring
//!
//! [`HandRank`] wraps a single `u32` laid out as:
//!
//! ```text
//! bits 23..20  category (0 = high card .. 8 = straight flush)
//! bits 19..16  first tiebreak rank
//! bits 15..12  second
//! bits 11.. 8  third
//! bits  7.. 4  fourth
//! bits  3.. 0  fifth
//! ```
//!
//! Because the category occupies the high bits and every tiebreak is a 4-bit rank
//! in descending significance, plain integer comparison *is* poker comparison.
//! Equal scores mean a genuine tie that splits the pot, two hands tie exactly
//! when they have the same category and identical five-card ranks, which is the
//! correct rule (suits never break ties in Hold'em).

use crate::card::{rank_of, suit_of, NUM_RANKS, NUM_SUITS};

/// Hand categories, ordered so that a higher discriminant always beats a lower one.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum Category {
    HighCard = 0,
    Pair = 1,
    TwoPair = 2,
    Trips = 3,
    Straight = 4,
    Flush = 5,
    FullHouse = 6,
    Quads = 7,
    StraightFlush = 8,
}

impl Category {
    pub fn name(self) -> &'static str {
        match self {
            Category::HighCard => "high card",
            Category::Pair => "pair",
            Category::TwoPair => "two pair",
            Category::Trips => "three of a kind",
            Category::Straight => "straight",
            Category::Flush => "flush",
            Category::FullHouse => "full house",
            Category::Quads => "four of a kind",
            Category::StraightFlush => "straight flush",
        }
    }

    fn from_u8(v: u8) -> Category {
        match v {
            0 => Category::HighCard,
            1 => Category::Pair,
            2 => Category::TwoPair,
            3 => Category::Trips,
            4 => Category::Straight,
            5 => Category::Flush,
            6 => Category::FullHouse,
            7 => Category::Quads,
            8 => Category::StraightFlush,
            _ => unreachable!("invalid hand category {v}"),
        }
    }
}

/// A comparable hand strength. Higher is better; equal is a genuine tie.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Hash)]
pub struct HandRank(pub u32);

impl HandRank {
    /// Lower than any real hand. Used for folded/absent players.
    pub const WORST: HandRank = HandRank(0);

    #[inline]
    fn new(cat: Category, k: [u8; 5]) -> HandRank {
        HandRank(
            ((cat as u32) << 20)
                | ((k[0] as u32) << 16)
                | ((k[1] as u32) << 12)
                | ((k[2] as u32) << 8)
                | ((k[3] as u32) << 4)
                | (k[4] as u32),
        )
    }

    #[inline]
    pub fn category(self) -> Category {
        Category::from_u8((self.0 >> 20) as u8 & 0xF)
    }

    /// The five tiebreak ranks, most significant first. Unused slots are zero.
    pub fn kickers(self) -> [u8; 5] {
        [
            ((self.0 >> 16) & 0xF) as u8,
            ((self.0 >> 12) & 0xF) as u8,
            ((self.0 >> 8) & 0xF) as u8,
            ((self.0 >> 4) & 0xF) as u8,
            (self.0 & 0xF) as u8,
        ]
    }

    /// Human-readable summary, e.g. `full house, kings over threes`.
    pub fn describe(self) -> String {
        const R: [&str; NUM_RANKS] = [
            "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "jack",
            "queen", "king", "ace",
        ];
        const RP: [&str; NUM_RANKS] = [
            "twos", "threes", "fours", "fives", "sixes", "sevens", "eights", "nines", "tens",
            "jacks", "queens", "kings", "aces",
        ];
        let k = self.kickers();
        let n = |i: usize| R[k[i] as usize];
        let p = |i: usize| RP[k[i] as usize];
        match self.category() {
            Category::HighCard => format!("high card, {} high", n(0)),
            Category::Pair => format!("pair of {}", p(0)),
            Category::TwoPair => format!("two pair, {} and {}", p(0), p(1)),
            Category::Trips => format!("three {}", p(0)),
            Category::Straight => format!("straight, {} high", n(0)),
            Category::Flush => format!("flush, {} high", n(0)),
            Category::FullHouse => format!("full house, {} over {}", p(0), p(1)),
            Category::Quads => format!("four {}", p(0)),
            Category::StraightFlush => format!("straight flush, {} high", n(0)),
        }
    }
}

/// Highest card of the best straight in a 13-bit rank mask, if any.
///
/// Returns the rank index of the straight's top card. The wheel (A-2-3-4-5) is
/// reported as a Five-high straight, which is its correct ranking.
#[inline]
fn straight_high(mask: u16) -> Option<u8> {
    let m = mask;
    let s = m & (m >> 1) & (m >> 2) & (m >> 3) & (m >> 4);
    if s != 0 {
        let msb = 15 - s.leading_zeros() as u8;
        return Some(msb + 4);
    }
    // Ace plays low only here: bits for A,2,3,4,5.
    const WHEEL: u16 = (1 << 12) | 0b1111;
    if m & WHEEL == WHEEL {
        return Some(3); // Five-high
    }
    None
}

/// The `n` highest set ranks in `mask`, descending, zero-padded to five.
#[inline]
fn top_ranks(mask: u16, n: usize) -> [u8; 5] {
    let mut out = [0u8; 5];
    let mut written = 0;
    let mut r: i32 = (NUM_RANKS - 1) as i32;
    while r >= 0 && written < n {
        if mask & (1 << r) != 0 {
            out[written] = r as u8;
            written += 1;
        }
        r -= 1;
    }
    out
}

/// Evaluate the best five-card hand from 5, 6, or 7 cards.
///
/// # Panics
/// If fewer than 5 or more than 7 cards are supplied, or a byte is not a valid card.
pub fn evaluate(cards: &[u8]) -> HandRank {
    assert!(
        (5..=7).contains(&cards.len()),
        "evaluate expects 5-7 cards, got {}",
        cards.len()
    );

    let mut counts = [0u8; NUM_RANKS];
    let mut suit_masks = [0u16; NUM_SUITS];
    let mut suit_counts = [0u8; NUM_SUITS];
    let mut rank_mask: u16 = 0;

    for &c in cards {
        assert!(crate::card::is_card(c), "invalid card byte {c}");
        let r = rank_of(c) as usize;
        let s = suit_of(c) as usize;
        counts[r] += 1;
        rank_mask |= 1 << r;
        suit_masks[s] |= 1 << r;
        suit_counts[s] += 1;
    }

    let mut best = HandRank::WORST;

    // --- flush family -------------------------------------------------------
    // At most one suit can reach five cards out of seven, so this is unambiguous.
    if let Some(fs) = suit_counts.iter().position(|&n| n >= 5) {
        let fmask = suit_masks[fs];
        if let Some(hi) = straight_high(fmask) {
            best = best.max(HandRank::new(Category::StraightFlush, [hi, 0, 0, 0, 0]));
        }
        best = best.max(HandRank::new(Category::Flush, top_ranks(fmask, 5)));
    }

    // --- straight -----------------------------------------------------------
    if let Some(hi) = straight_high(rank_mask) {
        best = best.max(HandRank::new(Category::Straight, [hi, 0, 0, 0, 0]));
    }

    // --- rank-multiplicity family ------------------------------------------
    // Ranks of each multiplicity, highest first.
    let mut quads = [0u8; 2];
    let mut n_quads = 0;
    let mut trips = [0u8; 2];
    let mut n_trips = 0;
    let mut pairs = [0u8; 3];
    let mut n_pairs = 0;
    for r in (0..NUM_RANKS).rev() {
        match counts[r] {
            4 if n_quads < quads.len() => {
                quads[n_quads] = r as u8;
                n_quads += 1;
            }
            3 if n_trips < trips.len() => {
                trips[n_trips] = r as u8;
                n_trips += 1;
            }
            2 if n_pairs < pairs.len() => {
                pairs[n_pairs] = r as u8;
                n_pairs += 1;
            }
            _ => {}
        }
    }

    // Highest rank in `mask` excluding the given ranks.
    let exclude = |mask: u16, excluded: &[u8]| -> u16 {
        let mut m = mask;
        for &r in excluded {
            m &= !(1 << r);
        }
        m
    };

    if n_quads > 0 {
        let q = quads[0];
        let kicker = top_ranks(exclude(rank_mask, &[q]), 1)[0];
        best = best.max(HandRank::new(Category::Quads, [q, kicker, 0, 0, 0]));
    }

    if n_trips > 0 {
        let t = trips[0];
        // The pair half may come from a second set of trips or from a real pair.
        let mut pair_rank: Option<u8> = None;
        if n_trips > 1 {
            pair_rank = Some(trips[1]);
        }
        if n_pairs > 0 {
            pair_rank = Some(match pair_rank {
                Some(p) => p.max(pairs[0]),
                None => pairs[0],
            });
        }
        if let Some(p) = pair_rank {
            best = best.max(HandRank::new(Category::FullHouse, [t, p, 0, 0, 0]));
        }

        let k = top_ranks(exclude(rank_mask, &[t]), 2);
        best = best.max(HandRank::new(Category::Trips, [t, k[0], k[1], 0, 0]));
    }

    if n_pairs >= 2 {
        let (p0, p1) = (pairs[0], pairs[1]);
        let kicker = top_ranks(exclude(rank_mask, &[p0, p1]), 1)[0];
        best = best.max(HandRank::new(Category::TwoPair, [p0, p1, kicker, 0, 0]));
    }

    if n_pairs >= 1 {
        let p = pairs[0];
        let k = top_ranks(exclude(rank_mask, &[p]), 3);
        best = best.max(HandRank::new(Category::Pair, [p, k[0], k[1], k[2], 0]));
    }

    best = best.max(HandRank::new(Category::HighCard, top_ranks(rank_mask, 5)));

    best
}

/// Evaluate two hole cards against a five-card board.
pub fn evaluate_hand(hole: [u8; 2], board: [u8; 5]) -> HandRank {
    let seven = [
        hole[0], hole[1], board[0], board[1], board[2], board[3], board[4],
    ];
    evaluate(&seven)
}

/// The specific five cards making the best hand, for display at showdown.
///
/// Brute-forces the subsets rather than sharing the fast path, so it doubles as
/// an independent cross-check of [`evaluate`] in tests. Not for hot paths.
pub fn best_five(cards: &[u8]) -> ([u8; 5], HandRank) {
    assert!(
        (5..=7).contains(&cards.len()),
        "best_five expects 5-7 cards, got {}",
        cards.len()
    );
    let n = cards.len();
    let mut best_hand = [0u8; 5];
    let mut best_rank = HandRank::WORST;
    let mut idx = [0usize; 5];
    // Iterate every 5-subset of `n` in lexicographic order.
    for a in 0..n {
        for b in (a + 1)..n {
            for c in (b + 1)..n {
                for d in (c + 1)..n {
                    for e in (d + 1)..n {
                        idx = [a, b, c, d, e];
                        let five = [
                            cards[idx[0]],
                            cards[idx[1]],
                            cards[idx[2]],
                            cards[idx[3]],
                            cards[idx[4]],
                        ];
                        let r = evaluate(&five);
                        if r > best_rank {
                            best_rank = r;
                            best_hand = five;
                        }
                    }
                }
            }
        }
    }
    let _ = idx;
    (best_hand, best_rank)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::card_from_string;

    fn hand(s: &str) -> Vec<u8> {
        s.split_whitespace()
            .map(|c| card_from_string(c).unwrap_or_else(|| panic!("bad card {c}")))
            .collect()
    }

    fn cat(s: &str) -> Category {
        evaluate(&hand(s)).category()
    }

    #[test]
    fn recognises_every_category() {
        assert_eq!(cat("As Ks Qs Js Ts"), Category::StraightFlush);
        assert_eq!(cat("5s 4s 3s 2s As"), Category::StraightFlush); // steel wheel
        assert_eq!(cat("9c 9d 9h 9s 2c"), Category::Quads);
        assert_eq!(cat("9c 9d 9h 4s 4c"), Category::FullHouse);
        assert_eq!(cat("As Js 9s 6s 3s"), Category::Flush);
        assert_eq!(cat("9c 8d 7h 6s 5c"), Category::Straight);
        assert_eq!(cat("Ac Ad Ah 6s 5c"), Category::Trips);
        assert_eq!(cat("Ac Ad 6h 6s 5c"), Category::TwoPair);
        assert_eq!(cat("Ac Ad 9h 6s 5c"), Category::Pair);
        assert_eq!(cat("Ac Jd 9h 6s 5c"), Category::HighCard);
    }

    #[test]
    fn wheel_is_a_five_high_straight_not_ace_high() {
        let wheel = evaluate(&hand("5c 4d 3h 2s Ac"));
        assert_eq!(wheel.category(), Category::Straight);
        assert_eq!(wheel.kickers()[0], 3, "wheel must be Five-high");

        let six_high = evaluate(&hand("6c 5d 4h 3s 2c"));
        assert!(six_high > wheel, "6-high straight beats the wheel");
    }

    #[test]
    fn category_order_is_strict() {
        let ordered = [
            "Ac Jd 9h 6s 5c", // high card
            "Ac Ad 9h 6s 5c", // pair
            "Ac Ad 6h 6s 5c", // two pair
            "Ac Ad Ah 6s 5c", // trips
            "9c 8d 7h 6s 5c", // straight
            "As Js 9s 6s 3s", // flush
            "9c 9d 9h 4s 4c", // full house
            "9c 9d 9h 9s 2c", // quads
            "As Ks Qs Js Ts", // straight flush
        ];
        for w in ordered.windows(2) {
            let lo = evaluate(&hand(w[0]));
            let hi = evaluate(&hand(w[1]));
            assert!(hi > lo, "{} should beat {}", w[1], w[0]);
        }
    }

    #[test]
    fn kickers_decide_within_a_category() {
        // Same pair, better kicker.
        let a = evaluate(&hand("Ac Ad Kh 6s 5c"));
        let b = evaluate(&hand("Ac Ad Qh 6s 5c"));
        assert!(a > b);

        // Same two pair, better kicker.
        let a = evaluate(&hand("Ac Ad 6h 6s Kc"));
        let b = evaluate(&hand("Ac Ad 6h 6s Qc"));
        assert!(a > b);

        // Full house compares trips first, then the pair.
        let a = evaluate(&hand("Kc Kd Kh 2s 2c"));
        let b = evaluate(&hand("Qc Qd Qh As Ac"));
        assert!(a > b, "kings full beats queens full regardless of the pair");
    }

    #[test]
    fn identical_ranks_tie_regardless_of_suit() {
        let a = evaluate(&hand("Ac Kd Qh Js 9c"));
        let b = evaluate(&hand("Ad Kh Qs Jc 9d"));
        assert_eq!(a, b, "suits must never break a tie");
    }

    #[test]
    fn seven_cards_pick_the_best_five() {
        // Board straight plus an irrelevant pair.
        let r = evaluate(&hand("9c 8d 7h 6s 5c 2d 2h"));
        assert_eq!(r.category(), Category::Straight);

        // Flush available alongside a pair.
        let r = evaluate(&hand("As Js 9s 6s 3s Kd Kh"));
        assert_eq!(r.category(), Category::Flush);

        // Quads plus a spare ace kicker.
        let r = evaluate(&hand("9c 9d 9h 9s Ac Kd 2h"));
        assert_eq!(r.category(), Category::Quads);
        assert_eq!(r.kickers()[1], 12, "ace kicker");
    }

    #[test]
    fn full_house_prefers_the_higher_trips_from_two_sets() {
        // Two sets of trips: use the higher as trips, the lower as the pair.
        let r = evaluate(&hand("Kc Kd Kh 7s 7d 7h 2c"));
        assert_eq!(r.category(), Category::FullHouse);
        assert_eq!(r.kickers()[0], 11, "kings are the trips");
        assert_eq!(r.kickers()[1], 5, "sevens fill the pair");
    }

    #[test]
    fn best_of_three_pairs_uses_top_two_and_best_kicker() {
        let r = evaluate(&hand("Ac Ad 9h 9s 5c 5d Kh"));
        assert_eq!(r.category(), Category::TwoPair);
        assert_eq!(r.kickers()[0], 12, "aces");
        assert_eq!(r.kickers()[1], 7, "nines");
        assert_eq!(r.kickers()[2], 11, "king kicker beats the spare five");
    }

    #[test]
    fn straight_flush_beats_quads_on_seven_cards() {
        let sf = evaluate(&hand("9s 8s 7s 6s 5s 2c 2d"));
        let quads = evaluate(&hand("9c 9d 9h 9s Ac Kd 2h"));
        assert_eq!(sf.category(), Category::StraightFlush);
        assert!(sf > quads);
    }

    #[test]
    fn fast_path_agrees_with_brute_force() {
        // Exhaustive agreement is covered by a property test; these are the
        // shapes most likely to expose a category-precedence bug.
        for h in [
            "9c 8d 7h 6s 5c 2d 2h",
            "As Js 9s 6s 3s Kd Kh",
            "Kc Kd Kh 7s 7d 7h 2c",
            "5s 4s 3s 2s As Kd Kh",
            "Ac Ad 9h 9s 5c 5d Kh",
            "9s 8s 7s 6s 5s 2c 2d",
        ] {
            let cards = hand(h);
            let fast = evaluate(&cards);
            let (_, slow) = best_five(&cards);
            assert_eq!(fast, slow, "mismatch on {h}");
        }
    }

    #[test]
    fn describe_reads_sensibly() {
        assert_eq!(
            evaluate(&hand("Kc Kd Kh 7s 7d")).describe(),
            "full house, kings over sevens"
        );
        assert_eq!(
            evaluate(&hand("5c 4d 3h 2s Ac")).describe(),
            "straight, five high"
        );
    }
}
