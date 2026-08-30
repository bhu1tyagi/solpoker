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

/**
 * Is this pending action still about the hand on screen?
 *
 * The retiring rule used to be "the chain says someone else is to act", and
 * that dropped the overlay one update too early. The hand account and the six
 * seat accounts are separate subscriptions: the hand's push, carrying the new
 * `toAct`, routinely lands a frame or two before the seat's push carrying the
 * chips. In that gap the overlay was gone and the seat's own data was still
 * pre-bet, so the pot fell back to what it had been and the count-up — and the
 * pile of chips drawn from it — ran a second time from the beginning. On a
 * raise that reads as the money going in twice.
 *
 * So the overlay retires on the chips instead, which is the thing it was
 * predicting. It holds until the chain's own seat says the amount is in (or
 * the seat is out of chips and cannot get there), and drops the moment the
 * hand or the street moves out from under it — a street change resets
 * `committedStreet` to zero, and re-applying a stale target across that
 * boundary would put the bet in twice for real.
 */
export function pendingApplies(
  pending: PendingAction | null,
  hand: HandView | null,
  seats: (SeatView | null)[] = [],
): pending is PendingAction {
  if (!pending || !hand) return false;
  if (pending.handNumber !== hand.handNumber) return false;
  if (pending.street !== hand.street) return false;

  const seat = seats[pending.seat];
  // Without the seat there is nothing to compare against, so fall back to the
  // turn: better a slightly early drop than an overlay that cannot expire.
  if (!seat) return hand.toAct === pending.seat;

  if (pending.kind === "fold") return !seat.folded;
  // A check moves no chips, so the turn is the only evidence there is.
  if (pending.kind === "check") return hand.toAct === pending.seat;
  // Call, raise and all-in: hold until the chips are actually there. An
  // all-in short of the target never reaches it, hence the empty stack.
  return seat.committedStreet < pending.toTotal && seat.stack > 0;
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
