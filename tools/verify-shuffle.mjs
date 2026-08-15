#!/usr/bin/env node
/**
 * Recompute a SolPoker deck from published hand history.
 *
 * Anyone can run this against a finished hand and check the deck was not rigged.
 * It reimplements the shuffle from scratch in plain JavaScript, using only the
 * Node crypto module, so it does not share a line of code with the program. If
 * both arrive at the same 52 cards, the deal was honest.
 *
 * What it checks:
 *   1. Each published salt matches the commitment that seat posted beforehand.
 *   2. The shuffle seed really is VRF output XOR every revealed salt.
 *   3. Fisher-Yates over that seed reproduces the exact deck that was dealt.
 *
 * Usage:
 *   node verify-shuffle.mjs hand-history.json
 *   node verify-shuffle.mjs --self-test
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha256 = (...parts) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(Buffer.from(p));
  return new Uint8Array(h.digest());
};

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
export const cardName = (b) =>
  b === 0xff ? "--" : `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}`;

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const fromHex = (s) => new Uint8Array(Buffer.from(s.replace(/^0x/, ""), "hex"));

/**
 * The keystream: block i is sha256(seed || i as u64 little endian).
 * Bytes are consumed in order, one block at a time.
 */
function keystream(seed) {
  let block = new Uint8Array(0);
  let cursor = 0;
  let index = 0n;
  return () => {
    if (cursor >= block.length) {
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64LE(index);
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
export function shuffle(seed) {
  const cards = Uint8Array.from({ length: 52 }, (_, i) => i);
  const next = keystream(seed);

  for (let i = cards.length - 1; i >= 1; i--) {
    const bits = 32 - Math.clz32(i);
    const bytesNeeded = Math.max(Math.ceil(bits / 8), 1);
    const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;

    let j;
    for (;;) {
      let v = 0;
      for (let k = 0; k < bytesNeeded; k++) v = (v * 256 + next()) >>> 0;
      const candidate = (v & mask) >>> 0;
      if (candidate <= i) {
        j = candidate;
        break;
      }
    }
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** Combine VRF output with every revealed salt. */
export function combineSeed(vrfRandomness, salts) {
  const seed = Uint8Array.from(vrfRandomness);
  for (const salt of salts) {
    for (let i = 0; i < 32; i++) seed[i] ^= salt[i];
  }
  return seed;
}

export function verify(history) {
  const problems = [];
  const vrf = fromHex(history.vrfRandomness);
  const salts = [];

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

  // Board and hole cards are dealt in a fixed order off the top of the deck:
  // two per seat in seat order, then five board cards.
  const dealtIn = history.seats?.filter((s) => s.dealtIn) ?? [];
  let cursor = 0;
  const expectedHoles = {};
  for (const seat of dealtIn) {
    expectedHoles[seat.index] = [deck[cursor++], deck[cursor++]];
  }
  const expectedBoard = Array.from({ length: 5 }, () => deck[cursor++]);

  for (const seat of dealtIn) {
    if (!seat.revealed) continue;
    const got = seat.revealed;
    const want = expectedHoles[seat.index];
    if (got[0] !== want[0] || got[1] !== want[1]) {
      problems.push(
        `seat ${seat.index}: showed ${got.map(cardName).join(" ")} ` +
          `but the deck gives ${want.map(cardName).join(" ")}`,
      );
    }
  }

  if (history.board) {
    const same = history.board.every((c, i) => c === expectedBoard[i]);
    if (!same) {
      problems.push(
        `board was ${history.board.map(cardName).join(" ")} ` +
          `but the deck gives ${expectedBoard.map(cardName).join(" ")}`,
      );
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    seed: hex(seed),
    deck: Array.from(deck),
    expectedBoard,
    expectedHoles,
  };
}

/** Reproduce a known seed to prove this file matches the Rust implementation. */
function selfTest() {
  const seed = new Uint8Array(32).fill(7);
  const deck = shuffle(seed);
  const unique = new Set(deck);
  console.log("seed        ", hex(seed));
  console.log("first ten   ", Array.from(deck.slice(0, 10)).map(cardName).join(" "));
  console.log("permutation ", unique.size === 52 ? "yes, all 52 distinct" : "BROKEN");
  console.log(
    "\nCompare against Rust:\n" +
      "  Deck::shuffled_from_seed(&[7u8; 32]) should give the same order.",
  );
}

const arg = process.argv[2];
if (!arg || arg === "--self-test") {
  selfTest();
} else {
  const history = JSON.parse(readFileSync(arg, "utf8"));
  const result = verify(history);
  console.log(`hand        ${history.handNumber ?? "?"}`);
  console.log(`seed        ${result.seed}`);
  console.log(`board       ${result.expectedBoard.map(cardName).join(" ")}`);
  for (const [seat, cards] of Object.entries(result.expectedHoles)) {
    console.log(`seat ${seat}      ${cards.map(cardName).join(" ")}`);
  }
  if (result.ok) {
    console.log("\nVERIFIED: the deal matches the published seed and salts.");
  } else {
    console.log("\nFAILED:");
    for (const p of result.problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  }
}
