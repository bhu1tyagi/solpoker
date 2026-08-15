"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { handId, saveHand } from "@/lib/history-db";
import { pruneSalts } from "@/lib/salts";
import { useTableStore } from "@/stores/table-store";
import { MAX_SEATS, SALT_REVEALED } from "@/lib/constants";

/**
 * Writing a finished hand down before the chain forgets it.
 *
 * Nothing keeps a hand's history on chain. The Hand and Seat accounts are
 * reused, and only a digest of each result reaches the base layer, so if no
 * client records a hand as it happens then nobody can check it afterwards.
 *
 * The timing matters more than it looks. Settlement clears the salt state on
 * every seat and resets the dealt-in mask, and the next hand's commit
 * overwrites the salt bytes themselves. Read after the fact and you get a
 * record that says nobody was dealt in and nobody published a salt, which then
 * fails to verify for reasons that have nothing to do with the deal. So both
 * are collected while the hand is live and combined with the result when it
 * settles.
 */

interface SaltRecord {
  commit: string;
  salt: string;
}

interface HandBuffer {
  salts: Map<number, SaltRecord>;
  /** Who was dealt in, remembered before settlement clears the mask. */
  dealtIn: number;
}

export function useHandCapture(tableId: number | null) {
  const [pendingHand, setPendingHand] = useState<number | null>(null);
  const captured = useRef(new Set<number>());
  /** What a hand looked like while it was still readable. */
  const buffer = useRef(new Map<number, HandBuffer>());

  const hand = useTableStore((s) => s.hand);
  const table = useTableStore((s) => s.table);
  const seats = useTableStore((s) => s.seats);

  // Collect salts for as long as the hand is live.
  useEffect(() => {
    if (!hand || !table || table.state !== 1 || hand.handNumber === 0) return;

    let forHand = buffer.current.get(hand.handNumber);
    if (!forHand) {
      forHand = { salts: new Map(), dealtIn: 0 };
      buffer.current.set(hand.handNumber, forHand);
    }
    forHand.dealtIn |= hand.dealtIn;
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = seats[i];
      if (!s || s.saltState !== SALT_REVEALED || forHand.salts.has(i)) continue;
      forHand.salts.set(i, { commit: s.saltCommit, salt: s.salt });
    }

    // Keep a few hands' worth, no more.
    if (buffer.current.size > 6) {
      const oldest = Math.min(...buffer.current.keys());
      buffer.current.delete(oldest);
    }
  }, [hand, table, seats]);

  // Write the hand down once it settles.
  useEffect(() => {
    if (!hand || !table || tableId === null) return;

    const settled =
      table.state === 0 &&
      hand.street >= 4 &&
      hand.handNumber > 0 &&
      hand.resultHash !== "0".repeat(64);

    if (!settled || captured.current.has(hand.handNumber)) return;

    const seen = buffer.current.get(hand.handNumber);
    // Without the salts there is nothing to verify, so there is no point
    // storing a record that would only ever fail.
    if (!seen || seen.salts.size < 2 || seen.dealtIn === 0) return;

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
        const s = seen.salts.get(i);
        return {
          index: i,
          dealtIn: (seen.dealtIn & (1 << i)) !== 0,
          saltCommit: s?.commit ?? "",
          salt: s?.salt ?? null,
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
      .finally(() => {
        setPendingHand(null);
        // Old salts have served their purpose once the hand is stored.
        pruneSalts(table.address, hand.handNumber);
      });
  }, [hand, table, tableId]);

  /** The crank waits on this before committing a salt for the next hand. */
  const ready = useCallback(() => pendingHand === null, [pendingHand]);

  return { ready, pendingHand };
}
