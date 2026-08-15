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

/**
 * Salts held in memory, which is the authority while the page is open.
 *
 * Storage is the durable copy, not the only one. If localStorage is
 * unavailable, full, or blocked, falling back to generating a fresh salt each
 * call would mean committing to one salt and revealing another, and the
 * mismatch would stall the hand on that player every single time.
 */
const memory = new Map<string, Uint8Array>();

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
  const k = key(table, handNumber);
  const held = memory.get(k);
  if (held) return held;
  try {
    const raw = window?.localStorage?.getItem(k);
    if (!raw) return null;
    const salt = fromHex(raw);
    memory.set(k, salt);
    return salt;
  } catch {
    return null;
  }
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
  const k = key(table, handNumber);
  // Memory first, so the salt is stable even if storage refuses us.
  memory.set(k, salt);
  try {
    window?.localStorage?.setItem(k, hex(salt));
  } catch {
    // Storage full or blocked. The hand still works, a reload would lose it.
  }
  return salt;
}

export const commitmentFor = (salt: Uint8Array) => sha256(salt);

/** Drop salts from hands long finished. */
export function pruneSalts(table: string, currentHand: number, keep = 10) {
  const prefix = `solpoker:salt:${table}:`;
  const old = (k: string) => {
    const n = Number(k.slice(prefix.length));
    return Number.isFinite(n) && n < currentHand - keep;
  };

  for (const k of Array.from(memory.keys())) {
    if (k.startsWith(prefix) && old(k)) memory.delete(k);
  }

  try {
    const store = window?.localStorage;
    if (!store) return;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k?.startsWith(prefix) && old(k)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    // Nothing to prune if storage is unavailable.
  }
}
