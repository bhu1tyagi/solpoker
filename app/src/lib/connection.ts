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

let baseConnection: Connection | null = null;

/** Custody and anything that must be durable. Confirmed, not processed. */
export function getBaseConnection(): Connection {
  if (!baseConnection) {
    baseConnection = new Connection(BASE_RPC, { commitment: "confirmed" });
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
    // The default 30s is longer than a player will wait to see their own action.
    confirmTransactionInitialTimeout: 20_000,
  });
}

/** Attestation state, fetched from the server route that can load the verifier. */
export interface AttestationState {
  ok: boolean;
  checkedAt: number | null;
  detail: string;
  /** See the attest route: a failed check and an absent one are different. */
  reason?: "failed" | "unavailable";
}

export async function fetchAttestation(): Promise<AttestationState> {
  try {
    const res = await fetch("/api/attest");
    if (!res.ok) {
      return {
        ok: false,
        checkedAt: null,
        reason: "unavailable",
        detail: `The attestation check could not be reached (${res.status}).`,
      };
    }
    return (await res.json()) as AttestationState;
  } catch (e) {
    return { ok: false, checkedAt: null, reason: "unavailable", detail: String(e) };
  }
}
