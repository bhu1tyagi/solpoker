import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";
import {
  MIN_ELIGIBLE_RAKE_CHIPS,
  REWARDS_BOARD_SIZE,
  poolFromRake,
} from "@/lib/rewards";

export const runtime = "nodejs";

/**
 * What every wallet has won, and what every wallet has paid for it.
 *
 * All of it is a sum over `hand_players`, which only has rows for hands a
 * client captured and the server proved against the chain's own result hash.
 * That makes the figures here complete for the hands they cover and silent
 * about the rest, so the page says "recorded" everywhere rather than implying
 * a full ledger — and `since` is served alongside so it can say from when.
 *
 * The two boards answer different questions and must not be conflated. What a
 * wallet WON is what came back out of pots, stake included, so it is a measure
 * of pots captured rather than profit. What a wallet PAID is rake, and that is
 * the only figure an allocation is computed from: the pool is a fifth of the
 * rake collected, shared out in proportion to the rake each player generated.
 * Contribution decides it, not winning, so nobody's allocation depends on
 * having beaten anybody.
 */

interface Board {
  wallet: string;
  chips: number;
  hands: number;
}

interface Payload {
  stored: boolean;
  since: number | null;
  handsRecorded: number | null;
  rakeChips: number | null;
  poolChips: number | null;
  contributors: number | null;
  eligibleRakeChips: number | null;
  winners: Board[];
  contributorsBoard: Board[];
  you: {
    wonChips: number;
    handsWon: number;
    rakeChips: number;
    wonRank: number;
    rakeRank: number;
    /** Share of the pool, in basis points, or null below the floor. */
    shareBps: number | null;
    eligible: boolean;
  } | null;
}

const NOTHING: Payload = {
  stored: false,
  since: null,
  handsRecorded: null,
  rakeChips: null,
  poolChips: null,
  contributors: null,
  eligibleRakeChips: null,
  winners: [],
  contributorsBoard: [],
  you: null,
};

const headers = { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" };

/**
 * The payload minus the caller, briefly remembered.
 *
 * Everything except `you` is identical for every reader, and rebuilding it
 * means four grouped scans against a database on the other side of the world.
 * The caller's own row is cheap and indexed, so it stays outside the memo and
 * a player never sees a stale figure for themselves.
 */
let memo: { at: number; payload: Omit<Payload, "you"> } | null = null;
let inFlight: Promise<Omit<Payload, "you">> | null = null;
const MEMO_MS = 15_000;

const n = (v: unknown) => Number(v ?? 0);

export async function GET(req: Request) {
  const s = db();
  // No database attached. Nobody is keeping track, which is a different claim
  // from nobody having won anything, and the flag is what lets the page say so.
  if (!s) return NextResponse.json(NOTHING, { headers });

  // A wallet that will not parse is dropped rather than argued with: the board
  // is public either way, and only the "you" panel depends on it.
  let me: string | null = null;
  const asked = new URL(req.url).searchParams.get("wallet");
  if (asked) {
    try {
      me = new PublicKey(asked).toBase58();
    } catch {
      me = null;
    }
  }

  try {
    await ensureSchema(s);

    const build = async (): Promise<Omit<Payload, "you">> => {
      const [totals, eligible, winners, contributors] = await Promise.all([
        s`
          SELECT coalesce(sum(rake_chips), 0)          AS rake,
                 count(DISTINCT (table_id, hand_number)) AS hands,
                 min(settled_at)                       AS since
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG}`,
        s`
          SELECT count(*)                     AS contributors,
                 coalesce(sum(rake), 0)       AS eligible_rake
            FROM (SELECT sum(rake_chips) AS rake
                    FROM hand_players
                   WHERE cluster = ${CLUSTER_TAG}
                   GROUP BY wallet
                  HAVING sum(rake_chips) >= ${MIN_ELIGIBLE_RAKE_CHIPS}) t`,
        s`
          SELECT wallet, sum(payout_chips) AS chips, count(*) AS hands
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG}
           GROUP BY wallet
          HAVING sum(payout_chips) > 0
           ORDER BY chips DESC, wallet
           LIMIT 100`,
        s`
          SELECT wallet, sum(rake_chips) AS chips, count(*) AS hands
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG}
           GROUP BY wallet
          HAVING sum(rake_chips) > 0
           ORDER BY chips DESC, wallet
           LIMIT ${REWARDS_BOARD_SIZE}`,
      ]);

      const rake = n(totals[0]?.rake);
      const since = totals[0]?.since as Date | null;
      const board = (rows: readonly Record<string, unknown>[]): Board[] =>
        rows.map((r) => ({
          wallet: String(r.wallet),
          chips: n(r.chips),
          hands: n(r.hands),
        }));

      return {
        stored: true,
        since: since ? new Date(since).getTime() : null,
        handsRecorded: n(totals[0]?.hands),
        rakeChips: rake,
        poolChips: poolFromRake(rake),
        contributors: n(eligible[0]?.contributors),
        eligibleRakeChips: n(eligible[0]?.eligible_rake),
        winners: board(winners),
        contributorsBoard: board(contributors),
      };
    };

    let shared: Omit<Payload, "you">;
    if (memo && Date.now() - memo.at < MEMO_MS) {
      shared = memo.payload;
    } else {
      // One builder at a time. A burst of cold readers would otherwise each
      // run the same four grouped scans.
      inFlight ??= build().finally(() => {
        inFlight = null;
      });
      shared = await inFlight;
      memo = { at: Date.now(), payload: shared };
    }

    let you: Payload["you"] = null;
    if (me) {
      /*
       * Ranked over every wallet, not over the page above, so the position is
       * the real one. The wallet tiebreak makes it deterministic: two players
       * on identical rake would otherwise swap places between reads and the
       * board would appear to churn on its own.
       */
      const rows = await s`
        WITH per_wallet AS (
          SELECT wallet,
                 sum(payout_chips) AS won,
                 sum(rake_chips)   AS rake,
                 count(*)          AS hands
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG}
           GROUP BY wallet
        )
        SELECT won, rake, hands,
               rank() OVER (ORDER BY won DESC, wallet)  AS won_rank,
               rank() OVER (ORDER BY rake DESC, wallet) AS rake_rank
          FROM per_wallet
         WHERE wallet = ${me}`;
      const row = rows[0];
      if (row) {
        const mine = n(row.rake);
        const eligibleRake = shared.eligibleRakeChips ?? 0;
        const isEligible = mine >= MIN_ELIGIBLE_RAKE_CHIPS;
        you = {
          wonChips: n(row.won),
          handsWon: n(row.hands),
          rakeChips: mine,
          wonRank: n(row.won_rank),
          rakeRank: n(row.rake_rank),
          // Basis points of the pool. Null rather than zero below the floor:
          // the share is not yet defined, which is not the same as being nil.
          shareBps:
            isEligible && eligibleRake > 0
              ? Math.round((mine / eligibleRake) * 10_000)
              : null,
          eligible: isEligible,
        };
      } else {
        // The wallet is known to be absent, which is worth saying plainly
        // rather than rendering as an unknown.
        you = {
          wonChips: 0,
          handsWon: 0,
          rakeChips: 0,
          wonRank: 0,
          rakeRank: 0,
          shareBps: null,
          eligible: false,
        };
      }
    }

    return NextResponse.json({ ...shared, you } satisfies Payload, { headers });
  } catch {
    // A database that will not answer is not a room where nobody has won
    // anything. Fall back to saying nothing is known.
    return NextResponse.json(NOTHING, { headers });
  }
}
