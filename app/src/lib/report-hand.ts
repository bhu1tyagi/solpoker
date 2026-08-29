import type { HandHistory } from "./verifier/verify-shuffle";

/**
 * Who was paid what, when the capture could prove it.
 *
 * Payouts are net of rake and cover every seat in order, zeros included,
 * because that is the array the program hashed. The wallets beside them are
 * the occupants remembered from while the hand was live.
 */
export interface HandResults {
  bigBlind: number;
  payouts: number[];
  wallets: (string | null)[];
}

/**
 * Tell the backend about a settled hand, fire-and-forget.
 *
 * Runs beside the IndexedDB save at capture time. The player's own copy in
 * IndexedDB is the one that matters for verification; this copy only feeds
 * the lobby's aggregate numbers, so a failure here must never surface to the
 * player or slow the table down. keepalive lets the report survive the tab
 * closing right after a hand ends, which is exactly when players leave.
 *
 * The server re-verifies the record before storing it; nothing sent here is
 * trusted as-is. The pot is the one thing the verifier cannot prove — it is
 * summed from seat state that settlement erases, not derived from the seed —
 * so it rides alongside as a separate, clearly untrusted figure. Send it only
 * when it was actually observed; a pot of zero would be indistinguishable
 * from a hand nobody was watching, and it would drag the average down.
 *
 * `results` rides alongside for the same reason and on the same terms, and is
 * what the rewards page is built out of. It travels beside the record rather
 * than inside it because the record is the thing the verifier proves and must
 * stay exactly what was proven, here and in IndexedDB. The server re-derives
 * the result hash from these payouts before believing any of it.
 */
export function reportHand(
  record: HandHistory,
  potChips?: number,
  results?: HandResults,
): void {
  try {
    const body: Record<string, unknown> = { ...record };
    if (typeof potChips === "number" && potChips > 0) body.potChips = potChips;
    if (results) body.results = results;
    void fetch("/api/hands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Even constructing the request must never break play.
  }
}
