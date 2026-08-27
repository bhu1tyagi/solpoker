import { NextResponse } from "next/server";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";
import { readChain, volumeFloorChips } from "@/lib/server/chain";

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

let rakeChipsSeen = 0;

async function syncChainHands(s: Sql, now: number) {
  if (now - syncedAt < SYNC_EVERY_MS) return;
  const live = await readChain();
  // Null means the RPC did not answer. Leave the stored counts alone: an
  // unreachable endpoint is not a room where nothing has been played.
  if (!live) return;
  syncedAt = now;
  // Rake the house has already cashed out is no longer on chain, so this can
  // fall. Keeping the high-water mark stops the volume it implies from
  // sliding backwards every time the treasury is emptied.
  rakeChipsSeen = Math.max(rakeChipsSeen, live.rakeChips);
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

  await ensureSchema(s);
  // Before counting anything, take whatever the chain will tell us. A failure
  // in here must not take the lobby down with it.
  await syncChainHands(s, Date.now()).catch(() => {});

  // Both windows in one pass, so the choice between them costs no round trip
  // and the two can never be read a second apart from each other.
  const [all] = await s`
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
    ) h`;

  const window: "24h" | "all" = Number(all.hands_24h) > 0 ? "24h" : "all";

  // Per table, same shape and same window, so a card and the tiles above it
  // are always measuring the same stretch of time.
  const perTable = await s`
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
    GROUP BY table_id`;

  const nameRows = await s`SELECT table_id, name FROM table_names`;

  // Hands, from the program's own counters rather than from hand reports.
  //
  // This is deliberately not windowed. The counter is a running total with no
  // timestamps behind it, so there is no honest way to ask it about the last
  // 24 hours — the tile says "all time" and means it.
  const [dealt] = await s`
    SELECT coalesce(sum(hands), 0)::bigint AS hands
    FROM table_hands WHERE cluster = ${CLUSTER_TAG}`;

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

  return NextResponse.json(
    {
      names,
      window,
      stored: true,
      ...totals(all as Record<string, unknown>, window),
      // Overrides the reported-hand count above on purpose: the program's
      // counter is the authority on how many hands were dealt, and the reports
      // are best effort. They are kept apart in the payload so the gap between
      // them stays visible rather than being averaged away.
      handsDealt: Number(dealt.hands),
      /*
       * The least volume the rake proves, and the pot figures that follow
       * from it.
       *
       * These exist because the pot is never written to chain, so the only
       * hands with an observed pot are the ones a client stayed open long
       * enough to report. The rake is on chain, it is a fixed fraction of the
       * pot, and inverting it therefore bounds the volume from below without
       * anyone's word for it.
       *
       * Bounds, and labelled as bounds. `biggest` uses the fact that the
       * largest pot cannot be smaller than the mean, which is true and weak;
       * it is a floor to put a real number where a dash was, not a claim
       * about the biggest pot anyone actually won.
       */
      ...(() => {
        const floor = volumeFloorChips(rakeChipsSeen);
        const hands = Number(dealt.hands);
        if (floor <= 0 || hands <= 0) return { rakeFloor: null };
        return {
          rakeFloor: {
            volumeChips: floor,
            avgPotChips: Math.floor(floor / hands),
            biggestPotChips: Math.floor(floor / hands),
          },
        };
      })(),
      tables,
    },
    { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } },
  );
}
