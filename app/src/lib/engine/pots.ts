/**
 * Main pot and side pots, ported from crates/poker-engine/src/pots.rs.
 *
 * The Hand account has no pot field, so the client rebuilds the layers from
 * what each seat has contributed. Same level-based construction as the program:
 * distinct contribution amounts become band boundaries, and a seat is eligible
 * for a band if it reached that band and did not fold.
 *
 * Display only. Settlement happens on chain.
 */

import { MAX_SEATS } from "../constants";

export interface Pot {
  amount: number;
  /** Bitmask of eligible seats, bit i for seat i. */
  eligible: number;
}

export const isEligible = (pot: Pot, seat: number) =>
  (pot.eligible & (1 << seat)) !== 0;

export const eligibleSeats = (pot: Pot) =>
  Array.from({ length: MAX_SEATS }, (_, i) => i).filter((i) => isEligible(pot, i));

/**
 * Split total contributions into a main pot and side pots.
 *
 * Chips from folded seats stay in as dead money, they just cannot be won back.
 * Adjacent layers with the same eligibility merge, so the list is minimal.
 */
export function buildPots(contributions: number[], folded: boolean[]): Pot[] {
  const levels: number[] = [];
  for (const c of contributions) {
    if (c !== 0 && !levels.includes(c)) levels.push(c);
  }
  levels.sort((a, b) => a - b);

  const out: Pot[] = [];
  let prev = 0;

  for (const level of levels) {
    let amount = 0;
    let eligible = 0;
    for (let i = 0; i < contributions.length; i++) {
      const c = contributions[i];
      amount += Math.min(c, level) - Math.min(c, prev);
      if (c >= level && !folded[i]) eligible |= 1 << i;
    }

    if (amount > 0) {
      const last = out[out.length - 1];
      // Nobody can win this band, so it rides with the band below.
      const merge = last !== undefined && (last.eligible === eligible || eligible === 0);
      if (merge) last.amount += amount;
      else out.push({ amount, eligible });
    }
    prev = level;
  }

  return out;
}

export const potsTotal = (pots: Pot[]) => pots.reduce((a, p) => a + p.amount, 0);

/**
 * Award every pot to its best eligible hand, splitting ties. Odd chips go to
 * the first tied winner clockwise from the button, the standard rule.
 *
 * Used to preview a showdown while the settle transaction lands. The chain
 * result is authoritative.
 */
export function distribute(
  pots: Pot[],
  ranks: (number | null)[],
  button: number,
): { payouts: number[]; unclaimed: number } {
  const payouts = new Array(MAX_SEATS).fill(0);
  let unclaimed = 0;

  for (const pot of pots) {
    let best: number | null = null;
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      if (!isEligible(pot, seat)) continue;
      const r = ranks[seat];
      if (r !== null && r !== undefined) best = best === null ? r : Math.max(best, r);
    }

    const winners = new Array(MAX_SEATS).fill(false);
    let nWinners = 0;
    for (let seat = 0; seat < MAX_SEATS; seat++) {
      if (!isEligible(pot, seat)) continue;
      // With no ranks at all, split among the eligible rather than lose chips.
      if (best === null || ranks[seat] === best) {
        winners[seat] = true;
        nWinners++;
      }
    }

    if (nWinners === 0) {
      unclaimed += pot.amount;
      continue;
    }

    const share = Math.floor(pot.amount / nWinners);
    let remainder = pot.amount % nWinners;

    for (let step = 1; step <= MAX_SEATS; step++) {
      const seat = (button + step) % MAX_SEATS;
      if (!winners[seat]) continue;
      payouts[seat] += share;
      if (remainder > 0) {
        payouts[seat] += 1;
        remainder -= 1;
      }
    }
  }

  return { payouts, unclaimed };
}
