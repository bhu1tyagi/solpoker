import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { verify, type HandHistory } from "@/lib/verifier/verify-shuffle";
import { computeResultHash } from "@/lib/verifier/result-hash";
import { attributeRake, rakeFromNetPayouts } from "@/lib/rake";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";
import { MAX_SEATS, NO_CARD } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * What each seat took away, reported beside the record.
 *
 * Payouts are net of rake, in seat order, zeros included — the whole array,
 * because that is what the program hashed. Wallets are who was sitting there.
 */
interface HandResults {
  bigBlind: number;
  payouts: number[];
  wallets: (string | null)[];
}

const isCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * Turn a report of who was paid what into rows, or into nothing.
 *
 * The gate is `result_hash`. Settlement hashed the hand number, the shuffle
 * seed, the board and every payout together, and the shuffle verifier has
 * already proved the seed above, so payouts that rebuild the published digest
 * are payouts the chain itself attests to. Payouts that do not are dropped —
 * not argued with, not stored with a caveat, dropped. There is no version of
 * this where a wrong number is better than a missing one, because these rows
 * decide who is owed an airdrop.
 *
 * The rake is then computed here rather than read from the report. It follows
 * from the payouts by the program's own formula, so a client has nothing to
 * gain by lying about it and no way to try.
 */
function resultRows(record: HandHistory & { potChips?: number }, results: unknown) {
  const r = results as HandResults | undefined;
  if (!r || typeof r !== "object") return null;
  if (!Array.isArray(r.payouts) || r.payouts.length !== MAX_SEATS) return null;
  if (!Array.isArray(r.wallets) || r.wallets.length !== MAX_SEATS) return null;
  if (!r.payouts.every(isCount)) return null;
  // The big blind only moves the rake-free floor and the cap; the rake is
  // bounded by 2.5% of a pot the hash already fixed, whatever is claimed here.
  if (!isCount(r.bigBlind) || r.bigBlind <= 0) return null;
  if (!record.shuffleSeed || !record.resultHash) return null;
  if (!Array.isArray(record.board) || record.board.length !== 5) return null;

  const rebuilt = computeResultHash(
    record.handNumber,
    record.shuffleSeed,
    record.board,
    r.payouts,
  );
  if (rebuilt !== record.resultHash) return null;

  // A payout with nobody to credit is a capture that lost the seat, and a
  // wallet that will not parse is not one an allocation can ever be sent to.
  const wallets: (string | null)[] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    const w = r.wallets[i];
    if (r.payouts[i] <= 0) {
      wallets.push(null);
      continue;
    }
    if (typeof w !== "string") return null;
    try {
      wallets.push(new PublicKey(w).toBase58());
    } catch {
      return null;
    }
  }

  const netSum = r.payouts.reduce((a, b) => a + b, 0);
  if (netSum <= 0) return null;

  // No flop, no drop, read off the board the verifier just proved.
  const sawFlop = record.board[0] !== NO_CARD;
  const observed =
    typeof record.potChips === "number" && record.potChips > 0
      ? Math.floor(record.potChips)
      : null;
  const { rake } = rakeFromNetPayouts(netSum, r.bigBlind, sawFlop, observed);
  const shares = attributeRake(r.payouts, rake);

  const rows = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    if (r.payouts[i] <= 0) continue;
    rows.push({
      cluster: CLUSTER_TAG,
      table_id: record.tableId as number,
      hand_number: record.handNumber,
      seat: i,
      wallet: wallets[i] as string,
      payout_chips: r.payouts[i],
      rake_chips: shares[i],
    });
  }
  return rows.length > 0 ? rows : null;
}

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
 *
 * `results` rides along the same way, and is the money half: who sat where and
 * what they were paid. It is held to a stricter standard than the pot, because
 * unlike the pot it can be checked — see resultRows above. A report whose
 * payouts fail that check costs the hand nothing; the hand still stores, and
 * the response says the results did not.
 */
export async function POST(req: Request) {
  const s = db();
  // No database attached: acknowledge and drop, so clients never care.
  if (!s) return NextResponse.json({ stored: false }, { status: 202 });

  let record: HandHistory & { potChips?: number; results?: unknown };
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

  // The money rows are strictly a bonus on top of a stored hand. Anything that
  // goes wrong here leaves the hand recorded and the rewards figures a little
  // less complete, which is the right way round: history is the product's
  // claim, rewards is an accounting on top of it.
  let results = false;
  const rows = resultRows(record, record.results);
  if (rows) {
    try {
      await s`
        INSERT INTO hand_players ${s(
          rows,
          "cluster",
          "table_id",
          "hand_number",
          "seat",
          "wallet",
          "payout_chips",
          "rake_chips",
        )}
        ON CONFLICT (cluster, table_id, hand_number, seat) DO NOTHING`;
      results = true;
    } catch {
      // Six clients report the same hand at once; a loser here changes nothing.
    }
  }

  return NextResponse.json({ stored: true, results });
}
