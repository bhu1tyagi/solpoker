import { describe, it, expect } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import {
  shuffle,
  combineSeed,
  verify,
  cardName,
  hex,
  type HandHistory,
  type HistorySeat,
} from "./verify-shuffle";

describe("shuffle", () => {
  /**
   * The pinned vector. Rust's Deck::shuffled_from_seed(&[7u8; 32]) and
   * tools/verify-shuffle.mjs both produce this. If the browser port drifts,
   * this is what catches it.
   */
  it("reproduces the known seed vector", () => {
    const deck = shuffle(new Uint8Array(32).fill(7));
    const first10 = Array.from(deck.slice(0, 10)).map(cardName).join(" ");
    expect(first10).toBe("3d 5c 7s Kd Qc 8c As Jd 4d 2d");
  });

  it("is a permutation of all 52 cards", () => {
    const deck = shuffle(new Uint8Array(32).fill(7));
    expect(new Set(deck).size).toBe(52);
    expect(Math.min(...deck)).toBe(0);
    expect(Math.max(...deck)).toBe(51);
  });

  it("gives a different order for a different seed", () => {
    const a = shuffle(new Uint8Array(32).fill(7));
    const b = shuffle(new Uint8Array(32).fill(8));
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe("combineSeed", () => {
  it("xors every salt into the vrf output", () => {
    const vrf = new Uint8Array(32).fill(0xff);
    const s1 = new Uint8Array(32).fill(0x0f);
    const s2 = new Uint8Array(32).fill(0x33);
    const out = combineSeed(vrf, [s1, s2]);
    expect(out[0]).toBe(0xff ^ 0x0f ^ 0x33);
  });

  it("does not mutate the input", () => {
    const vrf = new Uint8Array(32).fill(0xff);
    combineSeed(vrf, [new Uint8Array(32).fill(1)]);
    expect(vrf[0]).toBe(0xff);
  });
});

/**
 * Build a self-consistent history the way a real hand now produces one.
 *
 * The board is the top five cards of the published seed's deck. Hole cards come
 * from a second, unpublished draw, so they are simply cards that are not on the
 * board — there is no derivation for the verifier to check any more, and that
 * is the point: deriving them from published data is what made every folded
 * hand public.
 */
function buildHistory(): HandHistory & { seats: HistorySeat[]; board: number[] } {
  const vrf = new Uint8Array(32).fill(0x11);
  const salts = [new Uint8Array(32).fill(0x22), new Uint8Array(32).fill(0x33)];
  const seed = combineSeed(vrf, salts);
  const deck = shuffle(seed);
  return {
    handNumber: 1,
    vrfRandomness: hex(vrf),
    shuffleSeed: hex(seed),
    board: Array.from(deck.slice(0, 5)),
    seats: [
      {
        index: 0,
        dealtIn: true,
        saltCommit: hex(sha256(salts[0])),
        salt: hex(salts[0]),
        revealed: [deck[5], deck[6]],
      },
      {
        index: 1,
        dealtIn: true,
        saltCommit: hex(sha256(salts[1])),
        salt: hex(salts[1]),
        revealed: [deck[7], deck[8]],
      },
    ],
  };
}

describe("verify", () => {
  it("accepts an honest hand", () => {
    const result = verify(buildHistory());
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("catches a salt that does not match its commitment", () => {
    const h = buildHistory();
    h.seats[0].salt = hex(new Uint8Array(32).fill(0x99));
    const result = verify(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("does not match its commitment");
  });

  it("catches a board that does not come from the seed", () => {
    const h = buildHistory();
    // Five cards that are not the seed's top five, in an order it never gives.
    h.board = [0, 1, 2, 3, 4];
    const result = verify(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("but the seed gives");
  });

  it("catches a shown hand claiming a card that is on the board", () => {
    const h = buildHistory();
    h.seats[1].revealed = [h.board[0], h.seats[1].revealed![1]];
    const result = verify(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("which is on the board");
  });

  it("catches two seats showing the same card", () => {
    const h = buildHistory();
    h.seats[1].revealed = [...h.seats[0].revealed!];
    const result = verify(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("already shown");
  });

  /**
   * The deliberate loss. Hole cards used to be derived from the published seed
   * and checked exactly; they no longer can be, because that derivation is what
   * published every mucked hand. A plausible-but-wrong shown hand now passes,
   * and that is the trade this design makes on purpose.
   */
  it("no longer derives hole cards, and says so by accepting an unprovable one", () => {
    const h = buildHistory();
    h.seats[1].revealed = [49, 50];
    const result = verify(h);
    expect(result.ok).toBe(true);
    expect(result.expectedHoles).toEqual({});
  });

  it("catches a seed that is not vrf xor salts", () => {
    const h = buildHistory();
    h.shuffleSeed = hex(new Uint8Array(32).fill(0xab));
    const result = verify(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("does not equal VRF XOR salts");
  });

  it("flags a hand with too few salts", () => {
    const h = buildHistory();
    h.seats[1].salt = null;
    const result = verify(h);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("need at least 2");
  });
});
