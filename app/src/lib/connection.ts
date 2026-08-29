/**
 * Connections to the two layers.
 *
 * Base layer holds custody: player balances, table creation, joining, leaving.
 * The rollup runs the game. They are different endpoints with different
 * commitment levels, because they are used for different things.
 *
 * The rollup connection is authenticated. Its token decides what it may read,
 * so each player needs their own: yours reads your hole cards, and nobody's
 * reads the deck.
 */

import { Connection } from "@solana/web3.js";
import { BASE_RPC, TEE_URL, TEE_WS } from "./constants";
import { loggingFetch } from "./rpc-log";

let baseConnection: Connection | null = null;

/**
 * Read direct, overflow through the proxy.
 *
 * The browser talks to the keyless Secure endpoint, which Helius rate-limits
 * per IP — so a burst past that limit comes back 429, and only then does the
 * call fall back to `/api/rpc`, where the server holds the real key. Two things
 * fall out of that: the api-key url is never in the browser, and the steady
 * state pays no server hop, because the direct path carries it.
 *
 * web3.js hands this the endpoint it was configured with, which is the direct
 * one; the fallback swaps in our own origin. Everything else about the request
 * — body, headers, method — is passed straight through.
 */
/**
 * The proxy ticket, fetched once and reused until it is close to expiring.
 *
 * Minting is a round trip, so doing it per call would put the hop back that the
 * direct path exists to avoid. One ticket covers fifteen minutes; it is renewed
 * a minute early so a call never arrives holding one that has just died.
 */
let ticket: { token: string; until: number } | null = null;
let minting: Promise<string | null> | null = null;

async function rpcTicket(): Promise<string | null> {
  const now = Date.now();
  if (ticket && now < ticket.until) return ticket.token;
  // Concurrent callers share one mint rather than each asking for their own.
  if (!minting) {
    minting = (async () => {
      try {
        const res = await fetch("/api/rpc-token", { cache: "no-store" });
        if (!res.ok) return null;
        const { token } = (await res.json()) as { token?: string };
        if (!token) return null;
        ticket = { token, until: Date.now() + 14 * 60 * 1000 };
        return token;
      } catch {
        return null;
      } finally {
        minting = null;
      }
    })();
  }
  return minting;
}

/** Send a call to our own proxy, carrying the ticket it requires. */
async function viaProxy(log: typeof fetch, init?: RequestInit) {
  const token = await rpcTicket();
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-rpc-token", token);
  return log("/api/rpc", { ...init, headers });
}

function smartFetch(): typeof fetch {
  const log = loggingFetch("base");
  /*
   * Development takes the proxy straight away.
   *
   * The fast main endpoint is domain-locked and Helius will not allowlist
   * localhost, so a dev browser calling it gets a 403 — but the proxy attaches
   * the site's own origin, so the same endpoint answers 200 through it. Its 150
   * TPS is far past anything local testing needs, so there is no per-IP limit
   * to dance around and no reason for the slow keyless endpoint here.
   */
  const dev = process.env.NODE_ENV === "development";
  return async (input, init) => {
    if (dev) return viaProxy(log, init);
    /*
     * Production reads go direct to the keyless endpoint, which is rate-limited
     * per IP — a single attacker is capped, and there is no key on it to lift.
     * A burst past that per-IP limit comes back 429, and only then does the
     * call fall back to the proxy, where the key lives and the plan's higher
     * limits apply.
     */
    const res = await log(input, init);
    if (res.status !== 429) return res;
    return viaProxy(log, init);
  };
}

/** Custody and anything that must be durable. Confirmed, not processed. */
export function getBaseConnection(): Connection {
  if (!baseConnection) {
    // Every call goes through the log. `fetch` is the seam web3.js already
    // offers, so this covers Anchor's calls and web3.js's own internal retries
    // too — nothing has to remember to report itself.
    baseConnection = new Connection(BASE_RPC, {
      commitment: "confirmed",
      fetch: smartFetch(),
    });
  }
  return baseConnection;
}

/**
 * An authenticated rollup connection.
 *
 * Processed rather than confirmed: the point of the rollup is speed, and the
 * table reconciles against confirmed on a slower loop. A wrong read costs one
 * frame of animation, a slow read costs the feel of the game.
 */
export function makeErConnection(token: string): Connection {
  return new Connection(`${TEE_URL}?token=${token}`, {
    commitment: "processed",
    wsEndpoint: `${TEE_WS}?token=${token}`,
    fetch: loggingFetch("rollup"),
    // The default 30s is longer than a player will wait to see their own action.
    confirmTransactionInitialTimeout: 20_000,
  });
}

