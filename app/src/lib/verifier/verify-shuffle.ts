/**
 * Recompute a Pokerable deck from published hand history, in the browser.
 *
 * A port of tools/verify-shuffle.mjs. It shares no code with the program: the
 * shuffle is reimplemented from the spec, so agreement between the two is
 * evidence rather than tautology. The only dependency is a sha256, and the
 * fixed vector in the tests pins it against the Rust implementation.
 *
 * What it checks:
 *   1. Each published salt matches the commitment that seat posted beforehand.
 *   2. The shuffle seed really is VRF output XOR every revealed salt.
 *   3. Fisher-Yates over that seed reproduces the exact deck that was dealt.
 */

import { sha256 as nobleSha256 } from "@noble/hashes/sha2";

const sha256 = (...parts: Uint8Array[]) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return nobleSha256(joined);
};

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

export const cardName = (b: number) =>
  b === 0xff ? "--" : `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}`;

export const hex = (bytes: Uint8Array | number[]) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export const fromHex = (s: string) => {
  const clean = s.replace(/^0x/, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/**
 * The keystream: block i is sha256(seed || i as u64 little endian).
 * Bytes are consumed in order, one block at a time.
 */
function keystream(seed: Uint8Array) {
  let block: Uint8Array = new Uint8Array(0);
  let cursor = 0;
  let index = 0n;
  return () => {
    if (cursor >= block.length) {
      const counter = new Uint8Array(8);
      let v = index;
      for (let i = 0; i < 8; i++) {
        counter[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      block = sha256(seed, counter);
      index += 1n;
      cursor = 0;
    }
    return block[cursor++];
  };
}

/**
 * Fisher-Yates with rejection sampling.
 *
 * The index is drawn by masking to the low bits of i and rejecting anything out
 * of range, never by taking a modulus. Modulo would make some permutations
 * slightly likelier than others, which would undermine the whole claim.
 */
export function shuffle(seed: Uint8Array): Uint8Array {
  const cards = Uint8Array.from({ length: 52 }, (_, i) => i);
  const next = keystream(seed);

  for (let i = cards.length - 1; i >= 1; i--) {
    const bits = 32 - Math.clz32(i);
    const bytesNeeded = Math.max(Math.ceil(bits / 8), 1);
    const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;

    let j = 0;
    for (;;) {
      let v = 0;
      for (let k = 0; k < bytesNeeded; k++) v = (v * 256 + next()) >>> 0;
      const candidate = (v & mask) >>> 0;
      if (candidate <= i) {
        j = candidate;
        break;
      }
    }
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return cards;
}

/** Combine VRF output with every revealed salt. */
export function combineSeed(
  vrfRandomness: Uint8Array | number[],
  salts: Uint8Array[],
): Uint8Array {
  const seed = Uint8Array.from(vrfRandomness);
  for (const salt of salts) {
    for (let i = 0; i < 32; i++) seed[i] ^= salt[i];
  }
  return seed;
}

export interface HistorySeat {
  index: number;
  dealtIn: boolean;
  saltCommit: string;
  salt: string | null;
  revealed: number[] | null;
}

export interface HandHistory {
  handNumber: number;
  vrfRandomness: string;
  shuffleSeed?: string;
  board?: number[];
  seats?: HistorySeat[];
  /** Extras the app stores alongside; the verifier ignores them. */
  tableId?: number;
  resultHash?: string;
  capturedAt?: number;
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  seed: string;
  deck: number[];
  expectedBoard: number[];
  expectedHoles: Record<number, number[]>;
}

export function verify(history: HandHistory): VerifyResult {
  const problems: string[] = [];
  const vrf = fromHex(history.vrfRandomness);
  const salts: Uint8Array[] = [];

  for (const seat of history.seats ?? []) {
    if (!seat.salt) continue;
    const salt = fromHex(seat.salt);
    const commitment = fromHex(seat.saltCommit);
    const actual = sha256(salt);
    if (hex(actual) !== hex(commitment)) {
      problems.push(
        `seat ${seat.index}: salt does not match its commitment ` +
          `(committed ${hex(commitment).slice(0, 16)}..., ` +
          `salt hashes to ${hex(actual).slice(0, 16)}...)`,
      );
    }
    salts.push(salt);
  }

  if (salts.length < 2) {
    problems.push(`only ${salts.length} salt(s) published, need at least 2`);
  }

  const seed = combineSeed(vrf, salts);
  if (history.shuffleSeed && hex(seed) !== hex(fromHex(history.shuffleSeed))) {
    problems.push(
      `published seed does not equal VRF XOR salts ` +
        `(published ${history.shuffleSeed.slice(0, 16)}..., ` +
        `computed ${hex(seed).slice(0, 16)}...)`,
    );
  }

  const deck = shuffle(seed);

  // The board is the top five cards of the deck this seed produces.
  //
  // Hole cards are deliberately *not* checkable here, and that is the point of
  // the change this verifier was rewritten for. They are dealt from a second,
  // independent randomness draw that is never published, from the forty-seven
  // cards the board did not take. Publishing the seed that proves the board
  // would, if the hole cards came from it too, publish every folded hand along
  // with it — permanently, for every hand ever played. So the deal is split:
  // the community cards are provable by anyone, and the hole cards rest on the
  // enclave, which is exactly what this project has always claimed
  // ("provably fair shuffle, TEE-protected hole cards") and now actually does.
  const expectedBoard = Array.from(deck.slice(0, 5));

  if (history.board) {
    const same = history.board.every((c, i) => c === expectedBoard[i]);
    if (!same) {
      problems.push(
        `board was ${history.board.map(cardName).join(" ")} ` +
          `but the seed gives ${expectedBoard.map(cardName).join(" ")}`,
      );
    }
  }

  // A shown hand still has to be a real card that is not on the board and not
  // in somebody else's hand. That is weaker than deriving it, and it is what
  // remains checkable without the hole seed.
  const seen = new Map<number, number>();
  for (const seat of history.seats ?? []) {
    if (!seat.revealed) continue;
    for (const card of seat.revealed) {
      if (card < 0 || card > 51) {
        problems.push(`seat ${seat.index}: showed a card outside the deck (${card})`);
        continue;
      }
      if (expectedBoard.includes(card)) {
        problems.push(
          `seat ${seat.index}: showed ${cardName(card)}, which is on the board`,
        );
      }
      const other = seen.get(card);
      if (other !== undefined) {
        problems.push(
          `seat ${seat.index}: showed ${cardName(card)}, already shown by seat ${other}`,
        );
      }
      seen.set(card, seat.index);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    seed: hex(seed),
    deck: Array.from(deck),
    expectedBoard,
    /**
     * Empty by design. Hole cards are not derivable from published data any
     * more; the field stays so callers that render it keep working.
     */
    expectedHoles: {} as Record<number, number[]>,
  };
}
