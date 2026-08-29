import { beforeAll, describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import { combineSeed, hex, shuffle } from "@/lib/verifier/verify-shuffle";
import { computeResultHash } from "@/lib/verifier/result-hash";
import { rakeFor } from "@/lib/rake";
import { nameMessage } from "@/lib/profile-name";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

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
    // Written out rather than `= ANY(${WALLETS})`: the pool runs with
    // `fetch_types: false`, which removes a round trip per connection and
    // with it the ability to encode a JS array as a Postgres array.
    for (const w of WALLETS) {
      await s`DELETE FROM players WHERE wallet = ${w}`;
    }
  });

  /** All six seats, with `at` holding the given per-seat values. */
  const spread = (at: Record<number, number>) =>
    Array.from({ length: 6 }, (_, i) => at[i] ?? 0);

  /** The seats dealt into a hand, as the program's bitmask. */
  const mask = (...seats: number[]) =>
    seats.reduce((m, i) => m | (1 << i), 0);

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
    // Three seats put in 4_000, 4_000 and 2_000; seat 1 takes it all.
    const contributed = spread({ 0: 4_000, 1: 4_000, 2: 2_000 });
    const pot = 10_000;
    const payouts = [0, pot - rakeFor(pot, BB, true), 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(1, payouts),
      potChips: pot,
      results: {
        bigBlind: BB,
        payouts,
        contributed,
        wallets: [WALLETS[0], WALLETS[1], WALLETS[2], null, null, null],
        dealtIn: mask(0, 1, 2),
      },
    });
    expect(body).toEqual({ stored: true, results: true });
  });

  it("gives the losers a row of their own", async () => {
    // The whole reason for the change: a seat that lost has to exist in the
    // record, or every profile reads as pure profit.
    const { db } = await import("./db");
    const rows = await db()!`
      SELECT wallet, payout_chips, contributed_chips
        FROM hand_players
       WHERE table_id = 4242 AND hand_number = 1
       ORDER BY seat`;
    expect(rows.length).toBe(3);
    const loser = rows.find((r) => r.wallet === WALLETS[0])!;
    expect(Number(loser.payout_chips)).toBe(0);
    expect(Number(loser.contributed_chips)).toBe(4_000);
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
        contributed: spread({ 0: 10_000, 1: 10_000 }),
        wallets: [WALLETS[0], WALLETS[1], null, null, null, null],
        dealtIn: mask(0, 1),
      },
    });
    expect(body).toEqual({ stored: true, results: true });
  });

  it("keeps the payouts but drops contributions that do not sum to the pot", async () => {
    // Contributions are checked against a pot the hash pins. A claim that
    // does not add up loses the profit half and keeps the proven half —
    // figures go missing rather than going wrong.
    const pot = 10_000;
    const payouts = [0, pot - rakeFor(pot, BB, true), 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(6, payouts),
      potChips: pot,
      results: {
        bigBlind: BB,
        payouts,
        contributed: spread({ 0: 1, 1: 1 }),
        wallets: [WALLETS[0], WALLETS[1], null, null, null, null],
        dealtIn: mask(0, 1),
      },
    });
    expect(body).toEqual({ stored: true, results: true });
    const { db } = await import("./db");
    const rows = await db()!`
      SELECT contributed_chips FROM hand_players
       WHERE table_id = 4242 AND hand_number = 6`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.contributed_chips).toBeNull();
  });

  it("takes the same hand from six clients and lands it once", async () => {
    // Counted as a delta rather than against a fixed total, so adding a case
    // above this one cannot make it fail for a reason it is not testing.
    const countHands = async () => {
      const { db } = await import("./db");
      const rows = await db()!`
        SELECT count(DISTINCT hand_number) AS n
          FROM hand_players WHERE table_id = 4242`;
      return Number(rows[0].n);
    };
    const before = await countHands();
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
          contributed: spread({ 2: 2_000, 0: 2_000 }),
          wallets: [WALLETS[0], null, WALLETS[2], null, null, null],
          dealtIn: mask(0, 2),
        },
      });
      expect(body.stored).toBe(true);
    }
    expect(await countHands()).toBe(before + 1);
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
        contributed: spread({ 0: 5_000, 1: 5_000 }),
        wallets: [WALLETS[0], WALLETS[1], null, null, null, null],
        dealtIn: mask(0, 1),
      },
    });
    expect(body).toEqual({ stored: true, results: false });
  });

  it("refuses a hand with no wallet to credit at all", async () => {
    const pot = 10_000;
    const payouts = [0, pot - rakeFor(pot, BB, true), 0, 0, 0, 0];
    const { body } = await post({
      ...buildHand(5, payouts),
      potChips: pot,
      results: {
        bigBlind: BB,
        payouts,
        contributed: spread({ 0: 5_000, 1: 5_000 }),
        wallets: [null, null, null, null, null, null],
        dealtIn: mask(0, 1),
      },
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

  it("gives a caller their own rake and a true rank", async () => {
    const res = await rewards.GET(
      new Request(`http://x/api/rewards?wallet=${WALLETS[1]}`),
    );
    const b = await res.json();
    expect(b.you).not.toBeNull();
    expect(b.you.rakeChips).toBeGreaterThan(0);
    expect(b.you.rakeRank).toBeGreaterThanOrEqual(1);
  });

  it("reads an unknown wallet as a known zero, not as an unknown", async () => {
    const res = await rewards.GET(
      new Request("http://x/api/rewards?wallet=11111111111111111111111111111111"),
    );
    const b = await res.json();
    expect(b.you).toEqual({
      rakeChips: 0,
      rakeRank: 0,
      netChips: null,
      netRank: null,
      shareBps: null,
      eligible: false,
    });
  });

  it("ignores a wallet that will not parse rather than failing the page", async () => {
    const res = await rewards.GET(new Request("http://x/api/rewards?wallet=notakey"));
    expect(res.status).toBe(200);
    expect((await res.json()).you).toBeNull();
  });

  it("builds a profile with profit, losses and both extremes", async () => {
    const profile = await import("@/app/api/profile/route");
    const res = await profile.GET(
      new Request(`http://x/api/profile?wallet=${WALLETS[0]}`),
    );
    const b = await res.json();
    // Seat 0 lost 4_000 in hand 1 and split hand 2 back to even-ish.
    expect(b.stored).toBe(true);
    expect(b.handsPlayed).toBeGreaterThan(0);
    expect(b.profitHands).toBeGreaterThan(0);
    // Profit is what came out less what went in, so a losing hand pulls it
    // down — the number this whole change exists to make possible.
    expect(b.netChips).toBeLessThan(b.wonChips);
    expect(b.biggestLossChips).toBeLessThan(0);
    expect(b.lostAmountChips).toBeGreaterThan(0);
  });

  it("counts a hand nobody could price out of the profit figures", async () => {
    // Hand 6's contributions did not check out, so it is a hand played and a
    // hand that cannot be priced. The counts must differ, and the page shows
    // the difference rather than implying the net covers everything.
    const profile = await import("@/app/api/profile/route");
    const res = await profile.GET(
      new Request(`http://x/api/profile?wallet=${WALLETS[0]}`),
    );
    const b = await res.json();
    expect(b.profitHands).toBeLessThan(b.handsPlayed);
  });
  it("ranks a wallet against everyone, not against itself", async () => {
    /*
     * The regression this exists for.
     *
     * The rank was a `rank() OVER (...)` with the wallet in the outer WHERE.
     * SQL applies WHERE before window functions, so the window saw a single
     * row and every player was told they were rank 1. The old assertion here
     * was `rakeRank >= 1`, which that bug satisfies perfectly — so the check
     * now compares the reported rank against one counted independently.
     */
    const { db } = await import("./db");
    const sql = db()!;
    const me = WALLETS[0];

    const res = await rewards.GET(
      new Request(`http://x/api/rewards?wallet=${me}`),
    );
    const reported = (await res.json()).you.rakeRank;

    const counted = await sql`
      WITH per_wallet AS (
        SELECT wallet, sum(rake_chips) AS rake
          FROM hand_players WHERE cluster = 'devnet' GROUP BY wallet
      )
      SELECT count(*) + 1 AS rank FROM per_wallet a
       WHERE a.rake > (SELECT rake FROM per_wallet WHERE wallet = ${me})
          OR (a.rake = (SELECT rake FROM per_wallet WHERE wallet = ${me})
              AND a.wallet < ${me})`;

    expect(reported).toBe(Number(counted[0].rank));
    // And at least one wallet must genuinely be ahead of this one, or the
    // comparison above would pass against the very bug it is guarding.
    expect(reported).toBeGreaterThan(1);
  });
});

describeIfDb("display names", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let profile: any;
  const kp = Keypair.generate();
  const wallet = kp.publicKey.toBase58();

  const claim = async (name: string, opts: { issuedAt?: number; signer?: Keypair } = {}) => {
    const issuedAt = opts.issuedAt ?? Date.now();
    const message = new TextEncoder().encode(nameMessage(wallet, name, issuedAt));
    const signature = bs58.encode(
      nacl.sign.detached(message, (opts.signer ?? kp).secretKey),
    );
    const res = await profile.POST(
      new Request("http://x/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, name, issuedAt, signature }),
      }),
    );
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    profile = await import("@/app/api/profile/route");
    const { db, ensureSchema } = await import("./db");
    const s = db()!;
    await ensureSchema(s);
    await s`DELETE FROM players WHERE wallet = ${wallet}`;
  });

  it("accepts a name the wallet signed for itself", async () => {
    const { status, body } = await claim("Doyle");
    expect(status).toBe(200);
    expect(body.displayName).toBe("Doyle");
  });

  it("refuses a name signed by a different wallet", async () => {
    // The attack this endpoint exists to stop: setting a name on somebody
    // else's account. The signature is valid, just not theirs.
    const { status } = await claim("Impostor", { signer: Keypair.generate() });
    expect(status).toBe(401);
  });

  it("refuses a signature that has gone stale", async () => {
    const { status } = await claim("Later", { issuedAt: Date.now() - 60 * 60 * 1000 });
    expect(status).toBe(400);
  });

  it("refuses a signature dated into the future", async () => {
    const { status } = await claim("Sooner", { issuedAt: Date.now() + 60 * 60 * 1000 });
    expect(status).toBe(400);
  });

  it("refuses a name carrying a newline", async () => {
    // A newline would let the approval dialog render the claim as more than
    // one field, which is how a player gets talked into signing something
    // other than what they read.
    const { status } = await claim("bob\nWallet: someone else");
    expect(status).toBe(400);
  });

  it("refuses an invisible character that would clone another name", async () => {
    const { status } = await claim("Doyle\u200b");
    expect(status).toBe(400);
  });

  it("shows the name on the profile once it is set", async () => {
    const res = await profile.GET(
      new Request(`http://x/api/profile?wallet=${wallet}`),
    );
    expect((await res.json()).displayName).toBe("Doyle");
  });

});
