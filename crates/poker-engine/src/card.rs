//! Card encoding and deck.
//!
//! A card is a `u8` in `0..52` where `rank = card / 4` and `suit = card % 4`.
//! Rank 0 is a Two and rank 12 is an Ace. `NO_CARD` (`0xFF`) means "no card" and
//! is what an undealt board slot holds.
//!
//! The encoding is deliberately the same one the on-chain accounts use, so a
//! `[u8; 52]` deck or a `[u8; 2]` hole-card pair can move between this crate and
//! program state with no conversion.

use core::fmt;

/// Sentinel for an empty card slot (undealt board position, mucked hole card).
pub const NO_CARD: u8 = 0xFF;

pub const DECK_SIZE: usize = 52;
pub const NUM_RANKS: usize = 13;
pub const NUM_SUITS: usize = 4;

/// Rank index of the lowest card (a Two).
pub const RANK_TWO: u8 = 0;
/// Rank index of the highest card (an Ace).
pub const RANK_ACE: u8 = 12;

#[inline]
pub const fn rank_of(card: u8) -> u8 {
    card / 4
}

#[inline]
pub const fn suit_of(card: u8) -> u8 {
    card % 4
}

#[inline]
pub const fn make_card(rank: u8, suit: u8) -> u8 {
    rank * 4 + suit
}

#[inline]
pub const fn is_card(card: u8) -> bool {
    (card as usize) < DECK_SIZE
}

const RANK_CHARS: [u8; NUM_RANKS] = *b"23456789TJQKA";
const SUIT_CHARS: [u8; NUM_SUITS] = *b"cdhs";

/// Render a card as e.g. `As`, `Td`, `2c`. Returns `--` for [`NO_CARD`].
pub fn card_to_string(card: u8) -> String {
    if !is_card(card) {
        return "--".to_string();
    }
    let r = RANK_CHARS[rank_of(card) as usize] as char;
    let s = SUIT_CHARS[suit_of(card) as usize] as char;
    format!("{r}{s}")
}

/// Parse `As`, `td`, `2C` into a card byte. Case-insensitive on both halves.
pub fn card_from_string(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() != 2 {
        return None;
    }
    let rank = RANK_CHARS
        .iter()
        .position(|c| c.eq_ignore_ascii_case(&b[0]))? as u8;
    let suit = SUIT_CHARS
        .iter()
        .position(|c| c.eq_ignore_ascii_case(&b[1]))? as u8;
    Some(make_card(rank, suit))
}

/// A card that knows how to print itself. Purely a display convenience, the
/// engine passes plain `u8` around.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Card(pub u8);

impl fmt::Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&card_to_string(self.0))
    }
}

impl fmt::Debug for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

/// Format a slice of cards as `As Kd 7c`, skipping empty slots.
pub fn cards_to_string(cards: &[u8]) -> String {
    cards
        .iter()
        .copied()
        .filter(|c| is_card(*c))
        .map(card_to_string)
        .collect::<Vec<_>>()
        .join(" ")
}

/// A shuffled deck plus a deal cursor.
///
/// This mirrors the on-chain `Deck` account layout exactly: 52 card bytes and a
/// `next_index`. On chain it lives in a TEE-private account so the order is
/// known only to program logic inside the enclave.
#[derive(Clone, PartialEq, Eq)]
pub struct Deck {
    pub cards: [u8; DECK_SIZE],
    pub next_index: u8,
}

impl Default for Deck {
    fn default() -> Self {
        Self::new_ordered()
    }
}

impl Deck {
    /// An unshuffled deck in canonical order (`2c` first, `As` last).
    pub fn new_ordered() -> Self {
        let mut cards = [0u8; DECK_SIZE];
        for (i, slot) in cards.iter_mut().enumerate() {
            *slot = i as u8;
        }
        Deck {
            cards,
            next_index: 0,
        }
    }

    /// A deck shuffled deterministically from a 32-byte seed.
    ///
    /// Same seed always yields the same deck, in this or any other language,
    /// see [`shuffle_in_place`] for the exact construction. Phase 5 supplies the
    /// seed as `VRF_output XOR salt_1 XOR ... XOR salt_n`; the shuffle itself is
    /// fixed here so the public verifier can be written against it.
    pub fn shuffled_from_seed(seed: &[u8; 32]) -> Self {
        let mut deck = Self::new_ordered();
        shuffle_in_place(&mut deck.cards, seed);
        deck
    }

    /// Deal the next card, advancing the cursor. `None` once the deck is spent.
    pub fn deal(&mut self) -> Option<u8> {
        if (self.next_index as usize) >= DECK_SIZE {
            return None;
        }
        let card = self.cards[self.next_index as usize];
        self.next_index += 1;
        Some(card)
    }

    /// Cards not yet dealt.
    pub fn remaining(&self) -> usize {
        DECK_SIZE - (self.next_index as usize).min(DECK_SIZE)
    }

    /// Overwrite every card and reset the cursor.
    ///
    /// Called at hand end before any undelegation path can touch the account, so
    /// a committed `Deck` can never carry card data back to the public base
    /// layer. See docs/SPEC.md §4.
    pub fn zeroize(&mut self) {
        self.cards = [NO_CARD; DECK_SIZE];
        self.next_index = 0;
    }
}

/// Fisher-Yates shuffle driven by a SHA-256 counter-mode byte stream.
///
/// The construction is specified precisely so an independent verifier can
/// reproduce a published hand's deck:
///
/// 1. Keystream block `i` is `SHA256(seed || i as u64 little-endian)`, giving 32
///    bytes per block; blocks are consumed in order, byte by byte.
/// 2. Iterate `i` from `len - 1` down to `1`. For each, draw a uniform index `j`
///    in `0..=i` and swap `cards[i]` with `cards[j]`.
/// 3. `j` is drawn by **rejection sampling**, not modulo: read `n` bytes big-endian
///    where `n` is the minimum bytes holding `i`, mask to the low `bits(i)` bits,
///    and reject any value greater than `i`. This keeps every permutation exactly
///    equally likely, which modulo reduction would not.
pub fn shuffle_in_place(cards: &mut [u8], seed: &[u8; 32]) {
    use sha2::{Digest, Sha256};

    let mut block = [0u8; 32];
    let mut block_index: u64 = 0;
    let mut byte_cursor = 32usize; // forces the first block to be generated

    let next_byte = |block: &mut [u8; 32], cursor: &mut usize, bi: &mut u64| -> u8 {
        if *cursor >= 32 {
            let mut hasher = Sha256::new();
            hasher.update(seed);
            hasher.update(bi.to_le_bytes());
            block.copy_from_slice(&hasher.finalize());
            *bi += 1;
            *cursor = 0;
        }
        let b = block[*cursor];
        *cursor += 1;
        b
    };

    if cards.len() < 2 {
        return;
    }

    for i in (1..cards.len()).rev() {
        // Smallest bit-width that can represent `i`.
        let bits = usize::BITS - i.leading_zeros();
        let bytes_needed = bits.div_ceil(8).max(1) as usize;
        let mask: u64 = if bits >= 64 {
            u64::MAX
        } else {
            (1u64 << bits) - 1
        };

        let j = loop {
            let mut v: u64 = 0;
            for _ in 0..bytes_needed {
                v = (v << 8) | next_byte(&mut block, &mut byte_cursor, &mut block_index) as u64;
            }
            let candidate = v & mask;
            if candidate <= i as u64 {
                break candidate as usize;
            }
            // Out of range: reject and redraw, preserving uniformity.
        };

        cards.swap(i, j);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rank_and_suit_round_trip() {
        for card in 0u8..52 {
            assert_eq!(make_card(rank_of(card), suit_of(card)), card);
        }
    }

    #[test]
    fn rank_ordering_matches_spec() {
        // rank = card / 4, with 0 = Two and 12 = Ace.
        assert_eq!(rank_of(0), RANK_TWO);
        assert_eq!(rank_of(51), RANK_ACE);
        assert_eq!(card_to_string(51), "As");
        assert_eq!(card_to_string(0), "2c");
    }

    #[test]
    fn string_round_trip() {
        for card in 0u8..52 {
            let s = card_to_string(card);
            assert_eq!(card_from_string(&s), Some(card), "failed on {s}");
        }
        assert_eq!(card_from_string("AS"), card_from_string("as"));
        assert_eq!(card_from_string("xx"), None);
        assert_eq!(card_from_string("A"), None);
    }

    #[test]
    fn ordered_deck_is_a_permutation() {
        let deck = Deck::new_ordered();
        let mut seen = [false; DECK_SIZE];
        for c in deck.cards {
            assert!(!seen[c as usize]);
            seen[c as usize] = true;
        }
        assert!(seen.iter().all(|s| *s));
    }

    #[test]
    fn shuffle_is_a_permutation_and_deterministic() {
        let seed = [7u8; 32];
        let a = Deck::shuffled_from_seed(&seed);
        let b = Deck::shuffled_from_seed(&seed);
        assert_eq!(a.cards, b.cards, "same seed must reproduce the same deck");

        let mut seen = [false; DECK_SIZE];
        for c in a.cards {
            assert!(!seen[c as usize], "duplicate card after shuffle");
            seen[c as usize] = true;
        }
        assert!(seen.iter().all(|s| *s), "shuffle lost a card");

        let mut other_seed = [7u8; 32];
        other_seed[0] = 8;
        let c = Deck::shuffled_from_seed(&other_seed);
        assert_ne!(a.cards, c.cards, "different seeds should differ");
    }

    #[test]
    fn dealing_walks_the_deck_then_stops() {
        let mut deck = Deck::shuffled_from_seed(&[1u8; 32]);
        let expected = deck.cards;
        for (i, want) in expected.iter().enumerate() {
            assert_eq!(deck.remaining(), DECK_SIZE - i);
            assert_eq!(deck.deal(), Some(*want));
        }
        assert_eq!(deck.deal(), None);
        assert_eq!(deck.remaining(), 0);
    }

    #[test]
    fn zeroize_leaves_no_card_data() {
        let mut deck = Deck::shuffled_from_seed(&[3u8; 32]);
        deck.deal();
        deck.zeroize();
        assert!(deck.cards.iter().all(|c| *c == NO_CARD));
        assert_eq!(deck.next_index, 0);
        // Nothing in the buffer decodes as a real card.
        assert!(!deck.cards.iter().copied().any(is_card));
    }
}
