/**
 * Turning chain accounts into the shapes the UI renders.
 *
 * These decode from raw bytes rather than through Anchor's coder. The layouts
 * are fixed and simple, a websocket callback hands us a Buffer anyway, and it
 * keeps BN out of the store. Offsets match state.rs field order exactly, so any
 * change there means changing these.
 *
 * Every read is bounds checked, and a field past the end of the account reads
 * as zero rather than throwing. Accounts created by older builds of the program
 * are genuinely shorter than today's layout, and one of them throwing took down
 * the whole lobby listing, which then looked exactly like an empty lobby.
 */

import type {
  ConfigView,
  HandView,
  SeatView,
  TableView,
} from "@/stores/table-store";
import { MAX_SEATS } from "./constants";

const hex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");

/** u64 as a number. Chip counts and hand numbers never approach 2^53. */
const u64 = (d: Uint8Array, at: number) => {
  if (at + 8 > d.byteLength) return 0;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return Number(view.getBigUint64(at, true));
};

const i64 = (d: Uint8Array, at: number) => {
  if (at + 8 > d.byteLength) return 0;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return Number(view.getBigInt64(at, true));
};

/** A single byte, or zero past the end. */
const u8 = (d: Uint8Array, at: number) => (at < d.byteLength ? d[at] : 0);

const ZERO_KEY = "11111111111111111111111111111111";

const bs58 = (b: Uint8Array): string => {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < b.length && b[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < b.length; i++) {
    let carry = b[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
};

const pubkey = (d: Uint8Array, at: number) =>
  at + 32 <= d.byteLength ? bs58(d.subarray(at, at + 32)) : ZERO_KEY;
const maybeKey = (d: Uint8Array, at: number) => {
  const k = pubkey(d, at);
  return k === ZERO_KEY ? null : k;
};

/** Player: 8 disc, 32 authority, 8 chips, 8 last_faucet_ts, 8 hands_played, 1 bump */
export function decodePlayer(d: Uint8Array) {
  return {
    authority: pubkey(d, 8),
    chips: u64(d, 40),
    lastFaucetTs: i64(d, 48),
    handsPlayed: u64(d, 56),
  };
}

/** TableConfig: 8 disc, 8 id, 32 creator, 8 sb, 8 bb, 8 min, 8 max, 1 seats, 8 timeout, 1 bump */
export function decodeConfig(d: Uint8Array): ConfigView {
  return {
    tableId: u64(d, 8),
    smallBlind: u64(d, 48),
    bigBlind: u64(d, 56),
    minBuyIn: u64(d, 64),
    maxBuyIn: u64(d, 72),
    actionTimeoutSecs: i64(d, 81),
  };
}

/** Table: 8 disc, 8 id, 32 config, 192 seats, 1 button, 8 hand_number, 1 state, 1 bump */
export function decodeTable(d: Uint8Array, address: string): TableView {
  const seats: (string | null)[] = [];
  for (let i = 0; i < MAX_SEATS; i++) seats.push(maybeKey(d, 48 + i * 32));
  return {
    tableId: u64(d, 8),
    address,
    config: pubkey(d, 16),
    seats,
    button: u8(d, 240),
    handNumber: u64(d, 241),
    state: u8(d, 249),
    // Appended after bump, so a table from an older build stops before it and
    // reads as 0, meaning "not known to be empty".
    emptySince: i64(d, 251),
  };
}

/**
 * Seat: 8 disc, 32 table, 1 index, 32 occupant, 8 stack, 8 committed_street,
 * 8 committed_total, folded, all_in, needs_action, may_raise, in_hand,
 * 8 last_action_slot, 32 salt_commit, 32 salt, 1 salt_state, 1 bump
 */
export function decodeSeat(d: Uint8Array): SeatView {
  return {
    index: u8(d, 40),
    occupant: maybeKey(d, 41),
    stack: u64(d, 73),
    committedStreet: u64(d, 81),
    committedTotal: u64(d, 89),
    folded: u8(d, 97) === 1,
    allIn: u8(d, 98) === 1,
    needsAction: u8(d, 99) === 1,
    mayRaise: u8(d, 100) === 1,
    inHand: u8(d, 101) === 1,
    saltCommit: hex(d.subarray(110, 142)),
    salt: hex(d.subarray(142, 174)),
    saltState: u8(d, 174),
  };
}

/**
 * Hand: 8 disc, 32 table, 8 number, 1 street, 5 board, 8 current_bet,
 * 8 min_raise, 1 to_act, 1 button, 1 last_aggressor, 1 dealt_in, 8 deadline,
 * 32 shuffle_seed, 12 revealed, 1 revealed_mask, 32 salt_xor, 1 salt_mask,
 * 32 vrf_randomness, 1 shuffle_state, 32 result_hash, 1 bump
 */
export function decodeHand(d: Uint8Array): HandView {
  const revealed: number[][] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    revealed.push([u8(d, 114 + i * 2), u8(d, 115 + i * 2)]);
  }
  return {
    handNumber: u64(d, 40),
    street: u8(d, 48),
    board: Array.from(d.subarray(49, 54)),
    currentBet: u64(d, 54),
    minRaise: u64(d, 62),
    toAct: u8(d, 70),
    button: u8(d, 71),
    lastAggressor: u8(d, 72),
    dealtIn: u8(d, 73),
    deadline: i64(d, 74),
    shuffleSeed: hex(d.subarray(82, 114)),
    revealed,
    revealedMask: u8(d, 126),
    saltXor: hex(d.subarray(127, 159)),
    saltMask: u8(d, 159),
    vrfRandomness: hex(d.subarray(160, 192)),
    shuffleState: u8(d, 192),
    resultHash: hex(d.subarray(193, 225)),
  };
}

/** TableHistory: 8 disc, 32 table, 8 recorded, 8 last_hand, 32 hash, 1 bump */
export function decodeHistory(d: Uint8Array) {
  return {
    handsRecorded: u64(d, 40),
    lastHandNumber: u64(d, 48),
    lastResultHash: hex(d.subarray(56, 88)),
  };
}

/**
 * HoleCards: 8 disc, 32 table, 1 seat_index, 8 hand_number, 2 cards, 1 bump.
 *
 * Read straight off the bytes because the account is permissioned, so this is
 * the one read that proves privacy works: over anyone else's connection it
 * comes back null rather than as data.
 */
export function decodeHole(d: Uint8Array) {
  return {
    seatIndex: u8(d, 40),
    handNumber: u64(d, 41),
    cards: [u8(d, 49), u8(d, 50)],
  };
}
