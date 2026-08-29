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

interface LiveSnapshot {
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
  // won is to have kept what it held a moment earlier.
  useEffect(() => {
    if (!hand || !table || table.state !== 1 || hand.handNumber === 0) return;
    live.current = {
      handNumber: hand.handNumber,
      stacks: Array.from({ length: MAX_SEATS }, (_, i) => seats[i]?.stack ?? 0),
      pot: seats.reduce((sum, s) => sum + (s?.committedTotal ?? 0), 0),
      dealtIn: (live.current?.handNumber === hand.handNumber ? live.current.dealtIn : 0) |
        hand.dealtIn,
    };
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
    // What each seat won is what its stack gained across settlement, read now
    // that the payout has certainly arrived. Every seat that gained gets its
    // own stream, so a split pot animates as the two payments it actually was.
    const readPayouts = (): Award[] => {
      const now = seatsRef.current;
      const paid: Award[] = [];
      for (let i = 0; i < MAX_SEATS; i++) {
        const gained = (now[i]?.stack ?? 0) - snapshot.stacks[i];
        if (gained > 0) paid.push({ seat: i, amount: gained });
      }
      return paid;
    };

    at(revealDone + COMPARE_MS, () => {
      let paid = readPayouts();
      /*
       * One late notification must not swallow the whole payment.
       *
       * Stacks arrive as their own account updates, and a winner whose update
       * has not landed by this beat reads as having gained nothing — so their
       * stream is simply not drawn, and on a split that means the pot visibly
       * pays one of the two winners. Rather than guess an amount, look again a
       * beat later: the figures stay the ones the chain reported, and the only
       * thing that changes is how long we were willing to wait for them.
       */
      const start = (list: Award[]) => {
        setAwards(list);
        setStage("award");
        at(awardHold(list.length), () => {
          setStage(null);
          setAwards([]);
          setShown(new Set());
        });
      };
      if (paid.length === 0) {
        at(600, () => {
          paid = readPayouts();
          start(paid);
        });
        return;
      }
      start(paid);
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
