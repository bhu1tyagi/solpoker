import { describe, it, expect } from "vitest";
import { foldSnapshot, payoutsFrom, type LiveSnapshot } from "./use-showdown-sequence";
import type { SeatView } from "@/stores/table-store";

/**
 * The end of a hand, replayed one account notification at a time.
 *
 * `settle` pays every winner, zeroes `committed_total` and puts the table back
 * to Waiting in a single instruction, but the six seat accounts, the hand and
 * the table reach this client as separate websocket pushes in whatever order
 * the socket delivers them. Every case below is one of those orders.
 */

const seat = (over: Partial<SeatView> = {}): SeatView => ({
  index: 0,
  occupant: "me",
  stack: 1000,
  committedStreet: 0,
  committedTotal: 0,
  folded: false,
  allIn: false,
  needsAction: false,
  mayRaise: false,
  inHand: true,
  saltState: 2,
  saltCommit: "",
  salt: "",
  cardsSecured: true,
  ...over,
});

/** Six seats, only the ones named actually there. */
const table = (...at: (SeatView | null)[]): (SeatView | null)[] =>
  Array.from({ length: 6 }, (_, i) => at[i] ?? null);

/** Heads-up, both in for 100 of a 1,000 stack: a 200 pot. */
const contested = () =>
  table(
    seat({ index: 0, occupant: "a", stack: 900, committedTotal: 100 }),
    seat({ index: 1, occupant: "b", stack: 900, committedTotal: 100 }),
  );

/** The same two seats after settlement: paid, and their bets cleared. */
const settled = (aStack: number, bStack: number) =>
  table(
    seat({ index: 0, occupant: "a", stack: aStack, committedTotal: 0, inHand: false }),
    seat({ index: 1, occupant: "b", stack: bStack, committedTotal: 0, inHand: false }),
  );

const DEALT_IN = 0b11;
const build = (frames: (SeatView | null)[][]): LiveSnapshot =>
  frames.reduce<LiveSnapshot | null>(
    (prev, s) => foldSnapshot(prev, 7, DEALT_IN, s),
    null,
  )!;

describe("foldSnapshot", () => {
  it("keeps the pot and the stacks the hand actually ended on", () => {
    const snap = build([contested()]);
    expect(snap.pot).toBe(200);
    expect(snap.stacks.slice(0, 2)).toEqual([900, 900]);
    expect(snap.dealtIn).toBe(DEALT_IN);
  });

  it("survives a settled seat arriving before the table says the hand is over", () => {
    // This is the missing animation. The effect that records the live picture
    // runs while table.state still says a hand is in progress, so a payout
    // that lands first used to be recorded AS the live picture — and the diff
    // against it was zero.
    const snap = build([contested(), settled(1100, 900)]);
    expect(snap.pot).toBe(200);
    expect(snap.stacks.slice(0, 2)).toEqual([900, 900]);
    expect(payoutsFrom(snap, settled(1100, 900))).toEqual([{ seat: 0, amount: 200 }]);
  });

  it("survives the whole settlement arriving early", () => {
    const snap = build([contested(), settled(1100, 900), settled(1100, 900)]);
    expect(snap.pot).toBe(200);
    expect(payoutsFrom(snap, settled(1100, 900))).toEqual([{ seat: 0, amount: 200 }]);
  });

  it("still follows chips leaving a stack while the hand runs", () => {
    const raised = table(
      seat({ index: 0, occupant: "a", stack: 700, committedTotal: 300 }),
      seat({ index: 1, occupant: "b", stack: 700, committedTotal: 300 }),
    );
    const snap = build([contested(), raised]);
    expect(snap.pot).toBe(600);
    expect(snap.stacks.slice(0, 2)).toEqual([700, 700]);
  });

  it("does not follow a player who sits down mid-hand", () => {
    // Their stack goes from nothing to a full buy-in, which a low-water mark
    // would read as a payout and animate the pot to somebody who never played.
    const withNewcomer = table(
      seat({ index: 0, occupant: "a", stack: 900, committedTotal: 100 }),
      seat({ index: 1, occupant: "b", stack: 900, committedTotal: 100 }),
      seat({ index: 2, occupant: "c", stack: 500, committedTotal: 0, inHand: false }),
    );
    const snap = build([contested(), withNewcomer]);
    expect(payoutsFrom(snap, withNewcomer)).toEqual([]);
  });

  it("starts over on a new hand", () => {
    const first = build([contested()]);
    const next = foldSnapshot(first, 8, DEALT_IN, settled(1100, 900));
    expect(next.handNumber).toBe(8);
    expect(next.pot).toBe(0);
    expect(next.stacks.slice(0, 2)).toEqual([1100, 900]);
  });
});

describe("payoutsFrom", () => {
  it("pays both winners of a split", () => {
    const snap = build([contested()]);
    expect(payoutsFrom(snap, settled(1000, 1000))).toEqual([
      { seat: 0, amount: 100 },
      { seat: 1, amount: 100 },
    ]);
  });

  it("shows only the winner whose push has landed, until the other does", () => {
    // What the award beat now waits for: read at the wrong moment a split pot
    // has exactly one payment in it, which is what drew one stream instead of
    // two.
    const snap = build([contested()]);
    const half = table(
      seat({ index: 0, occupant: "a", stack: 1000, committedTotal: 0, inHand: false }),
      seat({ index: 1, occupant: "b", stack: 900, committedTotal: 100 }),
    );
    expect(payoutsFrom(snap, half)).toEqual([{ seat: 0, amount: 100 }]);
    expect(payoutsFrom(snap, settled(1000, 1000))).toHaveLength(2);
  });

  it("reports the chain's figures, rake and odd chip included", () => {
    const snap = build([contested()]);
    // 200 pot, 2 taken as rake, odd chip to the first seat.
    expect(payoutsFrom(snap, settled(1000, 999))).toEqual([
      { seat: 0, amount: 100 },
      { seat: 1, amount: 99 },
    ]);
  });

  it("ignores a seat that was not dealt into the hand", () => {
    const snap = build([contested()]);
    const withNewcomer = [
      ...settled(1100, 900).slice(0, 2),
      seat({ index: 2, occupant: "c", stack: 500, inHand: false }),
      null,
      null,
      null,
    ];
    expect(payoutsFrom(snap, withNewcomer)).toEqual([{ seat: 0, amount: 200 }]);
  });
});
