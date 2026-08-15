"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { handId, saveHand } from "@/lib/history-db";
import { useTableStore } from "@/stores/table-store";
import { MAX_SEATS, SALT_REVEALED } from "@/lib/constants";

/**
 * Writing a finished hand down before the chain forgets it.
 *
 * The Hand and Seat accounts are reused, so the salts and seed behind hand N
 * are overwritten the moment anyone commits a salt for hand N+1. That gives a
 * narrow window, and the fix is to snapshot from state already in memory rather
 * than fetching after the fact and racing another client.
 *
 * The crank waits on `ready` before starting the next hand's salt, so this
 * client never overwrites the record it is about to take.
 */
export function useHandCapture(tableId: number | null) {
  const [pendingHand, setPendingHand] = useState<number | null>(null);
  const captured = useRef(new Set<number>());
  const lastState = useRef<number | null>(null);

  const hand = useTableStore((s) => s.hand);
  const table = useTableStore((s) => s.table);
  const seats = useTableStore((s) => s.seats);

  useEffect(() => {
    if (!hand || !table || tableId === null) return;

    const wasLive = lastState.current === 1;
    lastState.current = table.state;

    // A settled hand: back to waiting, at showdown, with a result recorded.
    const settled =
      table.state === 0 &&
      hand.street >= 4 &&
      hand.handNumber > 0 &&
      hand.resultHash !== "0".repeat(64);

    if (!settled || captured.current.has(hand.handNumber)) return;
    if (!wasLive && captured.current.size === 0 && hand.handNumber === 0) return;

    const record = {
      id: handId(tableId, hand.handNumber),
      tableId,
      handNumber: hand.handNumber,
      vrfRandomness: hand.vrfRandomness,
      shuffleSeed: hand.shuffleSeed,
      board: hand.board,
      resultHash: hand.resultHash,
      capturedAt: Date.now(),
      seats: Array.from({ length: MAX_SEATS }, (_, i) => {
        const s = seats[i];
        const dealtIn = (hand.dealtIn & (1 << i)) !== 0;
        return {
          index: i,
          dealtIn,
          saltCommit: s?.saltCommit ?? "",
          // Only a revealed salt is real. An unopened commitment is not one.
          salt: s?.saltState === SALT_REVEALED ? (s?.salt ?? null) : null,
          revealed: hand.revealedMask & (1 << i) ? hand.revealed[i] : null,
        };
      }).filter((s) => s.dealtIn || s.salt),
    };

    captured.current.add(hand.handNumber);
    setPendingHand(hand.handNumber);

    void saveHand(record)
      .catch(() => {
        // Storage refused. The hand is lost to history but play continues.
      })
      .finally(() => setPendingHand(null));
  }, [hand, table, seats, tableId]);

  /** The crank asks this before committing a salt for the next hand. */
  const ready = useCallback(() => pendingHand === null, [pendingHand]);

  return { ready, pendingHand };
}
