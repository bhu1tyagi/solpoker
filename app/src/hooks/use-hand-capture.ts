"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { handId, saveHand } from "@/lib/history-db";
import { reportHand, type HandResults } from "@/lib/report-hand";
import { pruneSalts } from "@/lib/salts";
import { decodeHand, decodeSeat } from "@/lib/decode";
import { verify } from "@/lib/verifier/verify-shuffle";
import { computeResultHash } from "@/lib/verifier/result-hash";
import { rakeFor } from "@/lib/rake";
import { handPda, seatPda } from "@/lib/pdas";
import { potTotal, useTableStore } from "@/stores/table-store";
import { MAX_SEATS, NO_CARD, SALT_REVEALED } from "@/lib/constants";

/**
 * Writing a finished hand down before the chain forgets it.
 *
 * Nothing keeps a hand's history on chain. The Hand and Seat accounts are
 * reused, and only a digest of each result reaches the base layer, so if no
 * client records a hand as it happens then nobody can check it afterwards.
 *
 * Two timing lessons are baked in here, both paid for:
 *
 * Salts and the dealt-in mask are collected while the hand is live, because
 * settlement clears them and the next hand overwrites the salt bytes.
 *
 * The settled hand itself is FETCHED rather than read from the live store.
 * Store updates arrive as separate account notifications in whatever order and
 * grouping the socket gives them, and in practice the brief settled state can
 * be skipped entirely: one snapshot shows the showdown, the next already shows
 * the following hand's shuffle. A capture that waits to observe the settled
 * moment can miss it forever. Fetching works because everything the record
 * needs, the seed, the randomness, the board, the reveals and the result hash,
 * stays on the hand account from settlement until the NEXT hand starts, which
 * is several seconds of salt exchange and a VRF round trip away.
 */

interface SaltRecord {
  commit: string;
  salt: string;
}

/**
 * An occupant, the last stack seen in front of them, and the most they were
 * ever seen to have committed.
 *
 * The commitment is a running maximum for the same reason the pot is: it is
 * summed from seat state that settlement zeroes, and the notification carrying
 * the last call can arrive after the one that clears the table.
 */
interface SeatMeta {
  wallet: string;
  stack: number;
  contributed: number;
}

interface HandBuffer {
  salts: Map<number, SaltRecord>;
  /** Who was dealt in, remembered before settlement clears the mask. */
  dealtIn: number;
  /**
   * The pot, read while the hand is still live.
   *
   * There is no pot field anywhere: the pot is the sum of what the seats have
   * committed, and settlement zeroes those. So it is watched rather than
   * fetched, and kept as a running maximum. A snapshot taken at any single
   * moment is only that street's total, and the notification carrying the last
   * call can arrive after the one that clears the table.
   */
  pot: number;
  /**
   * Who was sitting where, and with how much, on the last look before the
   * pot moved.
   *
   * Both halves are gathered live for the same reason the salts are. The
   * wallet, because a player can win a hand and leave before it is captured,
   * and an empty seat afterwards cannot say who it paid. The stack, because a
   * payout is only ever visible as a difference — settlement adds it straight
   * into the seat and writes the total nowhere.
   */
  seatsMeta: Map<number, SeatMeta>;
  /** The big blind, which sets the rake-free floor and the cap. */
  bigBlind: number;
}

const FETCH_TRIES = 14;
const FETCH_GAP_MS = 700;

/**
 * Work out what each seat was actually paid, and refuse to guess.
 *
 * The obvious reading — stack afterwards minus stack before — is right only if
 * the "before" was the last state of the hand. It often is not: notifications
 * arrive in whatever order the socket gives them, a seat can be observed
 * mid-street, and by the time the settled hand is fetched the next hand's
 * blinds may already have come out of the same stacks. Any of that produces a
 * plausible set of payouts that is wrong.
 *
 * So nothing is inferred without proof. Settlement hashed the payouts into
 * `result_hash`, so a candidate reading can be checked against the digest the
 * chain published, and only a candidate that reproduces it is reported. Two
 * candidates are tried: the observed deltas, and — because the great majority
 * of hands have one winner and a stale stack reading is the common failure —
 * each seat in turn taking the whole pot less the rake.
 *
 * Everything else is reported as a hand with no payouts. A miss costs the
 * rewards figures one hand; a guess would corrupt them permanently.
 */
function provePayouts(
  handNumber: number,
  shuffleSeed: string,
  board: number[],
  resultHash: string,
  stacksAfter: (number | null)[],
  seen: HandBuffer,
): number[] | null {
  const matches = (candidate: number[]) =>
    computeResultHash(handNumber, shuffleSeed, board, candidate) === resultHash;

  const deltas = Array.from({ length: MAX_SEATS }, (_, i) => {
    const after = stacksAfter[i];
    const before = seen.seatsMeta.get(i)?.stack;
    if (after === null || after === undefined || before === undefined) return 0;
    return Math.max(0, after - before);
  });
  if (matches(deltas)) return deltas;

  // The sole-winner family. The pot is the running maximum of what the seats
  // committed, which is the pre-rake figure settlement worked from.
  const sawFlop = board[0] !== NO_CARD;
  const net = seen.pot - rakeFor(seen.pot, seen.bigBlind, sawFlop);
  if (net > 0) {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (!(seen.dealtIn & (1 << i))) continue;
      const candidate = Array.from({ length: MAX_SEATS }, (_, j) =>
        j === i ? net : 0,
      );
      if (matches(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Read the settled seats and turn them into a reportable result, or nothing.
 *
 * Deliberately total: every failure path here — an RPC that will not answer, a
 * seat account that has already been closed, payouts that do not reproduce the
 * hash, a table whose big blind was never observed — returns null, and null
 * means the hand is reported without money attached. None of this is allowed
 * to throw, because it runs between a settled hand and the next one and the
 * crank is waiting on it.
 */
async function proveResults(
  connection: Connection,
  table: PublicKey,
  record: {
    handNumber: number;
    shuffleSeed: string;
    board: number[];
    resultHash: string;
  },
  seen: HandBuffer,
): Promise<HandResults | null> {
  // Without a big blind the rake-free floor and the cap are unknown, and the
  // server would be deriving a rake from a number nobody checked.
  if (seen.bigBlind <= 0) return null;
  try {
    const infos = await connection.getMultipleAccountsInfo(
      Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i)),
      "processed",
    );
    const stacksAfter = infos.map((info) => {
      if (!info) return null;
      try {
        return decodeSeat(new Uint8Array(info.data)).stack;
      } catch {
        return null;
      }
    });

    const payouts = provePayouts(
      record.handNumber,
      record.shuffleSeed,
      record.board,
      record.resultHash,
      stacksAfter,
      seen,
    );
    if (!payouts) return null;

    /*
     * Every seat that was dealt in, winner or not.
     *
     * A wallet that could not be remembered costs that seat its row and
     * nothing else. The alternative — dropping the whole hand — would throw
     * away five known results to avoid one unknown, and the contributions are
     * reported for all six seats regardless, so the sum the server checks the
     * pot against stays complete either way.
     */
    const wallets: (string | null)[] = [];
    const contributed: number[] = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      const meta = seen.seatsMeta.get(i);
      const dealt = (seen.dealtIn & (1 << i)) !== 0;
      wallets.push(dealt && meta ? meta.wallet : null);
      contributed.push(meta?.contributed ?? 0);
    }
    if (!wallets.some((w) => w !== null)) return null;

    return {
      bigBlind: seen.bigBlind,
      payouts,
      contributed,
      wallets,
      dealtIn: seen.dealtIn,
    };
  } catch {
    return null;
  }
}

export function useHandCapture(
  tableId: number | null,
  connection: Connection | null,
  table: PublicKey | null,
) {
  const [pendingHand, setPendingHand] = useState<number | null>(null);
  const started = useRef(new Set<number>());
  /** What a hand looked like while it was still readable. */
  const buffer = useRef(new Map<number, HandBuffer>());

  const hand = useTableStore((s) => s.hand);
  const tableView = useTableStore((s) => s.table);
  const seats = useTableStore((s) => s.seats);
  const config = useTableStore((s) => s.config);

  // Collect salts for as long as the hand is live.
  useEffect(() => {
    if (!hand || !tableView || tableView.state !== 1 || hand.handNumber === 0) return;

    let forHand = buffer.current.get(hand.handNumber);
    if (!forHand) {
      forHand = {
        salts: new Map(),
        dealtIn: 0,
        pot: 0,
        seatsMeta: new Map(),
        bigBlind: 0,
      };
      buffer.current.set(hand.handNumber, forHand);
    }
    forHand.dealtIn |= hand.dealtIn;
    forHand.pot = Math.max(forHand.pot, potTotal(seats));
    if (config) forHand.bigBlind = config.bigBlind;
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = seats[i];
      if (!s || s.saltState !== SALT_REVEALED || forHand.salts.has(i)) continue;
      forHand.salts.set(i, { commit: s.saltCommit, salt: s.salt });
    }
    // The stack is overwritten on every look, so what survives is the last
    // state before the pot moved rather than the first. The commitment only
    // ever climbs, because a seat that has already been observed betting must
    // not be recorded as having bet less when a later snapshot arrives with
    // the street already cleared. A seat that empties mid-hand keeps the
    // occupant it had while it was playing.
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = seats[i];
      if (!s?.occupant) continue;
      const prev = forHand.seatsMeta.get(i);
      forHand.seatsMeta.set(i, {
        wallet: s.occupant,
        stack: s.stack,
        contributed: Math.max(prev?.contributed ?? 0, s.committedTotal),
      });
    }

    // Keep a few hands' worth, no more.
    if (buffer.current.size > 6) {
      const oldest = Math.min(...buffer.current.keys());
      buffer.current.delete(oldest);
    }
  }, [hand, tableView, seats]);

  // Once a hand looks over, chase its settled state and write it down.
  useEffect(() => {
    if (!hand || !tableView || tableId === null || !connection || !table) return;

    // The trigger is deliberately loose: the hand has reached its end and the
    // table is back to waiting, in either order. The fetch below establishes
    // the truth; this only decides when to start looking.
    const over =
      hand.handNumber > 0 &&
      hand.street >= 4 &&
      (tableView.state === 0 || hand.toAct === 0xff);
    if (!over || started.current.has(hand.handNumber)) return;

    const n = hand.handNumber;
    const seen = buffer.current.get(n);
    // Without the salts there is nothing to verify, so there is no point
    // storing a record that would only ever fail.
    if (!seen || seen.salts.size < 2 || seen.dealtIn === 0) return;

    started.current.add(n);
    setPendingHand(n);

    const address = handPda(table);
    void (async () => {
      try {
        for (let attempt = 0; attempt < FETCH_TRIES; attempt++) {
          const info = await connection.getAccountInfo(address, "processed").catch(() => null);
          if (info) {
            const h = decodeHand(new Uint8Array(info.data));
            // The next hand started before we caught this one settled. Its
            // seed is gone; a miss is recorded as nothing rather than as a
            // record that cannot verify.
            if (h.handNumber !== n) {
              console.warn(`hand ${n} finished but could not be captured for history`);
              return;
            }
            // Settled: the dealt-in mask is cleared and the result is in.
            // The shuffle state is NOT part of this, because the next hand's
            // request flips it while the settled data is still all here.
            if (h.dealtIn === 0 && h.street >= 4 && h.resultHash !== "0".repeat(64)) {
              const record = {
                id: handId(tableId, n),
                tableId,
                handNumber: n,
                vrfRandomness: h.vrfRandomness,
                shuffleSeed: h.shuffleSeed,
                board: h.board,
                resultHash: h.resultHash,
                capturedAt: Date.now(),
                seats: Array.from({ length: MAX_SEATS }, (_, i) => {
                  const s = seen.salts.get(i);
                  return {
                    index: i,
                    dealtIn: (seen.dealtIn & (1 << i)) !== 0,
                    saltCommit: s?.commit ?? "",
                    salt: s?.salt ?? null,
                    revealed: h.revealedMask & (1 << i) ? h.revealed[i] : null,
                  };
                }).filter((s) => s.dealtIn || s.salt),
              };

              // Check it here, before it is stored. A record that cannot
              // verify is a capture bug, and storing it turns that bug into an
              // accusation against an honest hand. Keep retrying instead: the
              // pieces arrive over separate account notifications, so an early
              // read can be incomplete while a later one is whole.
              const check = verify(record);
              if (!check.ok) {
                if (attempt < FETCH_TRIES - 1) {
                  await new Promise((r) => setTimeout(r, FETCH_GAP_MS));
                  continue;
                }
                console.warn(
                  `hand ${n} was not recorded: the capture does not verify ` +
                    `(${check.problems.join("; ")})`,
                );
                return;
              }

              await saveHand(record).catch(() => {
                // Storage refused. The hand is lost to history, play continues.
              });

              // What the seats hold now, read in one call. The payouts are the
              // difference this makes to what was there before, and the result
              // hash decides whether that difference can be believed.
              const results = await proveResults(connection, table, record, seen);

              // The lobby's volume numbers come from these reports; the server
              // re-verifies before storing, and a failure is nobody's problem.
              // The pot travels beside the record rather than inside it: the
              // record is the thing the verifier proves, and it must stay
              // exactly what was proven, here and in IndexedDB. The payouts
              // travel the same way and for the same reason.
              reportHand(record, seen.pot, results ?? undefined);
              pruneSalts(table.toBase58(), n);
              return;
            }
          }
          await new Promise((r) => setTimeout(r, FETCH_GAP_MS));
        }
        console.warn(`hand ${n} finished but could not be captured for history`);
      } finally {
        setPendingHand((p) => (p === n ? null : p));
      }
    })();
  }, [hand, tableView, tableId, connection, table]);

  /** The crank waits on this before committing a salt for the next hand. */
  const ready = useCallback(() => pendingHand === null, [pendingHand]);

  return { ready, pendingHand };
}
