import { NextResponse } from "next/server";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * What the lobby cannot read from chain: the trailing-24h aggregates (from
 * hands the clients reported and the server re-verified) and the table name
 * registry. Everything the lobby CAN read from chain it still reads from
 * chain, client-side, so those numbers never depend on this route being up.
 *
 * Every aggregate is null rather than zero when it is unknowable: no
 * database, or no verified hands carrying a pot yet. The lobby renders a
 * tile only for a non-null value, which is the honest-state rule in code:
 * absence, never a fabricated zero.
 */
export async function GET() {
  const s = db();
  if (!s) {
    return NextResponse.json(
      { names: {}, hands24h: null, volume24hChips: null, avgPotChips: null },
      { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } },
    );
  }

  await ensureSchema(s);
  const [agg] = await s`
    SELECT
      count(*)::int                            AS hands,
      count(pot_chips)::int                    AS potted,
      coalesce(sum(pot_chips), 0)::bigint      AS volume,
      avg(pot_chips)::float                    AS avg_pot
    FROM hands
    WHERE cluster = ${CLUSTER_TAG}
      AND settled_at > now() - interval '24 hours'`;
  const nameRows = await s`SELECT table_id, name FROM table_names`;

  const names: Record<string, string> = {};
  for (const r of nameRows) names[String(r.table_id)] = r.name as string;

  return NextResponse.json(
    {
      names,
      hands24h: agg.hands > 0 ? agg.hands : null,
      // Volume and average only exist once hands carry pots; a sum over
      // pot-less hands would be a real-looking zero, which is worse.
      volume24hChips: agg.potted > 0 ? Number(agg.volume) : null,
      avgPotChips: agg.potted > 0 ? Math.round(agg.avg_pot as number) : null,
    },
    { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } },
  );
}
