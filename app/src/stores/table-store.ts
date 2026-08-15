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
  reset: () => void;
}

const emptySeats = () => new Array<SeatView | null>(MAX_SEATS).fill(null);

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
