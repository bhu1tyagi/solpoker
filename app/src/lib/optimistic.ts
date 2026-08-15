/**
 * Showing your own action before the chain confirms it.
 *
 * The rollup answers in about a third of a second, which is fast for a
 * blockchain and slow for a button. So the table renders your action the moment
 * you press, and the confirmation lands inside the chip animation rather than
 * after it.
 *
 * Only your own seat is predicted, and only the parts that are exactly known:
 * the amount you are putting in, and the fact that you are no longer to act.
 * Whose turn is next, whether the street closed, how the pot re-layers, all of
 * that is left to the chain. Guessing those is where an optimistic UI starts
 * telling people things that are not true.
 */

import type { HandView, PendingAction, SeatView } from "@/stores/table-store";
import { NO_SEAT } from "./constants";

/** Is this pending action still about the hand on screen? */
export function pendingApplies(
  pending: PendingAction | null,
  hand: HandView | null,
): pending is PendingAction {
  if (!pending || !hand) return false;
  if (pending.handNumber !== hand.handNumber) return false;
  // Once the chain says someone else is to act, it has caught up with us.
  return hand.toAct === pending.seat;
}

/** The seats as they will be once the action lands. */
export function applyPending(
  seats: (SeatView | null)[],
  pending: PendingAction,
): (SeatView | null)[] {
  const seat = seats[pending.seat];
  if (!seat) return seats;

  const next = [...seats];
  if (pending.kind === "fold") {
    next[pending.seat] = { ...seat, folded: true, needsAction: false };
    return next;
  }
  if (pending.kind === "check") {
    next[pending.seat] = { ...seat, needsAction: false };
    return next;
  }

  // Call, raise and all-in all move the street total to a known number.
  const added = Math.max(0, Math.min(pending.toTotal - seat.committedStreet, seat.stack));
  next[pending.seat] = {
    ...seat,
    stack: seat.stack - added,
    committedStreet: seat.committedStreet + added,
    committedTotal: seat.committedTotal + added,
    allIn: added >= seat.stack,
    needsAction: false,
  };
  return next;
}

/** The hand as it will be: your turn is over, whoever is next is not our guess. */
export function applyPendingHand(hand: HandView, pending: PendingAction): HandView {
  const raised = pending.kind === "raise" || pending.kind === "allin";
  return {
    ...hand,
    toAct: NO_SEAT,
    currentBet: raised ? Math.max(hand.currentBet, pending.toTotal) : hand.currentBet,
  };
}
