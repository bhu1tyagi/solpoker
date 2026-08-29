import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { attributeRake, rakeFor, rakeFromNetPayouts } from "./rake";
import { computeResultHash } from "./verifier/result-hash";

/**
 * These pin the port to the program. Every expectation below is derived from
 * `rake_for` in programs/solpoker/src/state.rs and the split in
 * instructions/settle.rs, not from what this implementation happens to do.
 */

describe("rakeFor", () => {
  it("takes nothing when the flop never came", () => {
    // No flop, no drop. The rule the board is the test for.
    expect(rakeFor(10_000, 100, false)).toBe(0);
  });

  it("takes 2.5% of a pot that saw a flop", () => {
    expect(rakeFor(10_000, 100, true)).toBe(250);
  });

  it("leaves small pots alone", () => {
    // At or below one big blind is rake-free, so the house never takes a chip
    // off a pot that is barely more than the blinds.
    expect(rakeFor(100, 100, true)).toBe(0);
    expect(rakeFor(101, 100, true)).toBe(2);
  });

  it("caps at three big blinds", () => {
    // 2.5% of 100_000 is 2_500, but three big blinds is 300.
    expect(rakeFor(100_000, 100, true)).toBe(300);
  });

  it("takes nothing without a big blind", () => {
    expect(rakeFor(10_000, 0, true)).toBe(0);
  });

  it("never takes more than the pot", () => {
    expect(rakeFor(4, 2, true)).toBeLessThanOrEqual(4);
  });
});

describe("rakeFromNetPayouts", () => {
  it("recovers the pot and rake from post-rake payouts", () => {
    // A 10_000 pot at a 100 big blind is raked 250, so the seats saw 9_750,
    // and the observed pot pins which of the two candidate pots it was.
    const { rake, paid } = rakeFromNetPayouts(9_750, 100, true, 10_000);
    expect(rake).toBe(250);
    expect(paid).toBe(10_000);
    // And the recovered pot must rake to the recovered figure.
    expect(rakeFor(paid, 100, true)).toBe(rake);
  });

  it("round-trips exactly when the observed pot corroborates", () => {
    for (const pot of [200, 1_000, 4_000, 10_000, 50_000, 100_000, 250_000]) {
      const rake = rakeFor(pot, 100, true);
      expect(rakeFromNetPayouts(pot - rake, 100, true, pot)).toEqual({ rake, paid: pot });
    }
  });

  it("ignores an observed pot the payouts contradict", () => {
    // 9_750 net came from a 10_000 pot. A client claiming 40_000 is not
    // believed, however plausible the number looks on its own.
    // It falls back to the inversion, which lands within a chip of the truth
    // rather than anywhere near the claim.
    const { rake, paid } = rakeFromNetPayouts(9_750, 100, true, 40_000);
    expect(paid).toBeLessThan(40_000);
    expect(Math.abs(rake - 250)).toBeLessThanOrEqual(1);
  });

  it("stays within a chip of the truth with no pot to check against", () => {
    // Inverting a floor has ties: 199 raked 4 and 200 raked 5 both leave 195.
    // Unresolvable from the payouts alone, and bounded at one chip.
    for (const pot of [200, 1_000, 4_000, 10_000, 50_000, 100_000, 250_000]) {
      const rake = rakeFor(pot, 100, true);
      const back = rakeFromNetPayouts(pot - rake, 100, true);
      expect(Math.abs(back.rake - rake)).toBeLessThanOrEqual(1);
      // Whatever it settles on has to be self-consistent.
      expect(back.paid - back.rake).toBe(pot - rake);
    }
  });

  it("recovers nothing from an unraked hand", () => {
    expect(rakeFromNetPayouts(9_750, 100, false)).toEqual({ rake: 0, paid: 9_750 });
  });
});

describe("attributeRake", () => {
  it("charges the whole rake to a lone winner", () => {
    expect(attributeRake([0, 9_750, 0, 0, 0, 0], 250)).toEqual([0, 250, 0, 0, 0, 0]);
  });

  it("splits a raked pot between the winners in proportion", () => {
    // A split pot is raked once between them, not once each.
    expect(attributeRake([4_875, 4_875, 0, 0, 0, 0], 250)).toEqual([
      125, 125, 0, 0, 0, 0,
    ]);
  });

  it("gives the remainder to the largest payout", () => {
    // 7 across 2:1 floors to 4 and 2, and the odd chip follows the same rule
    // the engine uses: it goes to the biggest stack of the two.
    const shares = attributeRake([2_000, 1_000, 0, 0, 0, 0], 7);
    expect(shares).toEqual([5, 2, 0, 0, 0, 0]);
  });

  it("always sums to exactly the rake taken", () => {
    // The property the allocations rest on: no hand may invent or lose rake.
    const cases: [number[], number][] = [
      [[3_333, 3_333, 3_334, 0, 0, 0], 250],
      [[1, 2, 3, 4, 5, 6], 7],
      [[9_999, 1, 0, 0, 0, 0], 300],
      [[500, 500, 500, 500, 500, 500], 13],
    ];
    for (const [payouts, rake] of cases) {
      const shares = attributeRake(payouts, rake);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(rake);
    }
  });

  it("charges nobody when nothing was raked", () => {
    expect(attributeRake([9_750, 0, 0, 0, 0, 0], 0)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("never charges a seat that was not paid", () => {
    const shares = attributeRake([0, 0, 5_000, 0, 0, 0], 100);
    expect(shares[0]).toBe(0);
    expect(shares[1]).toBe(0);
    expect(shares[2]).toBe(100);
  });
});

describe("computeResultHash", () => {
  const seed = "11".repeat(32);
  const board = [8, 19, 34, 47, 3];
  const payouts = [0, 9_750, 0, 0, 0, 0];

  it("hashes the preimage settle.rs hashes", () => {
    // Built here byte by byte, by a different route than the implementation
    // takes: hand number u64 LE, seed, board, then every payout u64 LE.
    const buf = Buffer.concat([
      (() => {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(42n);
        return b;
      })(),
      Buffer.from(seed, "hex"),
      Buffer.from(board),
      ...payouts.map((p) => {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(p));
        return b;
      }),
    ]);
    expect(buf.length).toBe(8 + 32 + 5 + 48);
    const expected = createHash("sha256").update(buf).digest("hex");
    expect(computeResultHash(42, seed, board, payouts)).toBe(expected);
  });

  it("is a different hash for a different payout", () => {
    // The property the server's gate depends on: payouts cannot be swapped
    // for a wallet's benefit without breaking the digest the chain published.
    const honest = computeResultHash(42, seed, board, payouts);
    const tampered = computeResultHash(42, seed, board, [9_750, 0, 0, 0, 0, 0]);
    expect(tampered).not.toBe(honest);
  });

  it("distinguishes the seat a payout landed in", () => {
    const a = computeResultHash(42, seed, board, [100, 200, 0, 0, 0, 0]);
    const b = computeResultHash(42, seed, board, [200, 100, 0, 0, 0, 0]);
    expect(a).not.toBe(b);
  });
});
