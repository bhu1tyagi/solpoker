/**
 * Your contribution to the shuffle.
 *
 * Each hand you pick 32 random bytes, publish a hash of them, and only then
 * reveal the bytes themselves. The deck seed is the VRF output XOR every
 * player's salt, so as long as one player is honest the deck cannot be steered.
 * You are that player, for yourself.
 *
 * The salt is written to storage before it is committed, not after. If the tab
 * reloads between committing and revealing, a salt we no longer have would mean
 * a hash we cannot open, and the hand would stall on us.
 */

import { sha256 } from "@noble/hashes/sha2";

const key = (table: string, handNumber: number) =>
  `solpoker:salt:${table}:${handNumber}`;

const hex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (s: string) => {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Read back the salt for a hand, or null if we never made one. */
export function loadSalt(table: string, handNumber: number): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(key(table, handNumber));
  return raw ? fromHex(raw) : null;
}

/**
 * The salt for this hand, generating and persisting one if needed.
 *
 * Idempotent on purpose: called again for the same hand it returns the same
 * bytes, so a retry cannot commit to one salt and reveal another.
 */
export function getOrCreateSalt(table: string, handNumber: number): Uint8Array {
  const existing = loadSalt(table, handNumber);
  if (existing) return existing;

  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key(table, handNumber), hex(salt));
  }
  return salt;
}

export const commitmentFor = (salt: Uint8Array) => sha256(salt);

/** Drop salts from hands long finished. */
export function pruneSalts(table: string, currentHand: number, keep = 10) {
  if (typeof window === "undefined") return;
  const prefix = `solpoker:salt:${table}:`;
  const doomed: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k?.startsWith(prefix)) continue;
    const n = Number(k.slice(prefix.length));
    if (Number.isFinite(n) && n < currentHand - keep) doomed.push(k);
  }
  for (const k of doomed) window.localStorage.removeItem(k);
}
