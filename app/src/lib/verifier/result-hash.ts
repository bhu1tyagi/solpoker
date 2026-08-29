/**
 * The digest settlement leaves behind, rebuilt from the numbers it hashed.
 *
 * `settle` ends by writing `hand.result_hash`, and what goes into it is the
 * hand number, the shuffle seed, the board, and every seat's payout AFTER the
 * rake came off:
 *
 *     sha256( hand_number u64 LE || shuffle_seed 32B || board 5B
 *             || payouts[0..6] u64 LE )
 *
 * That makes the hash the one thing in this system that binds who was paid
 * what to a hand anybody can verify. The seed is proven by the shuffle
 * verifier; the hash is on the account; so a client reporting payouts is not
 * asking to be believed, it is submitting numbers that either reproduce a
 * digest the chain already published or do not.
 *
 * Which is why this is called on both sides. The capture uses it to check its
 * own reading of the seat stacks before reporting — a stale stack observation
 * fails here rather than becoming a wrong number in the rewards table — and
 * the server uses it as the gate before storing anything a payout figure
 * depends on.
 *
 * What the hash does NOT cover is which wallet sat in which seat. That mapping
 * is reported, not proven, and carries the same weight as the pot figure
 * beside it.
 */

import { sha256 } from "@noble/hashes/sha2";
import { fromHex, hex } from "./verify-shuffle";

/** u64 little endian, the encoding the program hashes payouts in. */
function u64le(n: number): Uint8Array {
  const out = new Uint8Array(8);
  let v = BigInt(Math.max(0, Math.floor(n)));
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Rebuild `result_hash` from the parts, as lowercase hex.
 *
 * `payouts` is one entry per seat in seat order, including the zeros: the
 * program hashes the whole fixed-size array, so a shorter list is a different
 * preimage and a different hash.
 */
export function computeResultHash(
  handNumber: number,
  shuffleSeedHex: string,
  board: readonly number[],
  payouts: readonly number[],
): string {
  const seed = fromHex(shuffleSeedHex);
  const preimage = new Uint8Array(8 + seed.length + board.length + payouts.length * 8);
  let at = 0;
  preimage.set(u64le(handNumber), at);
  at += 8;
  preimage.set(seed, at);
  at += seed.length;
  preimage.set(Uint8Array.from(board), at);
  at += board.length;
  for (const p of payouts) {
    preimage.set(u64le(p), at);
    at += 8;
  }
  return hex(sha256(preimage));
}
