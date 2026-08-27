import { NextResponse } from "next/server";
import { verify, type HandHistory } from "@/lib/verifier/verify-shuffle";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * Clients report each settled hand here, at the same moment they save it to
 * their own IndexedDB for later verification. The server accepts NOTHING on
 * faith: it re-runs the full shuffle verification before storing, so a row
 * in the hands table means "this hand's deck provably followed from the
 * published salts and VRF output", not "someone said so".
 *
 * potChips rides along as an extra the verifier ignores; volume aggregates
 * simply skip hands that arrived without it. Idempotent on (table, hand):
 * six players all report the same hand and it lands once. The one thing a
 * repeat report can change is the pot, and only upward — a client that joined
 * mid-hand saw part of it, and the fullest observation is the right one.
 */
export async function POST(req: Request) {
  const s = db();
  // No database attached: acknowledge and drop, so clients never care.
  if (!s) return NextResponse.json({ stored: false }, { status: 202 });

  let record: HandHistory & { potChips?: number };
  try {
    record = await req.json();
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }

  if (
    typeof record?.tableId !== "number" ||
    typeof record?.handNumber !== "number"
  ) {
    return NextResponse.json({ error: "missing table or hand id" }, { status: 400 });
  }

  // The gate: the server proves the hand to itself before remembering it.
  const check = verify(record);
  if (!check.ok) {
    return NextResponse.json(
      { error: "record does not verify", problems: check.problems },
      { status: 422 },
    );
  }

  const pot =
    typeof record.potChips === "number" &&
    Number.isFinite(record.potChips) &&
    record.potChips >= 0
      ? Math.floor(record.potChips)
      : null;

  await ensureSchema(s);
  // The id carries the cluster too: a devnet table and a mainnet table can
  // legitimately share an id, and without this they would collide silently.
  const id = `${CLUSTER_TAG}:${record.tableId}:${record.handNumber}`;
  await s`
    INSERT INTO hands (id, cluster, table_id, hand_number, pot_chips, result_hash, record)
    VALUES (${id}, ${CLUSTER_TAG}, ${record.tableId}, ${record.handNumber}, ${pot},
            ${record.resultHash ?? null}, ${s.json(record as never)})
    ON CONFLICT (id) DO UPDATE SET pot_chips = CASE
      WHEN hands.pot_chips IS NULL    THEN excluded.pot_chips
      WHEN excluded.pot_chips IS NULL THEN hands.pot_chips
      ELSE greatest(hands.pot_chips, excluded.pot_chips)
    END`;

  return NextResponse.json({ stored: true });
}
