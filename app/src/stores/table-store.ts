import { create } from "zustand";
import { PublicKey } from "@solana/web3.js";
import { MAX_SEATS, NO_SEAT } from "@/lib/constants";

/**
 * The live table, as decoded from chain accounts.
 *
 * Everything here is a plain number or string rather than a BN or PublicKey, so
 * components can compare and render without conversion, and so a websocket
 * callback can write it from outside React.
 *
 * Chip amounts fit in a double comfortably: a table's whole supply is thousands.
 */

export interface SeatView {
  index: number;
  occupant: string | null;
  stack: number;
  committedStreet: number;
  committedTotal: number;
  folded: boolean;
  allIn: boolean;
  needsAction: boolean;
  mayRaise: boolean;
  inHand: boolean;
  saltState: number;
  saltCommit: string;
  salt: string;
  /**
   * Does this seat's hole-card permission name whoever is sitting in it now?
   *
   * Cleared on chain by every path that changes the occupant, because a
   * permission naming the previous player would let them read the next one's
   * cards. `start_hand` refuses to deal to a seat without it, so the crank has
   * to put it back before a hand can begin.
   */
  cardsSecured: boolean;
}

export interface HandView {
  handNumber: number;
  street: number;
  board: number[];
  currentBet: number;
  /** The minimum raise increment, not a target. */
  minRaise: number;
  toAct: number;
  button: number;
  lastAggressor: number;
  dealtIn: number;
  deadline: number;
  shuffleSeed: string;
  revealed: number[][];
  revealedMask: number;
  saltXor: string;
  saltMask: number;
  vrfRandomness: string;
  shuffleState: number;
  resultHash: string;
}

export interface TableView {
  tableId: number;
  address: string;
  config: string;
  seats: (string | null)[];
  button: number;
  handNumber: number;
  /** 0 waiting, 1 hand in progress. */
  state: number;
  /** Unix seconds since the last player left, or 0 while anyone is seated. */
  emptySince: number;
}

export interface ConfigView {
  tableId: number;
  /**
   * Who paid to open the table. Already on chain since the first build; it
   * simply was not read until house tables needed telling apart from a
   * player's own.
   */
  creator: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  actionTimeoutSecs: number;
}

export type LinkState = "offline" | "connecting" | "live" | "degraded";

export interface PendingAction {
  seat: number;
  kind: "fold" | "check" | "call" | "raise" | "allin";
  /** Street total the seat is moving to, for predicting stack and bet. */
  toTotal: number;
  handNumber: number;
  sentAt: number;
}

interface TableState {
  table: TableView | null;
  config: ConfigView | null;
  hand: HandView | null;
  seats: (SeatView | null)[];
  /** Your own two cards, readable only over your authenticated connection. */
  myHole: number[] | null;
  myHoleHandNumber: number;
  mySeat: number;

  link: LinkState;
  lastUpdate: number;
  /** Bumped on reconnect so stale callbacks can be ignored. */
  epoch: number;

  pending: PendingAction | null;

  /**
   * How many times securing each seat's hole cards has failed on this client.
   *
   * Re-securing a chair after somebody sits down is ordinary and takes a few
   * seconds, so a chair that is merely unsecured says nothing. A chair that has
   * refused the instruction repeatedly is a different story — that is the seat
   * genuinely still held by its last occupant — and only that one is worth
   * telling anybody about.
   */
  secureFailures: number[];
  /**
   * The seat being cashed out of, while that is happening.
   *
   * Cash-out deliberately releases its own hole permission to sit itself out,
   * and the crank, whose whole job is to put that permission back, would
   * immediately undo it — the two fighting over one account for the length of a
   * cash-out. The crank skips this seat instead.
   */
  leavingSeat: number | null;

  setTable: (t: TableView | null) => void;
  setConfig: (c: ConfigView | null) => void;
  setHand: (h: HandView | null) => void;
  setSeat: (i: number, s: SeatView | null) => void;
  setSeats: (s: (SeatView | null)[]) => void;
  setMyHole: (cards: number[] | null, handNumber: number) => void;
  setMySeat: (i: number) => void;
  setLink: (l: LinkState) => void;
  bumpEpoch: () => void;
  setPending: (p: PendingAction | null) => void;
  noteSecureFailure: (i: number) => void;
  clearSecureFailures: (i?: number) => void;
  setLeavingSeat: (i: number | null) => void;
  reset: () => void;
}

const emptySeats = () => new Array<SeatView | null>(MAX_SEATS).fill(null);
const noFailures = () => new Array<number>(MAX_SEATS).fill(0);

export const useTableStore = create<TableState>((set) => ({
  table: null,
  config: null,
  hand: null,
  seats: emptySeats(),
  myHole: null,
  myHoleHandNumber: 0,
  mySeat: -1,

  link: "offline",
  lastUpdate: 0,
  epoch: 0,
  pending: null,
  secureFailures: noFailures(),
  leavingSeat: null,

  setTable: (table) => set({ table, lastUpdate: Date.now() }),
  setConfig: (config) => set({ config }),
  setHand: (hand) => set({ hand, lastUpdate: Date.now() }),
  setSeat: (i, seat) =>
    set((s) => {
      const seats = [...s.seats];
      seats[i] = seat;
      return { seats, lastUpdate: Date.now() };
    }),
  setSeats: (seats) => set({ seats, lastUpdate: Date.now() }),
  setMyHole: (myHole, myHoleHandNumber) => set({ myHole, myHoleHandNumber }),
  setMySeat: (mySeat) => set({ mySeat }),
  setLink: (link) => set({ link }),
  bumpEpoch: () => set((s) => ({ epoch: s.epoch + 1 })),
  setPending: (pending) => set({ pending }),
  noteSecureFailure: (i) =>
    set((s) => {
      const secureFailures = [...s.secureFailures];
      secureFailures[i] = (secureFailures[i] ?? 0) + 1;
      return { secureFailures };
    }),
  clearSecureFailures: (i) =>
    set((s) => {
      if (i === undefined) return { secureFailures: noFailures() };
      if (!s.secureFailures[i]) return {};
      const secureFailures = [...s.secureFailures];
      secureFailures[i] = 0;
      return { secureFailures };
    }),
  setLeavingSeat: (leavingSeat) => set({ leavingSeat }),

  reset: () =>
    set({
      table: null,
      config: null,
      hand: null,
      seats: emptySeats(),
      myHole: null,
      myHoleHandNumber: 0,
      mySeat: -1,
      link: "offline",
      pending: null,
      secureFailures: noFailures(),
      leavingSeat: null,
    }),
}));

/** Which seat this wallet occupies, or -1. */
export function seatOf(seats: (SeatView | null)[], wallet: string | null): number {
  if (!wallet) return -1;
  return seats.findIndex((s) => s?.occupant === wallet);
}

/** Total pot: everything committed across all streets. The Hand has no pot field. */
export function potTotal(seats: (SeatView | null)[]): number {
  return seats.reduce((a, s) => a + (s?.committedTotal ?? 0), 0);
}

/** Seats dealt into the current hand. */
export function dealtInSeats(hand: HandView | null): number[] {
  if (!hand) return [];
  const out: number[] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    if (hand.dealtIn & (1 << i)) out.push(i);
  }
  return out;
}

export const isHandLive = (t: TableView | null, h: HandView | null) =>
  t?.state === 1 && h !== null && h.toAct !== NO_SEAT;

export const key = (k: PublicKey | null | undefined) => k?.toBase58() ?? null;
