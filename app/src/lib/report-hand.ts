import type { HandHistory } from "./verifier/verify-shuffle";

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
 * trusted as-is.
 */
export function reportHand(record: HandHistory): void {
  try {
    void fetch("/api/hands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Even constructing the request must never break play.
  }
}
