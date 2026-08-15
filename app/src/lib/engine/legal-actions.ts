/**
 * What the seat to act may legally do, ported from Betting::legal_actions in
 * crates/poker-engine/src/betting.rs.
 *
 * The action bar needs exact amounts before the player presses anything, and
 * the chain is 300ms away, so this is computed locally from the Hand and Seat
 * accounts we already hold. The program re-checks all of it.
 */

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips needed to call, capped at the stack, so it is the all-in amount when short. */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal raise target. Equals maxRaiseTo when the only raise is a short all-in. */
  minRaiseTo: number;
  /** Largest legal raise target, the all-in amount. */
  maxRaiseTo: number;
}

export const NO_ACTIONS: LegalActions = {
  canFold: false,
  canCheck: false,
  canCall: false,
  callAmount: 0,
  canRaise: false,
  minRaiseTo: 0,
  maxRaiseTo: 0,
};

export interface SeatBettingView {
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  stack: number;
  committedStreet: number;
  mayRaise: boolean;
}

export interface HandBettingView {
  toAct: number;
  currentBet: number;
  /** The minimum raise increment, not a target. */
  minRaise: number;
}

const isActive = (s: SeatBettingView) => s.inHand && !s.folded && !s.allIn;

export function legalActions(
  hand: HandBettingView,
  seat: SeatBettingView | undefined,
  seatIndex: number,
): LegalActions {
  if (!seat || hand.toAct !== seatIndex) return NO_ACTIONS;
  if (!isActive(seat)) return NO_ACTIONS;

  const owed = Math.max(0, hand.currentBet - seat.committedStreet);
  const callAmount = Math.min(owed, seat.stack);
  const maxRaiseTo = seat.committedStreet + seat.stack;
  // A raise must beat the current bet, and the seat must not be capped by an
  // earlier under-raise all-in.
  const canRaise = seat.mayRaise && maxRaiseTo > hand.currentBet;
  const fullRaiseTo = hand.currentBet + hand.minRaise;
  const minRaiseTo = canRaise ? Math.min(fullRaiseTo, maxRaiseTo) : 0;

  return {
    canFold: true,
    canCheck: owed === 0,
    canCall: owed > 0,
    callAmount,
    canRaise,
    minRaiseTo,
    maxRaiseTo,
  };
}

/**
 * Raise presets, as street totals. A pot-sized raise is the pot plus what a call
 * would cost, which is the usual definition and what a player expects.
 */
export function raisePresets(
  la: LegalActions,
  potTotal: number,
  currentBet: number,
): { label: string; to: number }[] {
  if (!la.canRaise) return [];
  const potAfterCall = potTotal + la.callAmount;
  const targets = [
    { label: "1/3", to: currentBet + Math.round(potAfterCall / 3) },
    { label: "1/2", to: currentBet + Math.round(potAfterCall / 2) },
    { label: "pot", to: currentBet + potAfterCall },
    { label: "all in", to: la.maxRaiseTo },
  ];
  const seen = new Set<number>();
  return targets
    .map((t) => ({
      label: t.label,
      to: Math.min(Math.max(t.to, la.minRaiseTo), la.maxRaiseTo),
    }))
    .filter((t) => {
      if (seen.has(t.to)) return false;
      seen.add(t.to);
      return true;
    });
}
