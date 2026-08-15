/**
 * Hand evaluation, ported from crates/poker-engine/src/eval.rs.
 *
 * Same table-free approach: a 13-bit rank mask plus per-rank counts, with
 * straights found by a four-shift AND rather than a search. The rank is packed
 * into one number so plain comparison is poker comparison.
 *
 * This runs client-side only, to name your current hand and highlight the
 * winning five at showdown. Chips are still moved by the program.
 */

import { rankOf, suitOf, isCard, RANK_NAMES, RANK_PLURALS } from "./cards";

export const Category = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

export const CATEGORY_NAMES = [
  "high card", "pair", "two pair", "three of a kind", "straight",
  "flush", "full house", "four of a kind", "straight flush",
];

export const WORST = 0;

const pack = (cat: number, k: number[]) =>
  (cat << 20) | (k[0] << 16) | (k[1] << 12) | (k[2] << 8) | (k[3] << 4) | k[4];

export const categoryOf = (rank: number) => (rank >> 20) & 0xf;

export const kickersOf = (rank: number) => [
  (rank >> 16) & 0xf,
  (rank >> 12) & 0xf,
  (rank >> 8) & 0xf,
  (rank >> 4) & 0xf,
  rank & 0xf,
];

/** Highest card of the best straight in a rank mask, or null. */
function straightHigh(mask: number): number | null {
  const s = mask & (mask >> 1) & (mask >> 2) & (mask >> 3) & (mask >> 4);
  if (s !== 0) {
    const msb = 31 - Math.clz32(s);
    return msb + 4;
  }
  // The ace plays low only here: A,2,3,4,5.
  const WHEEL = (1 << 12) | 0b1111;
  if ((mask & WHEEL) === WHEEL) return 3;
  return null;
}

/** The n highest set ranks, descending, zero-padded to five. */
function topRanks(mask: number, n: number): number[] {
  const out = [0, 0, 0, 0, 0];
  let written = 0;
  for (let r = 12; r >= 0 && written < n; r--) {
    if (mask & (1 << r)) out[written++] = r;
  }
  return out;
}

/** Evaluate the best five-card hand from 5, 6, or 7 cards. */
export function evaluate(cards: number[]): number {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate expects 5 to 7 cards, got ${cards.length}`);
  }

  const counts = new Array(13).fill(0);
  const suitMasks = [0, 0, 0, 0];
  const suitCounts = [0, 0, 0, 0];
  let rankMask = 0;

  for (const c of cards) {
    if (!isCard(c)) throw new Error(`invalid card byte ${c}`);
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]++;
    rankMask |= 1 << r;
    suitMasks[s] |= 1 << r;
    suitCounts[s]++;
  }

  let best = WORST;
  const better = (v: number) => {
    if (v > best) best = v;
  };

  // Flush family. At most one suit can reach five out of seven.
  const fs = suitCounts.findIndex((n) => n >= 5);
  if (fs >= 0) {
    const fmask = suitMasks[fs];
    const sfHigh = straightHigh(fmask);
    if (sfHigh !== null) better(pack(Category.StraightFlush, [sfHigh, 0, 0, 0, 0]));
    better(pack(Category.Flush, topRanks(fmask, 5)));
  }

  const sHigh = straightHigh(rankMask);
  if (sHigh !== null) better(pack(Category.Straight, [sHigh, 0, 0, 0, 0]));

  // Ranks by multiplicity, highest first.
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4 && quads.length < 2) quads.push(r);
    else if (counts[r] === 3 && trips.length < 2) trips.push(r);
    else if (counts[r] === 2 && pairs.length < 3) pairs.push(r);
  }

  const exclude = (mask: number, excluded: number[]) => {
    let m = mask;
    for (const r of excluded) m &= ~(1 << r);
    return m;
  };

  if (quads.length > 0) {
    const q = quads[0];
    const kicker = topRanks(exclude(rankMask, [q]), 1)[0];
    better(pack(Category.Quads, [q, kicker, 0, 0, 0]));
  }

  if (trips.length > 0) {
    const t = trips[0];
    // The pair half can come from a second set of trips or a real pair.
    let pairRank: number | null = trips.length > 1 ? trips[1] : null;
    if (pairs.length > 0) {
      pairRank = pairRank === null ? pairs[0] : Math.max(pairRank, pairs[0]);
    }
    if (pairRank !== null) better(pack(Category.FullHouse, [t, pairRank, 0, 0, 0]));

    const k = topRanks(exclude(rankMask, [t]), 2);
    better(pack(Category.Trips, [t, k[0], k[1], 0, 0]));
  }

  if (pairs.length >= 2) {
    const [p0, p1] = pairs;
    const kicker = topRanks(exclude(rankMask, [p0, p1]), 1)[0];
    better(pack(Category.TwoPair, [p0, p1, kicker, 0, 0]));
  }

  if (pairs.length >= 1) {
    const p = pairs[0];
    const k = topRanks(exclude(rankMask, [p]), 3);
    better(pack(Category.Pair, [p, k[0], k[1], k[2], 0]));
  }

  better(pack(Category.HighCard, topRanks(rankMask, 5)));
  return best;
}

/** Human-readable summary, matching HandRank::describe in Rust. */
export function describe(rank: number): string {
  const k = kickersOf(rank);
  const n = (i: number) => RANK_NAMES[k[i]];
  const p = (i: number) => RANK_PLURALS[k[i]];
  switch (categoryOf(rank)) {
    case Category.HighCard: return `high card, ${n(0)} high`;
    case Category.Pair: return `pair of ${p(0)}`;
    case Category.TwoPair: return `two pair, ${p(0)} and ${p(1)}`;
    case Category.Trips: return `three ${p(0)}`;
    case Category.Straight: return `straight, ${n(0)} high`;
    case Category.Flush: return `flush, ${n(0)} high`;
    case Category.FullHouse: return `full house, ${p(0)} over ${p(1)}`;
    case Category.Quads: return `four ${p(0)}`;
    case Category.StraightFlush: return `straight flush, ${n(0)} high`;
    default: return "no hand";
  }
}

/** The specific five cards making the best hand, for highlighting a showdown. */
export function bestFive(cards: number[]): { five: number[]; rank: number } {
  if (cards.length < 5) throw new Error("need at least 5 cards");
  if (cards.length === 5) return { five: [...cards], rank: evaluate(cards) };

  let bestRank = -1;
  let five: number[] = [];
  const n = cards.length;
  const idx = [0, 1, 2, 3, 4];
  // Walk every 5-subset in lexicographic order.
  for (;;) {
    const combo = idx.map((i) => cards[i]);
    const r = evaluate(combo);
    if (r > bestRank) {
      bestRank = r;
      five = combo;
    }
    let i = 4;
    while (i >= 0 && idx[i] === n - 5 + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < 5; j++) idx[j] = idx[j - 1] + 1;
  }
  return { five, rank: bestRank };
}
