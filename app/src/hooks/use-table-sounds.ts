"use client";

import { useEffect, useRef } from "react";
import { sfx } from "@/lib/sfx";
import { MAX_SEATS } from "@/lib/constants";
import { NO_CARD } from "@/lib/engine/cards";
import type { HandView, SeatView, TableView } from "@/stores/table-store";
import type { ShowdownStage } from "./use-showdown-sequence";

/**
 * The table, heard rather than seen.
 *
 * Sounds are driven from the same chain state the felt is drawn from, so they
 * fire for everyone at the table rather than only for the player who pressed a
 * button. Each effect watches a transition and remembers what it last saw, so
 * a re-render with identical state stays silent.
 *
 * Your own actions are deliberately not handled here. Those play the instant
 * the button is pressed, because feedback that waits a third of a second for
 * the chain to agree feels broken.
 */
export function useTableSounds({
  hand,
  table,
  seats,
  mySeat,
  stage,
  working,
  myHole,
}: {
  hand: HandView | null;
  table: TableView | null;
  seats: (SeatView | null)[];
  mySeat: number;
  stage: ShowdownStage;
  working: boolean;
  /** Your own two cards, once the enclave has served them. */
  myHole: number[] | null;
}) {
  const prevBoard = useRef(0);
  const prevDealt = useRef(0);
  const prevFolded = useRef<boolean[]>([]);
  const prevCommitted = useRef<number[]>([]);
  const prevToAct = useRef(-1);
  const prevStage = useRef<ShowdownStage>(null);
  const prevRevealed = useRef(0);
  const shuffledFor = useRef(-1);
  const prevOccupied = useRef<(string | null)[]>([]);
  const peekedFor = useRef(-1);

  // Somebody taking a chair, or leaving one.
  //
  // Compared by occupant rather than by count, so one player standing up as
  // another sits down is heard as both things rather than as silence.
  useEffect(() => {
    const now = seats.map((s) => s?.occupant ?? null);
    const before = prevOccupied.current;
    if (before.length) {
      for (let i = 0; i < now.length; i++) {
        if (now[i] && now[i] !== before[i]) sfx.seat();
        else if (!now[i] && before[i]) sfx.standUp();
      }
    }
    prevOccupied.current = now;
  }, [seats]);

  // Your own cards, once the enclave has served them to you.
  //
  // Keyed on the hand number, not on the cards: the same two cards can arrive
  // twice from a re-read, and a sound that fires on every refetch is worse
  // than no sound at all.
  useEffect(() => {
    const n = hand?.handNumber ?? 0;
    const got = myHole !== null && myHole.length === 2 && myHole[0] !== NO_CARD;
    if (got && n !== 0 && peekedFor.current !== n) {
      peekedFor.current = n;
      sfx.peek(0.12);
    }
  }, [myHole, hand?.handNumber]);

  // Cards arriving on the board, one sound per new card.
  useEffect(() => {
    const count = hand?.board.filter((c) => c !== NO_CARD).length ?? 0;
    if (count > prevBoard.current) {
      const fresh = count - prevBoard.current;
      for (let i = 0; i < fresh; i++) sfx.deal(i * 0.09);
    }
    prevBoard.current = count;
  }, [hand?.board]);

  // Hole cards being dealt: one pass of the deck around the table.
  useEffect(() => {
    const dealt = hand?.dealtIn ?? 0;
    if (dealt !== 0 && prevDealt.current === 0) {
      const players = countBits(dealt);
      for (let i = 0; i < players * 2; i++) sfx.deal(i * 0.07);
    }
    prevDealt.current = dealt;
  }, [hand?.dealtIn]);

  // The riffle, once per hand, while the enclave is drawing its randomness.
  useEffect(() => {
    const n = hand?.handNumber ?? 0;
    if (working && n !== shuffledFor.current) {
      shuffledFor.current = n;
      sfx.shuffle();
    }
    if (!working && !table) shuffledFor.current = -1;
  }, [working, hand?.handNumber, table]);

  // What everyone else did: folds, and chips going in.
  useEffect(() => {
    for (let i = 0; i < MAX_SEATS; i++) {
      const seat = seats[i];
      const folded = seat?.folded ?? false;
      const committed = seat?.committedStreet ?? 0;
      const wasFolded = prevFolded.current[i] ?? false;
      const wasCommitted = prevCommitted.current[i] ?? 0;

      if (i !== mySeat) {
        if (folded && !wasFolded) sfx.fold();
        else if (committed > wasCommitted) {
          // A big jump is a raise, a small one is a call. The exact line does
          // not matter; what matters is that they do not sound identical.
          if (committed - wasCommitted > wasCommitted) sfx.bet();
          else sfx.call();
        }
      }

      prevFolded.current[i] = folded;
      prevCommitted.current[i] = committed;
    }
  }, [seats, mySeat]);

  // Your turn to act.
  useEffect(() => {
    const toAct = hand?.toAct ?? -1;
    if (toAct !== prevToAct.current) {
      if (toAct === mySeat && mySeat >= 0 && table?.state === 1) sfx.turn();
      prevToAct.current = toAct;
    }
  }, [hand?.toAct, mySeat, table?.state]);

  // Hands turning face up at showdown, and the pot being pushed across.
  useEffect(() => {
    const revealed = hand?.revealedMask ?? 0;
    const fresh = countBits(revealed) - countBits(prevRevealed.current);
    if (stage === "reveal" && fresh > 0) {
      // One turn per hand, not one per showdown. Two players tabling their
      // cards should sound like two players tabling their cards, and the
      // stagger is what makes a three-way showdown feel like a showdown.
      for (let i = 0; i < fresh; i++) sfx.flip(i * 0.13);
    }
    prevRevealed.current = revealed;
  }, [hand?.revealedMask, stage]);

  useEffect(() => {
    if (stage === "award" && prevStage.current !== "award") sfx.win();
    prevStage.current = stage;
  }, [stage]);
}

const countBits = (mask: number) => {
  let n = 0;
  for (let i = 0; i < MAX_SEATS; i++) if (mask & (1 << i)) n++;
  return n;
};
