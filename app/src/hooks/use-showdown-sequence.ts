"use client";

import { useEffect, useRef, useState } from "react";
import type { HandView, SeatView, TableView } from "@/stores/table-store";
import { MAX_SEATS } from "@/lib/constants";

/**
 * The end of a hand, paced so a person can follow it.
 *
 * A hand on chain ends in a single transaction: cards appear, chips move, the
 * table is waiting again. That is correct and unreadable. This walks the same
 * facts through three beats instead.
 *
 *   reveal   opponents' cards turn over, one seat at a time
 *   compare  the winning five lift and glow, everything else dims
 *   award    the pot travels to whoever won it, split if it was split
 *
 * Nothing here decides anything. Who won is read from the chain, and how much
 * each seat won is the amount their stack actually grew by, so a split pot
 * animates as two payments because it was two payments, and an odd chip lands
 * where the program put it rather than where a guess would.
 */

export type ShowdownStage = "reveal" | "compare" | "award" | null;

export interface Award {
  seat: number;
  amount: number;
}

/** How long each beat holds, in milliseconds. */
const REVEAL_MS = 1100;
const COMPARE_MS = 1600;
/** Cards turn over this far apart during the reveal. */
const REVEAL_STAGGER_MS = 260;

/**
 * How long the award beat has to hold, given how many piles are moving.
 *
 * Not a constant, because it never was one in practice. The felt throws up to
 * ten chips per winner 90ms apart, each taking 750ms to cross, and it staggers
 * a second winner 200ms behind the first — so a single pot needs about 1,560ms
 * and a split needs about 1,760ms. The flat 1,500 that used to sit here cut
 * both off: a hand ended with the last chips of the pot still in the air,
 * deleted mid-flight, and a split pot lost most of the second player's payment.
 * A split is exactly the moment a player most needs to see where the money
 * went, so the beat is now measured from what is actually being animated.
 */
const awardHold = (winners: number) =>
  200 * Math.max(0, winners - 1) + 10 * 90 + 750 + 250;

/** How often the award beat re-reads the payouts, and for how long. */
const SETTLE_POLL_MS = 150;
const SETTLE_WAIT_MS = 900;

export interface LiveSnapshot {
  handNumber: number;
  stacks: number[];
  pot: number;
  /**
   * Who was in the hand. Settlement clears this on chain, so without a copy
   * taken while the hand was live there is nothing left to say whose cards to
   * keep on the table while the showdown plays.
   */
  dealtIn: number;
}

/**
 * The live picture of the hand, recorded so that settlement cannot erase it.
 *
 * `settle` pays every winner, zeroes `committed_total`, and puts the table
 * back to Waiting in ONE instruction — but the six seat accounts, the hand and
 * the table arrive here as separate websocket notifications, in whatever order
 * the socket delivers them. A seat's post-payout stack landing before the
 * table's `Waiting` used to be recorded as the live one, because this ran
 * while `table.state` still said a hand was in progress. The payout diff then
 * came out as zero and the pot came out as zero, and the award beat played to
 * an empty felt. That is the animation that goes missing "sometimes": it was a
 * race, which is exactly why it was only sometimes.
 *
 * Both figures are monotone inside a hand, so they are accumulated rather than
 * overwritten. A seat that was dealt in only ever loses chips until it is
 * paid, and the pot only ever grows until it is cleared — so the low-water
 * mark of one and the high-water mark of the other are the picture immediately
 * before settlement, whichever push happens to land first.
 */
export function foldSnapshot(
  prev: LiveSnapshot | null,
  handNumber: number,
  handDealtIn: number,
  seats: (SeatView | null)[],
): LiveSnapshot {
  const carry = prev?.handNumber === handNumber ? prev : null;
  const dealtIn = (carry?.dealtIn ?? 0) | handDealtIn;
  return {
    handNumber,
    stacks: Array.from({ length: MAX_SEATS }, (_, i) => {
      const stack = seats[i]?.stack ?? 0;
      // The low-water mark applies only to seats that were dealt in. A player
      // who takes a seat mid-hand goes from nothing to a full stack, and a
      // low-water mark would read that as a payout — the pot animating to
      // somebody who never played the hand.
      if (!carry || !(dealtIn & (1 << i))) return stack;
      return Math.min(carry.stacks[i] ?? stack, stack);
    }),
    pot: Math.max(
      carry?.pot ?? 0,
      seats.reduce((sum, s) => sum + (s?.committedTotal ?? 0), 0),
    ),
    dealtIn,
  };
}

/**
 * What each seat won, as the amount its stack actually grew by.
 *
 * Nothing is decided here. A split animates as two payments because it was two
 * payments, an odd chip lands where the program put it, and rake is already
 * out — these are the chain's own figures, read rather than derived.
 */
export function payoutsFrom(
  snapshot: LiveSnapshot,
  seats: (SeatView | null)[],
): Award[] {
  const paid: Award[] = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    // Only a seat that was dealt into this hand can have won it.
    if (!(snapshot.dealtIn & (1 << i))) continue;
    const gained = (seats[i]?.stack ?? 0) - (snapshot.stacks[i] ?? 0);
    if (gained > 0) paid.push({ seat: i, amount: gained });
  }
  return paid;
}

export function useShowdownSequence(
  hand: HandView | null,
  table: TableView | null,
  seats: (SeatView | null)[],
) {
  const [stage, setStage] = useState<ShowdownStage>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [pot, setPot] = useState(0);
  /** Who was in the hand, kept alive for the length of the sequence. */
  const [dealtIn, setDealtIn] = useState(0);
  /** Seats whose cards have turned over so far, during the reveal beat. */
  const [shown, setShown] = useState<Set<number>>(new Set());

  /** The table as it stood just before settlement, for the payout diff. */
  const live = useRef<LiveSnapshot | null>(null);
  const done = useRef(new Set<number>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /**
   * The current seats, readable from inside a timer.
   *
   * Payouts and the table's return to waiting arrive as separate account
   * notifications, so on the render where the hand ends the stacks can still be
   * the pre-payout ones. Reading them again when the award beat starts, a
   * couple of seconds later, is the difference between showing what was won and
   * showing nothing.
   */
  const seatsRef = useRef(seats);
  seatsRef.current = seats;

  // Remember the last live picture of the hand. Settlement pays winners and
  // clears the bets in one transaction, so the only way to know what each seat
  // won is to have kept what it held a moment earlier — see foldSnapshot for
  // why "the last reading" is not the same thing as "the latest reading".
  useEffect(() => {
    if (!hand || !table || table.state !== 1 || hand.handNumber === 0) return;
    live.current = foldSnapshot(live.current, hand.handNumber, hand.dealtIn, seats);
  }, [hand, table, seats]);

  useEffect(() => {
    if (!hand || !table || hand.handNumber === 0) return;

    const settled = table.state === 0 && hand.street >= 4;
    const snapshot = live.current;
    if (
      !settled ||
      !snapshot ||
      snapshot.handNumber !== hand.handNumber ||
      done.current.has(hand.handNumber)
    ) {
      return;
    }
    done.current.add(hand.handNumber);
    // A sequence that is still running belongs to the previous hand. Its
    // timers would otherwise turn cards over and clear the stage underneath
    // this one.
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPot(snapshot.pot);
    setDealtIn(snapshot.dealtIn);

    // Turn the shown hands over one at a time. A hand won on a fold reveals
    // nothing, so that case simply has nothing to stagger and moves on.
    const toShow: number[] = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      if (hand.revealedMask & (1 << i)) toShow.push(i);
    }

    const at = (ms: number, fn: () => void) => {
      timers.current.push(setTimeout(fn, ms));
    };

    setShown(new Set());
    setStage("reveal");
    toShow.forEach((seat, i) => {
      at(i * REVEAL_STAGGER_MS, () =>
        setShown((prev) => new Set(prev).add(seat)),
      );
    });

    const revealDone = Math.max(REVEAL_MS, toShow.length * REVEAL_STAGGER_MS + 500);
    at(revealDone, () => setStage("compare"));
    at(revealDone + COMPARE_MS, () => {
      const start = (list: Award[]) => {
        setAwards(list);
        setStage("award");
        at(awardHold(list.length), () => {
          setStage(null);
          setAwards([]);
          setShown(new Set());
        });
      };

      /*
       * Wait for the payouts to stop changing before drawing them.
       *
       * Every seat is its own account notification, so on a split pot the two
       * winners' stacks almost never land on the same frame. Reading once and
       * committing to whatever happened to be there drew the first winner's
       * stream and silently dropped the second — a split pot that visibly paid
       * one player, at the exact moment a player most needs to see the money
       * divided. The old code half-knew this and looked again only when it had
       * found nothing at all, which is the one case where the miss is obvious.
       *
       * So the beat re-reads until the set of paid seats holds still, or until
       * it has waited longer than the pause it is filling. The figures are
       * still the chain's; the only thing that changed is how long we are
       * willing to wait for all of them.
       */
      let last: string | null = null;
      let waited = 0;
      const settle = () => {
        const paid = payoutsFrom(snapshot, seatsRef.current);
        const key = paid.map((p) => `${p.seat}:${p.amount}`).join(",");
        if ((paid.length > 0 && key === last) || waited >= SETTLE_WAIT_MS) {
          start(paid);
          return;
        }
        last = key;
        waited += SETTLE_POLL_MS;
        at(SETTLE_POLL_MS, settle);
      };
      settle();
    });
  }, [hand, table, seats]);

  // Timers must not fire into an unmounted table, and leaving a table
  // mid-showdown must not strand the next one in a stale beat.
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    },
    [],
  );

  return { stage, awards, pot, shown, dealtIn };
}
