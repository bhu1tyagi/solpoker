import { describe, it, expect } from "vitest";
import { applyPending, applyPendingHand, pendingApplies } from "./optimistic";
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
  sentAt: 0,
  ...over,
});

describe("pendingApplies", () => {
  it("applies while the chain still says it is our turn", () => {
    expect(pendingApplies(pending(), hand())).toBe(true);
  });

  it("stops once the chain moves to another seat", () => {
    expect(pendingApplies(pending(), hand({ toAct: 1 }))).toBe(false);
  });

  it("stops once the street closes", () => {
    expect(pendingApplies(pending(), hand({ toAct: NO_SEAT }))).toBe(false);
  });

  it("never leaks across hands", () => {
    expect(pendingApplies(pending({ handNumber: 4 }), hand())).toBe(false);
  });

  it("is false with nothing pending", () => {
    expect(pendingApplies(null, hand())).toBe(false);
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
