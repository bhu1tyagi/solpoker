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
  displayName: string | null;
  chips: number;
  hands: number;
}

/** One day, with every figure cumulative to that day. */
export interface PoolPoint {
  at: number;
  /** All rake collected, to date. */
  rake: number;
  /** The players' share of it — the pool as it stood that day. */
  pool: number;
  /** The caller's own rake to date, when a wallet was named. */
  yours: number | null;
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
  series: PoolPoint[];
  /*
   * Only what this page is for.
   *
   * Winnings, losses and profit moved to the profile: rewards answers "what
   * am I owed and why", and the answer is rake, because rake is what earns a
   * share. `netChips` stays solely so the profit board can pin a true rank
   * for the reader without them hunting the list.
   */
  you: {
    rakeChips: number;
    rakeRank: number;
    netChips: number | null;
    netRank: number | null;
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
  series: [],
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
      const [totals, handCount, eligible, winners, contributors, daily] =
        await Promise.all([
        /*
         * The hand count is a distinct scan, not a `count(DISTINCT (a, b))`.
         *
         * Both give the same answer; only one is affordable. Counting distinct
         * ROW values builds and sorts a composite per row and cannot use an
         * index, while a plain DISTINCT over the two columns hashes them.
         * Measured at 250k rows: 380ms against 33ms, an eleven-fold difference
         * on the query that gates the whole rewards payload. An index on
         * (cluster, table_id, hand_number) was tried and made it slower —
         * 40ms — while adding write cost to every hand reported, so there
         * isn't one.
         */
        s`
          SELECT coalesce(sum(rake_chips), 0) AS rake,
                 min(settled_at)              AS since
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG}`,
        s`
          SELECT count(*) AS hands
            FROM (SELECT DISTINCT table_id, hand_number
                    FROM hand_players
                   WHERE cluster = ${CLUSTER_TAG}) t`,
        s`
          SELECT count(*)                     AS contributors,
                 coalesce(sum(rake), 0)       AS eligible_rake
            FROM (SELECT sum(rake_chips) AS rake
                    FROM hand_players
                   WHERE cluster = ${CLUSTER_TAG}
                   GROUP BY wallet
                  HAVING sum(rake_chips) >= ${MIN_ELIGIBLE_RAKE_CHIPS}) t`,
        /*
         * The board ranks PROFIT, not pots captured.
         *
         * Ranking by what came out of pots would put a player who churns big
         * pots to break even above one who genuinely wins, because a payout
         * includes the stake that went in to claim it. On a real-money
         * product that is not a quirky sort order, it is a leaderboard that
         * misrepresents who is winning. Net is what came out minus what went
         * in, over the hands where both are known.
         */
        s`
          SELECT h.wallet, sum(h.payout_chips - h.contributed_chips) AS chips,
                 count(*) AS hands, p.display_name
            FROM hand_players h
            LEFT JOIN players p
              ON p.cluster = h.cluster AND p.wallet = h.wallet
           WHERE h.cluster = ${CLUSTER_TAG} AND h.contributed_chips IS NOT NULL
           GROUP BY h.wallet, p.display_name
          HAVING sum(h.payout_chips - h.contributed_chips) > 0
           ORDER BY chips DESC, h.wallet
           LIMIT 100`,
        s`
          SELECT h.wallet, sum(h.rake_chips) AS chips,
                 count(*) AS hands, p.display_name
            FROM hand_players h
            LEFT JOIN players p
              ON p.cluster = h.cluster AND p.wallet = h.wallet
           WHERE h.cluster = ${CLUSTER_TAG}
           GROUP BY h.wallet, p.display_name
          HAVING sum(h.rake_chips) > 0
           ORDER BY chips DESC, h.wallet
           LIMIT ${REWARDS_BOARD_SIZE}`,
        /*
         * The pool as it accrued, one row per day with rake in it.
         *
         * Bucketed in the database and capped at two years: the chart draws a
         * point per day however many hands are behind it, so shipping the raw
         * rows would be a large payload to throw away on arrival.
         */
        s`
          SELECT date_trunc('day', settled_at) AS day,
                 coalesce(sum(rake_chips), 0)  AS rake
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG}
             AND settled_at > now() - interval '2 years'
           GROUP BY 1
           ORDER BY 1`,
      ]);

      // Cumulated here so the running total and the fifth taken off it are
      // both plain to read, and so the pool can never drift from the rake it
      // is a share of.
      let running = 0;
      const series: PoolPoint[] = daily.map((r) => {
        running += n(r.rake);
        return {
          at: new Date(r.day as Date).getTime(),
          rake: running,
          pool: poolFromRake(running),
          yours: null,
        };
      });

      const rake = n(totals[0]?.rake);
      const since = totals[0]?.since as Date | null;
      const board = (rows: readonly Record<string, unknown>[]): Board[] =>
        rows.map((r) => ({
          wallet: String(r.wallet),
          // Never instead of the address, always beside it. The interface
          // renders both, so a name cannot be used to pass for someone else.
          displayName: (r.display_name as string | null) ?? null,
          chips: n(r.chips),
          hands: n(r.hands),
        }));

      return {
        stored: true,
        since: since ? new Date(since).getTime() : null,
        handsRecorded: n(handCount[0]?.hands),
        rakeChips: rake,
        poolChips: poolFromRake(rake),
        contributors: n(eligible[0]?.contributors),
        eligibleRakeChips: n(eligible[0]?.eligible_rake),
        winners: board(winners),
        contributorsBoard: board(contributors),
        series,
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

    let series = shared.series;
    let you: Payload["you"] = null;

    if (me) {
      /*
       * Both caller queries at once.
       *
       * They do not depend on each other and were awaited one after the other,
       * which against a database in another region is two full round trips —
       * about half a second of pure latency for a panel showing two numbers.
       */
      const [mineDaily, rows] = await Promise.all([
        /*
         * The caller's own contribution, drawn against the pool it feeds.
         * Aligned onto the shared day points below so the two lines share an
         * x-axis; a day the player did not play holds their previous total,
         * which is the truth — their contribution did not fall, it simply did
         * not grow.
         */
        s`
          SELECT date_trunc('day', settled_at) AS day,
                 coalesce(sum(rake_chips), 0)  AS rake
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG} AND wallet = ${me}
             AND settled_at > now() - interval '2 years'
           GROUP BY 1
           ORDER BY 1`,
        /*
         * Where the caller actually stands, counted rather than ranked.
         *
         * This was a `rank() OVER (...)` with the wallet in the outer WHERE,
         * and it was silently wrong for every player: SQL applies WHERE BEFORE
         * window functions, so the window saw one row and the answer was
         * always 1. Measured against a 5,000-wallet set, the route reported
         * rank 1 where the true rank was 1,343.
         *
         * Counting the wallets ahead cannot make that mistake — the comparison
         * is written out rather than implied by evaluation order — and it
         * measured twice as fast as the correct windowed form (35ms against
         * 69ms), because it never sorts the whole set.
         *
         * The wallet tiebreak keeps it deterministic: two players on identical
         * rake would otherwise swap places between reads.
         */
        s`
          WITH per_wallet AS (
            SELECT wallet,
                   sum(rake_chips) AS rake,
                   sum(payout_chips - contributed_chips)
                     FILTER (WHERE contributed_chips IS NOT NULL) AS net
              FROM hand_players
             WHERE cluster = ${CLUSTER_TAG}
             GROUP BY wallet
          ),
          mine AS (SELECT rake, net FROM per_wallet WHERE wallet = ${me})
          SELECT m.rake, m.net,
                 (SELECT count(*) + 1 FROM per_wallet a
                   WHERE a.rake > m.rake
                      OR (a.rake = m.rake AND a.wallet < ${me})) AS rake_rank,
                 CASE WHEN m.net IS NULL THEN NULL ELSE
                   (SELECT count(*) + 1 FROM per_wallet a
                     WHERE a.net IS NOT NULL
                       AND (a.net > m.net
                            OR (a.net = m.net AND a.wallet < ${me}))) END AS net_rank
            FROM mine m`,
      ]);

      if (mineDaily.length > 0) {
        const byDay = new Map<number, number>();
        for (const r of mineDaily) {
          byDay.set(new Date(r.day as Date).getTime(), n(r.rake));
        }
        let mine = 0;
        series = shared.series.map((p) => {
          mine += byDay.get(p.at) ?? 0;
          return { ...p, yours: mine };
        });
      }

      const row = rows[0];
      if (row) {
        const mineRake = n(row.rake);
        const eligibleRake = shared.eligibleRakeChips ?? 0;
        const isEligible = mineRake >= MIN_ELIGIBLE_RAKE_CHIPS;
        you = {
          rakeChips: mineRake,
          rakeRank: n(row.rake_rank),
          netChips: row.net === null ? null : n(row.net),
          netRank: row.net_rank === null ? null : n(row.net_rank),
          // Basis points of the pool. Null rather than zero below the floor:
          // the share is not yet defined, which is not the same as being nil.
          shareBps:
            isEligible && eligibleRake > 0
              ? Math.round((mineRake / eligibleRake) * 10_000)
              : null,
          eligible: isEligible,
        };
      } else {
        // The wallet is known to be absent, which is worth saying plainly
        // rather than rendering as an unknown.
        you = {
          rakeChips: 0,
          rakeRank: 0,
          netChips: null,
          netRank: null,
          shareBps: null,
          eligible: false,
        };
      }
    }

    return NextResponse.json({ ...shared, series, you } satisfies Payload, { headers });
  } catch {
    // A database that will not answer is not a room where nobody has won
    // anything. Fall back to saying nothing is known.
    return NextResponse.json(NOTHING, { headers });
  }
}
