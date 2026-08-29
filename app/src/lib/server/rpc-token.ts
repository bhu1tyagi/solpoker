import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A short-lived ticket for the RPC proxy.
 *
 * The honest framing first, because it decides the design: any token the
 * browser sends is a token the browser holds, and anything the browser holds
 * can be read out of devtools. A fixed secret in the bundle would be the API
 * key problem again wearing a different name. So this is not built to be
 * unstealable — it is built so that stealing it is worth very little.
 *
 * Three properties do that work:
 *
 *   signed     the token is an HMAC over its own expiry, so it cannot be
 *              invented or extended — only handed out by us.
 *   expiring   a scraped token stops working within minutes, so an attacker
 *              has to keep coming back to the mint rather than lifting one
 *              string and using it forever.
 *   mintable   because minting is its own endpoint, it is its own choke
 *              point: it can be rate-limited and watched separately from the
 *              RPC traffic it authorises.
 *
 * What it does NOT do is stop a determined script, which can simply fetch a
 * token and use it. Nothing that runs in a browser can. What it stops is the
 * cheap case — someone copying one value out of the network panel and pointing
 * their own app at it — and it turns the expensive case into traffic that
 * arrives through an endpoint we control and can throttle.
 */

const TTL_MS = 15 * 60 * 1000;

function secret(): string {
  // Falls back to the funder key material only as a last resort so a missing
  // variable does not silently disable the check; a real deployment sets it.
  return (
    process.env.RPC_TOKEN_SECRET ||
    process.env.FUNDER_SECRET_KEY ||
    "pokerable-dev-only-secret"
  );
}

const sign = (payload: string) =>
  createHmac("sha256", secret()).update(payload).digest("base64url");

/** `<expiry>.<signature>` — the expiry is public, the signature is what binds it. */
export function mintRpcToken(now = Date.now()): string {
  const expires = String(now + TTL_MS);
  return `${expires}.${sign(expires)}`;
}

export function verifyRpcToken(token: string | null, now = Date.now()): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expires = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;

  const expected = sign(expires);
  // Compared in constant time: a length-sensitive or early-exit comparison
  // leaks how much of a guess was right, one byte at a time.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Did this request come from our own page, rather than a script?
 *
 * `Sec-Fetch-Site` is set by the browser and a page cannot forge it, so it
 * cleanly separates our own fetches from another site's. A non-browser client
 * can omit or fake it freely — which is why this is one signal among several
 * rather than the gate itself. Absent is tolerated: not every browser sends it,
 * and refusing on absence would lock out clients that are doing nothing wrong.
 */
export function sameOriginish(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "same-site";
}
