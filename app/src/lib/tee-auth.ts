/**
 * Getting an auth token for the TEE validator.
 *
 * The MagicBlock SDK ships this, but importing it drags in the attestation
 * verifier, which is CommonJS and stubs node built-ins. The handshake itself is
 * three lines of HTTP, so it lives here and the SDK stays server-side.
 *
 * The flow: ask for a challenge, sign it with the wallet, exchange it for a
 * token. The token then rides in the URL query string on both the http and
 * websocket endpoints. It decides what the connection is allowed to read, which
 * is how hole cards stay yours.
 */

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { CLUSTER, TEE_URL } from "./constants";

/**
 * How long a cached token is reused before a fresh handshake.
 *
 * This is the credential that reads hole cards, and it sits in `localStorage`
 * where any script on the origin can take it. Retention is therefore the whole
 * blast radius: a month of cached token is a month of somebody else reading
 * your cards from anywhere, with no way for you to notice or revoke it.
 *
 * Twelve hours is about one sitting. The cost of shortening it is one extra
 * wallet signature a day, which is a fair trade for that.
 */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const REFRESH_AFTER_MS = 10 * 60 * 60 * 1000;

export type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

interface CachedToken {
  token: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Keyed by cluster as well as wallet.
 *
 * Without the cluster in the key, a token minted against devnet is handed to
 * the mainnet validator on the next build — the same wallet, a different chain.
 * It gets rejected, but the client cannot tell that from an expired token, so
 * it retries the dead credential instead of asking for a fresh one.
 */
const cacheKey = (pubkey: PublicKey) =>
  `solpoker:tee-token:${CLUSTER}:${pubkey.toBase58()}`;

function readCache(pubkey: PublicKey): CachedToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(pubkey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (Date.now() - parsed.issuedAt > REFRESH_AFTER_MS) return null;
    // Honor the server's expiry too; it may be shorter than our default.
    if (parsed.expiresAt && parsed.expiresAt - Date.now() < 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(pubkey: PublicKey, value: CachedToken) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(cacheKey(pubkey), JSON.stringify(value));
  } catch {
    // A full or blocked localStorage costs a signature next reload, nothing more.
  }
}

export function clearAuthToken(pubkey: PublicKey) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(cacheKey(pubkey));
}

/**
 * Fetch a token, signing a fresh challenge. One wallet prompt, once a month.
 */
export async function requestAuthToken(
  pubkey: PublicKey,
  signMessage: SignMessage,
  rpcUrl = TEE_URL,
): Promise<CachedToken> {
  // Both handshake requests carry a deadline. A fetch that never settles
  // wedges more than itself: the connect flow holds a busy flag while it
  // waits, so a hung handshake left the table saying "connecting" forever
  // with a Retry button that silently did nothing, and only a reload — which
  // resets the flag — could recover. Fifteen seconds turns that into an
  // honest "offline", where Retry works.
  const deadline = (ms: number) =>
    typeof AbortSignal !== "undefined" && AbortSignal.timeout
      ? AbortSignal.timeout(ms)
      : undefined;

  const challengeRes = await fetch(
    `${rpcUrl}/auth/challenge?pubkey=${pubkey.toBase58()}`,
    { signal: deadline(15_000) },
  );
  if (!challengeRes.ok) {
    throw new Error(`could not get a challenge from the validator (${challengeRes.status})`);
  }
  const { challenge } = (await challengeRes.json()) as { challenge: string };

  const signature = await signMessage(new TextEncoder().encode(challenge));

  const loginRes = await fetch(`${rpcUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: pubkey.toBase58(),
      challenge,
      signature: bs58.encode(signature),
    }),
    signal: deadline(15_000),
  });
  if (!loginRes.ok) {
    throw new Error(`the validator rejected the signature (${loginRes.status})`);
  }
  const body = (await loginRes.json()) as { token: string; expiresAt?: number };

  const value: CachedToken = {
    token: body.token,
    issuedAt: Date.now(),
    expiresAt: body.expiresAt ?? Date.now() + TOKEN_TTL_MS,
  };
  writeCache(pubkey, value);
  return value;
}

/** Cached token if we have a fresh one, otherwise a new handshake. */
export async function getAuthToken(
  pubkey: PublicKey,
  signMessage: SignMessage,
  opts: { force?: boolean } = {},
): Promise<string> {
  if (!opts.force) {
    const cached = readCache(pubkey);
    if (cached) return cached.token;
  }
  const fresh = await requestAuthToken(pubkey, signMessage);
  return fresh.token;
}
