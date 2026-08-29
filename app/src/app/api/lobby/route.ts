import { NextResponse } from "next/server";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";
import { readChain } from "@/lib/server/chain";

export const runtime = "nodejs";

type Sql = NonNullable<ReturnType<typeof db>>;

/**
 * Fold the chain's own hand counters into the high-water table.
 *
 * Throttled per warm instance, because this is a `getProgramAccounts` and the
 * lobby route is polled. The HTTP cache in front of the route does most of the
 * work; this stops a burst of cold requests from turning into a burst of full
 * program scans.
 */
let syncedAt = 0;
const SYNC_EVERY_MS = 60_000;

/**
 * The finished payload, briefly remembered, and built only once at a time.
 *
 * The other two routes got this and this one did not, which is why it was the
 * slowest thing on the page by a wide margin: every reader rebuilt it from
 * scratch, and rebuilding means a chain sweep plus a handful of queries to a
 * database on the other side of the world.
 */
let memo: { at: number; payload: unknown } | null = null;
let inFlight: Promise<unknown> | null = null;
const MEMO_MS = 15_000;

async function syncChainHands(s: Sql, now: number) {
  if (now - syncedAt < SYNC_EVERY_MS) return;
  const live = await readChain();
  // Null means the RPC did not answer. Leave the stored counts alone: an
  // unreachable endpoint is not a room where nothing has been played.
  if (!live) return;
  syncedAt = now;
  const seen = live.tables.filter((t) => t.hands > 0);
  if (seen.length === 0) return;
  await s`
    INSERT INTO table_hands ${s(
      seen.map((t) => ({ cluster: CLUSTER_TAG, table_id: t.tableId, hands: t.hands })),
      "cluster",
      "table_id",
      "hands",
    )}
    ON CONFLICT (cluster, table_id) DO UPDATE
      SET hands = greatest(table_hands.hands, excluded.hands), last_seen = now()`;
}

/**
 * What the lobby cannot read from chain: play totals built from hands the
 * clients reported and the server re-verified, plus the table name registry.
 * Everything the lobby CAN read from chain it still reads from chain,
 * client-side, so seats and stakes never depend on this route being up.
 *
 * Two rules run through all of it:
 *
 *   1. Absence, never a fabricated zero. Every figure is null when it is
 *      unknowable, and the lobby renders a tile only for a non-null value. A
 *      poker room reporting $0 of volume is a lie about liveness; reporting
 *      nothing is the truth about what is known.
 *
 *      `stored` is what makes that rule usable rather than paralysing. There
 *      is a real difference between "no database is attached, so nobody knows
 *      anything" and "the database answered and this room has played nothing
 *      yet", and a payload of bare nulls collapses the two. With the flag,
 *      the lobby can say a truthful zero in the second case and fall back to
 *      chain figures in the first.
 *
 *   2. One window for the whole row. The totals are the last 24 hours while
 *      the last 24 hours had play, and all time otherwise. A quiet night
 *      would otherwise blank a room that has genuinely dealt thousands of
 *      hands, and the alternative — silently mixing windows across tiles —
 *      would have them quietly disagree. The window is named in the payload
 *      so the labels can say which one they mean.
 */

interface Totals {
  /** Hands stored. Zero is a fact once a database has answered. */
  hands: number | null;
  /**
   * Of those, how many carried a pot anyone observed. The money figures below
   * are computed over these and no others, so this is what says whether they
   * can be trusted — and, when it is short of `hands`, that volume is a floor
   * rather than a total.
   */
  potted: number | null;
  volumeChips: number | null;
  avgPotChips: number | null;
  biggestPotChips: number | null;
}

const NOTHING: Totals = {
  hands: null,
  potted: null,
  volumeChips: null,
  avgPotChips: null,
  biggestPotChips: null,
};

/**
 * One row of counts into the shape the lobby renders.
 *
 * `potted` gates the money figures, and `hands` does not gate itself. A hand
 * can be verified and stored without anyone having watched its pot, and
 * summing over those would produce a real-looking volume short by however
 * many went unwatched — so an average over no pots is null, while a count of
 * no hands is simply zero.
 */
function totals(row: Record<string, unknown>, w: "24h" | "all"): Totals {
  const n = (k: string) => Number(row[`${k}_${w}`] ?? 0);
  const potted = n("potted");
  return {
    hands: n("hands"),
    potted,
    volumeChips: potted > 0 ? n("volume") : null,
    avgPotChips: potted > 0 ? Math.round(n("avg")) : null,
    biggestPotChips: potted > 0 ? n("max") : null,
  };
}

export async function GET() {
  const s = db();
  if (!s) {
    return NextResponse.json(
      { names: {}, window: "24h", stored: false, ...NOTHING, tables: {} },
      { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } },
    );
  }

  const headers = { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" };
  if (memo && Date.now() - memo.at < MEMO_MS) {
    return NextResponse.json(memo.payload, { headers });
  }
  if (inFlight) {
    try {
      return NextResponse.json(await inFlight, { headers });
    } catch {
      // Their build failed; fall through and try our own.
    }
  }
  const buildStart = Date.now();
  const build = (async () => {
  /*
   * Timed by phase, because "the lobby is slow" was never one thing.
   *
   * The database is in us-east-1 and this is not, so every round trip to it
   * costs about 250ms before it does any work at all, and a cold Neon
   * connection costs nearer four seconds. Without a breakdown that is
   * indistinguishable from a slow query or a slow chain read, and guessing
   * between them wasted real time.
   */
  const t0 = Date.now();
  let mark = t0;
  const phase = (name: string) => {
    const now = Date.now();
    console.log(`[lobby] ${name.padEnd(14)} ${String(now - mark).padStart(6)}ms`);
    mark = now;
  };

  await ensureSchema(s);
  phase("schema");
  // Before counting anything, take whatever the chain will tell us. A failure
  // in here must not take the lobby down with it.
  await syncChainHands(s, Date.now()).catch(() => {});
  phase("chain sync");

  /*
   * All four reads at once.
   *
   * They do not depend on each other — `window` is derived from the first but
   * only used afterwards, when the rows are turned into totals — and they were
   * being awaited one after another. Against a database in us-east-1 that is
   * four sequential round trips of about 250ms each, which is most of the
   * time this route took and none of it work. Measured on this connection:
   * five sequential trivial queries take 1638ms, the same five together take
   * 262ms.
   */
  const [[all], perTable, nameRows, [dealt]] = await Promise.all([
    s`
    SELECT
      count(*) FILTER (WHERE recent)::int                        AS hands_24h,
      count(pot_chips) FILTER (WHERE recent)::int                AS potted_24h,
      coalesce(sum(pot_chips) FILTER (WHERE recent), 0)::bigint  AS volume_24h,
      coalesce(avg(pot_chips) FILTER (WHERE recent), 0)::float   AS avg_24h,
      coalesce(max(pot_chips) FILTER (WHERE recent), 0)::bigint  AS max_24h,
      count(*)::int                                              AS hands_all,
      count(pot_chips)::int                                      AS potted_all,
      coalesce(sum(pot_chips), 0)::bigint                        AS volume_all,
      coalesce(avg(pot_chips), 0)::float                         AS avg_all,
      coalesce(max(pot_chips), 0)::bigint                        AS max_all
    FROM (
      SELECT pot_chips, settled_at > now() - interval '24 hours' AS recent
      FROM hands WHERE cluster = ${CLUSTER_TAG}
    ) h`,
    // Per table, same shape and same window, so a card and the tiles above it
    // are always measuring the same stretch of time.
    s`
    SELECT
      table_id::text                                             AS table_id,
      count(*) FILTER (WHERE recent)::int                        AS hands_24h,
      count(pot_chips) FILTER (WHERE recent)::int                AS potted_24h,
      coalesce(sum(pot_chips) FILTER (WHERE recent), 0)::bigint  AS volume_24h,
      coalesce(avg(pot_chips) FILTER (WHERE recent), 0)::float   AS avg_24h,
      coalesce(max(pot_chips) FILTER (WHERE recent), 0)::bigint  AS max_24h,
      count(*)::int                                              AS hands_all,
      count(pot_chips)::int                                      AS potted_all,
      coalesce(sum(pot_chips), 0)::bigint                        AS volume_all,
      coalesce(avg(pot_chips), 0)::float                         AS avg_all,
      coalesce(max(pot_chips), 0)::bigint                        AS max_all,
      extract(epoch FROM max(settled_at))::float * 1000          AS last_hand_at
    FROM (
      SELECT table_id, pot_chips, settled_at,
             settled_at > now() - interval '24 hours' AS recent
      FROM hands WHERE cluster = ${CLUSTER_TAG}
    ) h
    GROUP BY table_id`,
    s`SELECT table_id, name FROM table_names`,

  // Hands, from the program's own counters rather than from hand reports.
  //
  // This is deliberately not windowed. The counter is a running total with no
  // timestamps behind it, so there is no honest way to ask it about the last
  // 24 hours — the tile says "all time" and means it.
    s`
    SELECT coalesce(sum(hands), 0)::bigint AS hands
    FROM table_hands WHERE cluster = ${CLUSTER_TAG}`,
  ]);

  phase("queries");

  const window: "24h" | "all" = Number(all.hands_24h) > 0 ? "24h" : "all";

  const names: Record<string, string> = {};
  for (const r of nameRows) names[String(r.table_id)] = r.name as string;

  const tables: Record<string, Totals & { lastHandAt: number | null }> = {};
  for (const r of perTable) {
    const t = totals(r as Record<string, unknown>, window);
    // A table with nothing in the chosen window has nothing to say about
    // itself; an entry of zeroes would only make the client check them.
    if (!t.hands) continue;
    tables[String(r.table_id)] = {
      ...t,
      lastHandAt: r.last_hand_at ? Math.round(Number(r.last_hand_at)) : null,
    };
  }

  return {
      names,
      window,
      stored: true,
      ...totals(all as Record<string, unknown>, window),
      // Overrides the reported-hand count above on purpose: the program's
      // counter is the authority on how many hands were dealt, and the reports
      // are best effort. They are kept apart in the payload so the gap between
      // them stays visible rather than being averaged away.
      handsDealt: Number(dealt.hands),
      // There is no rake-derived fallback for the money figures any more.
      // Volume means the money that went through the pots, and the pot is
      // never written to chain — so it comes from verified hand reports, and
      // until those exist the figure is unknown rather than bounded. A floor
      // built by inverting the rake moved only when the house got paid, which
      // made "volume" a statement about rake wearing volume's label.
      tables,
    };
  })().then((payload) => {
    console.log(`[lobby] TOTAL cold build ${Date.now() - buildStart}ms`);
    return payload;
  });

  inFlight = build;
  try {
    const payload = await build;
    memo = { at: Date.now(), payload };
    return NextResponse.json(payload, { headers });
  } catch (e) {
    console.error("lobby stats failed:", e);
    // The last good numbers beat an empty room.
    if (memo) return NextResponse.json(memo.payload, { headers });
    return NextResponse.json(
      { names: {}, window: "24h", stored: false, ...NOTHING, tables: {} },
      { headers },
    );
  } finally {
    if (inFlight === build) inFlight = null;
  }
}
