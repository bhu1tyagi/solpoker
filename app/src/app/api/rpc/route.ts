import { NextResponse } from "next/server";
import { serverRpc, serverFetch } from "@/lib/server/rpc";
import { sameOriginish, verifyRpcToken } from "@/lib/server/rpc-token";

export const runtime = "nodejs";

/**
 * The RPC the browser calls without ever seeing the key.
 *
 * A key a browser uses is a key the world can read — it sits in the network
 * panel — and a domain allowlist only stops other websites, not a script that
 * forges the header. The one airtight answer is to not put the key in the
 * browser at all: the browser talks to this route on our own origin, and this
 * route holds the key and talks to Helius. Copying anything out of the bundle
 * now yields a path on our domain, which we rate-limit, rather than a key that
 * spends our quota anonymously.
 *
 * This is the overflow path, not the hot one. The browser reads go straight to
 * the keyless Secure endpoint, which Helius rate-limits per IP — so a single
 * attacker is capped whatever they do — and only a burst that trips that limit
 * falls back here. The steady state never touches this server.
 */

/*
 * A per-IP bucket, so one client cannot spend the whole plan through here.
 *
 * Held per warm instance rather than in a shared store: on serverless it is
 * approximate, and that is the honest limit of it — several instances each
 * allow their own bucket. It is a brake on one abusive client, not a global
 * quota, and pairs with Vercel's own edge protection in front of it. A shared
 * limiter (KV, Redis) is the upgrade when the plan is worth defending harder.
 */
const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

/*
 * A ceiling on how much of a request this will relay, so the route cannot be
 * turned into a pipe for something that is not a JSON-RPC call.
 */
const MAX_BODY = 200_000;

export async function POST(req: Request) {
  const url = serverRpc();
  if (!url) {
    return NextResponse.json({ error: "no rpc configured" }, { status: 503 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "too many requests" },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }

  /*
   * A signed, short-lived ticket, and a browser-set origin hint.
   *
   * Neither is unforgeable by a script, and neither is meant to be — see the
   * note in rpc-token.ts. Together they mean a scraped value stops working
   * within minutes and cross-site use is refused outright, so the cheap attack
   * (copy one string, point your own app at it) stops paying.
   */
  if (!sameOriginish(req)) {
    return NextResponse.json({ error: "cross-site" }, { status: 403 });
  }
  if (!verifyRpcToken(req.headers.get("x-rpc-token"))) {
    return NextResponse.json({ error: "bad or expired token" }, { status: 401 });
  }

  const body = await req.text();
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  try {
    // serverFetch attaches our own origin, so the domain-locked key upstream
    // accepts the call. The body passes through untouched — this is a relay,
    // not a parser, so a new RPC method needs no change here.
    const upstream = await serverFetch()(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("rpc proxy failed:", e);
    return NextResponse.json({ error: "upstream unreachable" }, { status: 502 });
  }
}
