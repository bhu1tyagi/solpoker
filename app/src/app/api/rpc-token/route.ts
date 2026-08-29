import { NextResponse } from "next/server";
import { mintRpcToken, sameOriginish } from "@/lib/server/rpc-token";

export const runtime = "nodejs";

/**
 * Hands out a short-lived ticket for `/api/rpc`.
 *
 * Its own endpoint on purpose: minting is the choke point worth watching, and
 * keeping it separate means it can be rate-limited on a different budget from
 * the RPC calls it authorises. One mint serves a browser for fifteen minutes,
 * so this is called once on connect rather than per request.
 */
const WINDOW_MS = 60_000;
const MAX_MINTS = 20;
const mints = new Map<string, { n: number; resetAt: number }>();

export async function GET(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const b = mints.get(ip);
  if (!b || now > b.resetAt) {
    mints.set(ip, { n: 1, resetAt: now + WINDOW_MS });
  } else if (++b.n > MAX_MINTS) {
    return NextResponse.json({ error: "too many token requests" }, { status: 429 });
  }

  if (!sameOriginish(req)) {
    return NextResponse.json({ error: "cross-site" }, { status: 403 });
  }

  return NextResponse.json(
    { token: mintRpcToken(now) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
