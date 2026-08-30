import { describe, it, expect } from "vitest";
import { applyPending, applyPendingHand, pendingApplies } from "./optimistic";
import { potTotal } from "@/stores/table-store";
import type { HandView, PendingAction, SeatView } from "@/stores/table-store";
import { NO_SEAT } from "./constants";

const seat = (over: Partial<SeatView> = {}): SeatView => ({
  index: 0,
  occupant: "me",
  stack: 1000,
  committedStreet: 0,
  committedTotal: 0,
  folded: false,
  allIn: false,
  needsAction: true,
  mayRaise: true,
  inHand: true,
  saltState: 2,
  saltCommit: "",
  salt: "",
  cardsSecured: true,
  ...over,
});

const hand = (over: Partial<HandView> = {}): HandView => ({
  handNumber: 5,
  street: 0,
  board: [255, 255, 255, 255, 255],
  currentBet: 50,
  minRaise: 10,
  toAct: 0,
  button: 5,
  lastAggressor: NO_SEAT,
  dealtIn: 0b11,
  deadline: 0,
  shuffleSeed: "",
  revealed: [],
  revealedMask: 0,
  saltXor: "",
  saltMask: 0,
  vrfRandomness: "",
  shuffleState: 0,
  resultHash: "",
  ...over,
});

const pending = (over: Partial<PendingAction> = {}): PendingAction => ({
  seat: 0,
  kind: "call",
  toTotal: 50,
  handNumber: 5,
  street: 0,
  sentAt: 0,
  ...over,
});

describe("pendingApplies", () => {
  it("applies while the chain still says it is our turn", () => {
    expect(pendingApplies(pending(), hand(), [seat()])).toBe(true);
  });

  it("holds through the turn moving on, until the chips actually land", () => {
    // The hand account and the seat accounts arrive as separate pushes. In the
    // gap the seat is still pre-bet, and dropping the overlay there is what
    // made the pot count up twice on a raise.
    expect(pendingApplies(pending(), hand({ toAct: 1 }), [seat()])).toBe(true);
  });

  it("stops once the chain's own seat holds the chips", () => {
    const s = seat({ committedStreet: 50, committedTotal: 50, stack: 950 });
    expect(pendingApplies(pending(), hand({ toAct: 1 }), [s])).toBe(false);
  });

  it("stops when the seat is all in short of the target", () => {
    const s = seat({ committedStreet: 40, committedTotal: 40, stack: 0 });
    expect(pendingApplies(pending({ toTotal: 500 }), hand(), [s])).toBe(false);
  });

  it("never survives the street turning", () => {
    // committedStreet is back to zero here, so a surviving overlay would put
    // the same chips in a second time.
    expect(pendingApplies(pending(), hand({ street: 1 }), [seat()])).toBe(false);
  });

  it("holds a fold until the chain shows it folded", () => {
    const p = pending({ kind: "fold", toTotal: 0 });
    expect(pendingApplies(p, hand({ toAct: 1 }), [seat()])).toBe(true);
    expect(pendingApplies(p, hand({ toAct: 1 }), [seat({ folded: true })])).toBe(false);
  });

  it("retires a check on the turn, since a check moves nothing", () => {
    const p = pending({ kind: "check", toTotal: 0 });
    expect(pendingApplies(p, hand(), [seat()])).toBe(true);
    expect(pendingApplies(p, hand({ toAct: 1 }), [seat()])).toBe(false);
  });

  it("falls back to the turn when the seat has not loaded", () => {
    expect(pendingApplies(pending(), hand(), [])).toBe(true);
    expect(pendingApplies(pending(), hand({ toAct: NO_SEAT }), [])).toBe(false);
  });

  it("never leaks across hands", () => {
    expect(pendingApplies(pending({ handNumber: 4 }), hand(), [seat()])).toBe(false);
  });

  it("is false with nothing pending", () => {
    expect(pendingApplies(null, hand(), [seat()])).toBe(false);
  });
});

describe("applyPending", () => {
  it("moves chips from the stack to the street for a call", () => {
    const [s] = applyPending([seat()], pending({ kind: "call", toTotal: 50 }));
    expect(s!.stack).toBe(950);
    expect(s!.committedStreet).toBe(50);
    expect(s!.committedTotal).toBe(50);
  });

  it("charges only the difference when already partly in", () => {
    const [s] = applyPending(
      [seat({ committedStreet: 20, committedTotal: 20, stack: 980 })],
      pending({ kind: "call", toTotal: 50 }),
    );
    expect(s!.stack).toBe(950);
    expect(s!.committedStreet).toBe(50);
  });

  it("marks a fold without moving chips", () => {
    const [s] = applyPending([seat()], pending({ kind: "fold" }));
    expect(s!.folded).toBe(true);
    expect(s!.stack).toBe(1000);
  });

  it("leaves chips alone on a check", () => {
    const [s] = applyPending([seat()], pending({ kind: "check", toTotal: 0 }));
    expect(s!.stack).toBe(1000);
    expect(s!.committedStreet).toBe(0);
  });

  it("marks all in when the raise takes the whole stack", () => {
    const [s] = applyPending([seat()], pending({ kind: "allin", toTotal: 1000 }));
    expect(s!.stack).toBe(0);
    expect(s!.allIn).toBe(true);
  });

  it("never spends more than the stack", () => {
    const [s] = applyPending([seat({ stack: 40 })], pending({ kind: "call", toTotal: 500 }));
    expect(s!.stack).toBe(0);
    expect(s!.committedStreet).toBe(40);
  });

  it("touches only the acting seat", () => {
    const seats = [seat(), seat({ index: 1, occupant: "them" })];
    const out = applyPending(seats, pending());
    expect(out[1]).toBe(seats[1]);
  });

  it("does not mutate the input", () => {
    const seats = [seat()];
    applyPending(seats, pending({ kind: "call", toTotal: 50 }));
    expect(seats[0]!.stack).toBe(1000);
  });
});

/**
 * The bug this guards: a raise counted the pot up twice.
 *
 * The hand account and the seat accounts arrive as separate websocket pushes.
 * Replayed in the order the rollup actually delivers them, the pot the felt
 * draws must never go backwards — a dip is what restarts AnimatedNumber and
 * the pile of chips beside it.
 */
describe("the pot through a raise, push by push", () => {
  const pot = (seats: (SeatView | null)[], h: HandView, p: PendingAction) =>
    potTotal(pendingApplies(p, h, seats) ? applyPending(seats, p) : seats);

  it("never dips while the chain catches up", () => {
    const villain = seat({ index: 1, occupant: "them", committedStreet: 20, committedTotal: 20 });
    const me = seat({ committedStreet: 20, committedTotal: 20, stack: 980 });
    const p = pending({ kind: "raise", toTotal: 60 });

    const before = potTotal([me, villain]);
    const frames = [
      // 1. the press: nothing from the chain yet
      pot([me, villain], hand(), p),
      // 2. the hand account lands first — toAct has moved, the seat has not
      pot([me, villain], hand({ toAct: 1 }), p),
      // 3. the seat account lands
      pot(
        [seat({ committedStreet: 60, committedTotal: 60, stack: 940 }), villain],
        hand({ toAct: 1 }),
        p,
      ),
    ];

    expect(before).toBe(40);
    expect(frames).toEqual([80, 80, 80]);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1]!);
    }
  });
});

describe("applyPendingHand", () => {
  it("clears our turn so the action bar closes at once", () => {
    expect(applyPendingHand(hand(), pending()).toAct).toBe(NO_SEAT);
  });

  it("raises the current bet on a raise", () => {
    const h = applyPendingHand(hand(), pending({ kind: "raise", toTotal: 150 }));
    expect(h.currentBet).toBe(150);
  });

  it("leaves the current bet alone on a call", () => {
    expect(applyPendingHand(hand(), pending({ kind: "call", toTotal: 50 })).currentBet).toBe(50);
  });
});
