import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { decodePlayer } from "@/lib/decode";
import { PROGRAM_ID } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * The leaderboard, swept once for everybody.
 *
 * Same reasoning as the table listing: this is a full `getProgramAccounts`
 * scan of every Player account, a method Helius bills at ten times a normal
 * call and rate-limits separately from everything else. Run in every browser
 * it made the cost of the lobby scale with its audience; run here, behind a
 * cache, it costs one scan however many people are reading.
 *
 * The browser still keeps a websocket on the same accounts, so a balance that
 * moves is reflected immediately. This route is the initial board.
 */

/** Anchor account discriminator for Player, from the IDL. */
const PLAYER_DISCRIMINATOR = Uint8Array.from([205, 222, 112, 7, 165, 155, 206, 218]);

let memo: { at: number; payload: unknown } | null = null;
/**
 * One scan at a time, however many callers arrive.
 *
 * The cache only helps once something has filled it. A cold start with
 * several readers turning up together had each of them begin their own
 * sweep — which is precisely the burst the scan limit exists to refuse, so
 * they all queued behind 429s and the first response took eleven seconds.
 * Callers now share the sweep that is already running.
 */
let inFlight: Promise<unknown> | null = null;
const MEMO_MS = 10_000;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_BASE_RPC;
  if (!url) return NextResponse.json({ error: "no rpc configured" }, { status: 503 });

  const now = Date.now();
  const headers = { "Cache-Control": "s-maxage=15, stale-while-revalidate=45" };
  if (memo && now - memo.at < MEMO_MS) {
    return NextResponse.json(memo.payload, { headers });
  }

  if (inFlight) {
    try {
      return NextResponse.json(await inFlight, { headers });
    } catch {
      // Their sweep failed; fall through and try our own.
    }
  }

  const sweep = (async () => {
    const conn = new Connection(url, "confirmed");
    const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(PLAYER_DISCRIMINATOR) } }],
    });

    const rows = accounts
      .flatMap((a) => {
        try {
          const p = decodePlayer(new Uint8Array(a.account.data));
          return [{ authority: p.authority, chips: p.chips, handsPlayed: p.handsPlayed }];
        } catch {
          // One unreadable account must not empty the whole board.
          return [];
        }
      })
      /*
       * Only players who actually hold chips. A Player account can never be
       * closed — the program has no instruction for it, and `sell_chips` only
       * zeroes the balance — so every wallet that has ever bought in is on
       * chain permanently. Without this the board fills with accounts holding
       * nothing, including abandoned test wallets whose keys are gone.
       */
      .filter((p) => p.chips > 0)
      .sort((a, b) => b.chips - a.chips || b.handsPlayed - a.handsPlayed);

    const payload = { rows };
    memo = { at: Date.now(), payload };
    return payload;
  })();

  inFlight = sweep;
  try {
    return NextResponse.json(await sweep, { headers });
  } catch (e) {
    console.error("leaderboard listing failed:", e);
    // The last good board beats an empty one.
    if (memo) return NextResponse.json(memo.payload, { headers });
    return NextResponse.json({ error: "listing failed" }, { status: 502 });
  } finally {
    if (inFlight === sweep) inFlight = null;
  }
}
