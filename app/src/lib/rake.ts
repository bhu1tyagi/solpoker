/**
 * The rake, recomputed off chain.
 *
 * A port of `rake_for` and the settlement split in
 * `programs/solpoker/src/{state.rs,instructions/settle.rs}`. It exists because
 * the chain never writes down what any single player paid: settlement takes
 * the rake off the winners' payouts, adds the total to `Table.rake_accrued`,
 * and the per-seat breakdown survives only as a `msg!` on the rollup, which
 * nothing keeps.
 *
 * Rewards ranks players by the rake they generated, so that breakdown has to
 * be reconstructed. It is reconstructed on the SERVER, from payouts the result
 * hash has already proven, and never accepted from a client — a number that
 * decides an airdrop allocation must not be one a caller can simply assert.
 *
 * Like the shuffle verifier next door, this shares no code with the program.
 * Agreement between the two is evidence; the tests pin it to the Rust.
 */

/** Rake in basis points of the pot. 250 = 2.5%. */
export const RAKE_BPS = 250;
/** The most any single hand can be raked, as a multiple of the big blind. */
export const RAKE_CAP_BIG_BLINDS = 3;
/** Pots at or below this many big blinds are never raked at all. */
export const RAKE_FREE_BIG_BLINDS = 1;

/**
 * What the house takes from a finished pot.
 *
 * `sawFlop` is the no-flop-no-drop rule and comes from the board, not from a
 * street counter: if the flop was never dealt there is nothing to rake.
 */
export function rakeFor(pot: number, bigBlind: number, sawFlop: boolean): number {
  if (!sawFlop || bigBlind <= 0 || pot <= 0) return 0;
  if (pot <= bigBlind * RAKE_FREE_BIG_BLINDS) return 0;
  const pct = Math.floor((pot * RAKE_BPS) / 10_000);
  const cap = bigBlind * RAKE_CAP_BIG_BLINDS;
  return Math.min(pct, cap, pot);
}

/**
 * Work backwards from what the seats were paid to what the pot was.
 *
 * What a client can prove is the payouts AFTER the rake came off — those are
 * the numbers in the result hash. The pot itself is gone by then, so the rake
 * has to be recovered from the payouts, and the recovery is not quite unique.
 *
 * Inverting a floor has ties. A pot of 199 raked 4 and a pot of 200 raked 5
 * both leave the seats holding 195, and nothing in the payouts says which one
 * happened. The gap is a single chip — one cent — but it is real, and pretending
 * otherwise would put a number in the rewards table that is confidently wrong
 * rather than honestly approximate.
 *
 * So the observed pot settles it when there is one. `observedPot` is the
 * client's running maximum of what the seats committed, the same untrusted
 * figure the lobby's volume rests on — except that here it is not taken on
 * faith: it is accepted only if raking it reproduces the payout sum the hash
 * already proved. A pot that passes that check is corroborated by the chain's
 * own digest. One that fails is discarded, silently and without argument.
 *
 * Absent a usable pot, the fixed point is taken and the answer may be a chip
 * light. Across the thousands of hands an allocation is ranked on, a cent per
 * split-pot hand does not move anybody past anybody.
 */
export function rakeFromNetPayouts(
  netSum: number,
  bigBlind: number,
  sawFlop: boolean,
  observedPot?: number | null,
): { rake: number; paid: number } {
  if (
    typeof observedPot === "number" &&
    Number.isFinite(observedPot) &&
    observedPot >= netSum
  ) {
    const rake = rakeFor(observedPot, bigBlind, sawFlop);
    // The corroboration: this pot, raked, leaves exactly what the seats were
    // proven to have been paid.
    if (observedPot - rake === netSum) return { rake, paid: observedPot };
  }

  let rake = 0;
  for (let i = 0; i < 8; i++) {
    const next = rakeFor(netSum + rake, bigBlind, sawFlop);
    if (next === rake) break;
    rake = next;
  }
  return { rake, paid: netSum + rake };
}

/**
 * Split a hand's rake across the seats that paid it.
 *
 * Settlement spreads the rake over the winners in proportion to what each is
 * owed, so a split pot is raked once between them rather than once each, and a
 * side-pot winner taking a tenth of the money pays a tenth of the rake. The
 * remainder from the division goes to the largest payout, the same rule the
 * engine uses for an odd chip.
 *
 * One deliberate difference from the program. Settlement divides by each
 * seat's GROSS payout; all that survives to be proven is the NET. Recovering
 * gross from net means inverting a floor, which has ties, so this divides by
 * net instead. The two agree exactly whenever one seat wins, and differ by at
 * most a chip or two per hand on a split pot — a hundredth of a dollar, on a
 * figure used to rank contribution over thousands of hands. The total is exact
 * either way, which is the part that has to be: the remainder loop below means
 * the shares always sum to the rake actually taken, so no allocation can be
 * inflated or lost by the approximation.
 */
export function attributeRake(
  netPayouts: readonly number[],
  rake: number,
): number[] {
  const shares = netPayouts.map(() => 0);
  const netSum = netPayouts.reduce((a, b) => a + b, 0);
  if (rake <= 0 || netSum <= 0) return shares;

  let largest = -1;
  let taken = 0;
  for (let i = 0; i < netPayouts.length; i++) {
    if (netPayouts[i] <= 0) continue;
    if (largest < 0 || netPayouts[i] > netPayouts[largest]) largest = i;
    shares[i] = Math.floor((rake * netPayouts[i]) / netSum);
    taken += shares[i];
  }
  const remainder = rake - taken;
  if (remainder > 0 && largest >= 0) shares[largest] += remainder;
  return shares;
}
