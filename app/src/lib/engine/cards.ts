/**
 * Card encoding, matching crates/poker-engine/src/card.rs exactly.
 *
 * A card is one byte: rank * 4 + suit. Rank 0 is a two, rank 12 an ace. Suits
 * run clubs, diamonds, hearts, spades. 0xff means no card, used for undealt
 * board slots and mucked hands.
 */

export const NO_CARD = 0xff;

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";
export const SUIT_SYMBOLS = ["♣", "♦", "♥", "♠"];

export const RANK_NAMES = [
  "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "jack", "queen", "king", "ace",
];
export const RANK_PLURALS = [
  "twos", "threes", "fours", "fives", "sixes", "sevens", "eights",
  "nines", "tens", "jacks", "queens", "kings", "aces",
];

export const rankOf = (card: number) => Math.floor(card / 4);
export const suitOf = (card: number) => card % 4;
export const makeCard = (rank: number, suit: number) => rank * 4 + suit;
export const isCard = (card: number) => card >= 0 && card < 52;

/** Short form, as the verifier and the Rust side both print it. */
export const cardName = (card: number) =>
  isCard(card) ? `${RANK_CHARS[rankOf(card)]}${SUIT_CHARS[suitOf(card)]}` : "--";

export const isRedSuit = (card: number) => {
  const s = suitOf(card);
  return s === 1 || s === 2;
};
