import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import { combineSeed, hex, shuffle } from "@/lib/verifier/verify-shuffle";
import { computeResultHash } from "@/lib/verifier/result-hash";
import { rakeFor } from "@/lib/rake";

/**
 * The rewards path, end to end, against a real database.
 *
 * Named `.devnet` to follow the convention the decode and play checks use:
 * anything needing something outside the process is opt-in, so a plain
 * `npm test` stays offline. This one needs a Postgres and nothing else.
 *
 *   docker run -d --name pokerable-pg -e POSTGRES_PASSWORD=dev \
 *     -e POSTGRES_DB=pokerable -p 55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgres://postgres:dev@localhost:55432/pokerable \
 *     npx vitest run --config vitest.devnet.config.ts
 *
 * Every hand below is built the way the chain builds one — real salts, a real
 * VRF combine, a real Fisher-Yates deck, and a real digest over the payouts —
 * so nothing here is stubbed. A pass means the actual route accepted an honest
 * hand, refused a dishonest one, and the actual queries summed what was left.
 */

const WALLETS = [
  "8ZKTt8dEBvsFhFtcNCPvXxvhqzMcaXRRcFrJdQJPY3nY",
  "3nLUyPTaFR8xzYPB4XyeVJKvJdqmPTsVELnRoZL4NPBg",
  "CqXk9kW8XL5nKPGD1DhVWkbCEo4hLrCQpNqJmY1AoUeN",
];

/** A hand the shuffle verifier will accept, carrying the payouts given. */
function buildHand(handNumber: number, payouts: number[]) {
  const salts = [0, 1, 2].map((i) =>
    Uint8Array.from({ length: 32 }, (_, j) => (handNumber * 31 + i * 7 + j) % 251),
  );
  const vrf = Uint8Array.from({ length: 32 }, (_, j) => (handNumber * 17 + j) % 253);
  const seed = combineSeed(vrf, salts);
  const board = Array.from(shuffle(seed).slice(0, 5));
  const shuffleSeed = hex(seed);
  return {
    tableId: 4242,
    handNumber,
    vrfRandomness: hex(vrf),
    shuffleSeed,
    board,
    capturedAt: Date.now(),
    resultHash: computeResultHash(handNumber, shuffleSeed, board, payouts),
    seats: salts.map((s, i) => ({
      index: i,
      dealtIn: true,
      saltCommit: hex(sha256(s)),
      salt: hex(s),
      revealed: null,
    })),
  };
}

const url = process.env.DATABASE_URL;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("rewards, against a real database", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let hands: any;
  let rewards: any;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    hands = await import("@/app/api/hands/route");
    rewards = await import("@/app/api/rewards/route");
    const { db, ensureSchema } = await import("./db");
    const s = db()!;
    await ensureSchema(s);

    /*
     * A clean slate for THIS table only.
     *
     * Never a DROP and never an unqualified DELETE. DATABASE_URL is one
     * environment variable away from being the production database, and a
     * test that tidies up after itself by dropping hand_players would take
     * every player's recorded winnings with it — the one table in this schema
     * that cannot be rebuilt from chain, because the chain does not keep it.
     * Scoped to table 4242 the worst case is deleting rows this file wrote.
     */
    await s`DELETE FROM hand_players WHERE table_id = 4242`;
    await s`DELETE FROM hands WHERE table_id = 4242`;
  });

  const post = async (body: unknown) => {
    const res = await hands.POST(
      new Request("http://x/api/hands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json() };
  };

  const BB = 100;

  it("stores a sole winner and charges them the whole rake", async () => {
    const pot = 10_000;
    const payouts = [0, pot - rakeFor(pot, BB, true), 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(1, payouts),
      potChips: pot,
      results: {
        bigBlind: BB,
        payouts,
        wallets: [null, WALLETS[1], null, null, null, null],
      },
    });
    expect(body).toEqual({ stored: true, results: true });
  });

  it("stores a split pot, raked once between the winners", async () => {
    const pot = 20_000;
    const each = (pot - rakeFor(pot, BB, true)) / 2;
    const payouts = [each, each, 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(2, payouts),
      potChips: pot,
      results: {
        bigBlind: BB,
        payouts,
        wallets: [WALLETS[0], WALLETS[1], null, null, null, null],
      },
    });
    expect(body).toEqual({ stored: true, results: true });
  });

  it("takes the same hand from six clients and lands it once", async () => {
    const pot = 4_000;
    const payouts = [0, 0, pot - rakeFor(pot, BB, true), 0, 0, 0];
    const hand = buildHand(3, payouts);
    for (let i = 0; i < 6; i++) {
      const { body } = await post({
        ...hand,
        potChips: pot,
        results: {
          bigBlind: BB,
          payouts,
          wallets: [null, null, WALLETS[2], null, null, null],
        },
      });
      expect(body.stored).toBe(true);
    }
    const res = await rewards.GET(new Request("http://x/api/rewards"));
    const b = await res.json();
    expect(b.handsRecorded).toBe(3);
  });

  it("refuses payouts the result hash does not back, and keeps the hand", async () => {
    // The gate the whole design rests on. Same proven hand, money moved to a
    // seat that did not win it.
    const pot = 10_000;
    const honest = [0, pot - rakeFor(pot, BB, true), 0, 0, 0, 0];
    const stolen = [pot - rakeFor(pot, BB, true), 0, 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(4, honest),
      potChips: pot,
      results: {
        bigBlind: BB,
        payouts: stolen,
        wallets: [WALLETS[0], null, null, null, null, null],
      },
    });
    expect(body).toEqual({ stored: true, results: false });
  });

  it("refuses a payout with no wallet to credit", async () => {
    const pot = 10_000;
    const payouts = [0, pot - rakeFor(pot, BB, true), 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(5, payouts),
      potChips: pot,
      results: { bigBlind: BB, payouts, wallets: [null, null, null, null, null, null] },
    });
    expect(body).toEqual({ stored: true, results: false });
  });

  it("sums a pool that is exactly a fifth of the rake it recorded", async () => {
    const res = await rewards.GET(new Request("http://x/api/rewards"));
    const b = await res.json();
    expect(b.stored).toBe(true);
    expect(b.poolChips).toBe(Math.floor(b.rakeChips * 0.2));
    // Nothing invented and nothing lost: the board accounts for every chip of
    // rake the totals claim.
    const boardSum = b.contributorsBoard.reduce(
      (n: number, r: { chips: number }) => n + r.chips,
      0,
    );
    expect(boardSum).toBe(b.rakeChips);
    expect(b.since).toBeGreaterThan(0);
  });

  it("gives a caller their own figures and a true rank", async () => {
    const res = await rewards.GET(
      new Request(`http://x/api/rewards?wallet=${WALLETS[1]}`),
    );
    const b = await res.json();
    expect(b.you).not.toBeNull();
    expect(b.you.wonChips).toBeGreaterThan(0);
    expect(b.you.rakeChips).toBeGreaterThan(0);
    expect(b.you.wonRank).toBeGreaterThanOrEqual(1);
    expect(b.you.rakeRank).toBeGreaterThanOrEqual(1);
  });

  it("reads an unknown wallet as a known zero, not as an unknown", async () => {
    const res = await rewards.GET(
      new Request("http://x/api/rewards?wallet=11111111111111111111111111111111"),
    );
    const b = await res.json();
    expect(b.you).toEqual({
      wonChips: 0,
      handsWon: 0,
      rakeChips: 0,
      wonRank: 0,
      rakeRank: 0,
      shareBps: null,
      eligible: false,
    });
  });

  it("ignores a wallet that will not parse rather than failing the page", async () => {
    const res = await rewards.GET(new Request("http://x/api/rewards?wallet=notakey"));
    expect(res.status).toBe(200);
    expect((await res.json()).you).toBeNull();
  });
});
