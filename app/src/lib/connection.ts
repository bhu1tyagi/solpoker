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
function smartFetch(): typeof fetch {
  const log = loggingFetch("base");
  return async (input, init) => {
    const res = await log(input, init);
    if (res.status !== 429) return res;
    // The direct endpoint is throttling this IP. The proxy has the key and the
    // plan's own, higher limits; send the identical body there instead.
    return log("/api/rpc", init);
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

