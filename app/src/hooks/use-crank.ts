"use client";

import { useEffect, useRef } from "react";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Crank, type CrankSnapshot } from "@/lib/crank";
import type { SolpokerProgram } from "@/lib/anchor";
import { useTableStore } from "@/stores/table-store";
import { getBaseConnection } from "@/lib/connection";
import { decodeHistory } from "@/lib/decode";
import { historyPda } from "@/lib/pdas";
import { errorName, friendlyError, isWrongLayer } from "@/lib/net";
import { toast } from "@/stores/ui-store";

/** Raised by the session key program when a key can no longer act. */
const SESSION_ERRORS = new Set(["InvalidToken", "NoToken", "InvalidAuthority"]);

const TICK_MS = 500;
/** How often to ask the base layer what it has already recorded. */
const HISTORY_POLL_MS = 30_000;

/**
 * Runs the table state machine while this page is open.
 *
 * Every seated client runs one. They step on each other harmlessly, and if all
 * of them close the tab the table simply pauses until someone opens it again.
 *
 * Alongside the per-hand steps, this periodically pushes results to the base
 * layer. The cadence lives here rather than in the crank because deciding
 * whether a commit is needed means reading the base layer, which the crank,
 * deliberately, knows nothing about.
 */
export function useCrank(args: {
  connection: Connection | null;
  program: SolpokerProgram | null;
  table: PublicKey | null;
  config: PublicKey | null;
  session: Keypair | null;
  sessionToken: PublicKey | null;
  wallet: PublicKey | null;
  mySeat: number;
  enabled: boolean;
  captureReady: () => boolean;
  /** Called when the session key is refused, so the page can ask for a new one. */
  onSessionInvalid?: () => void;
}) {
  const crank = useRef<Crank | null>(null);
  const running = useRef(false);
  /** Highest hand number the base layer has recorded, from TableHistory. */
  const lastRecorded = useRef(0);

  const {
    connection,
    program,
    table,
    config,
    session,
    sessionToken,
    wallet,
    mySeat,
    enabled,
    captureReady,
  } = args;

  useEffect(() => {
    if (!enabled || !connection || !program || !table || !config || !session || !sessionToken || !wallet) {
      crank.current = null;
      return;
    }

    const ctx = {
      connection,
      program,
      table,
      config,
      session,
      sessionToken,
      wallet,
      mySeat,
      captureReady,
      onError: (e: unknown, stepName: string) => {
        // A dead session key fails every step forever, and the table simply
        // stops. Say so once and hand the session back so the authorise button
        // comes back, rather than repeating the same error until the player
        // gives up.
        if (SESSION_ERRORS.has(errorName(e) ?? "")) {
          toast(friendlyError(e), "bad");
          args.onSessionInvalid?.();
          return;
        }
        // A table in transit between the two layers refuses everything for a
        // few seconds. That is not a fault, it is a cash-out in progress —
        // possibly somebody else's, since every client cranks — and it used to
        // fill the screen with "commit: This table is part-way between Solana
        // and the game validator" for whoever happened to be watching.
        if (isWrongLayer(e)) {
          console.warn(`crank ${stepName} skipped mid-handover:`, e);
          return;
        }
        // Securing a chair retries on its own and usually succeeds within a few
        // seconds of somebody sitting down. Counted rather than announced: the
        // status line escalates on its own if the retries never take.
        if (stepName.startsWith("secure:")) {
          const seat = Number(stepName.split(":")[1]);
          if (Number.isInteger(seat)) useTableStore.getState().noteSecureFailure(seat);
          console.warn(`crank ${stepName} failed, will retry:`, e);
          return;
        }
        // Losing a race is silent. Anything that reaches here is worth saying.
        toast(`${stepName.split(":")[0]}: ${friendlyError(e)}`, "bad");
      },
    };

    if (crank.current) crank.current.update(ctx);
    else crank.current = new Crank(ctx);
  }, [enabled, connection, program, table, config, session, sessionToken, wallet, mySeat, captureReady]);

  // Track what the base layer has recorded, so the commit cadence has a floor
  // that survives reloads and is shared by every client.
  useEffect(() => {
    if (!enabled || !table) return;
    let cancelled = false;
    const read = async () => {
      try {
        const info = await getBaseConnection().getAccountInfo(historyPda(table));
        if (info && !cancelled) {
          lastRecorded.current = decodeHistory(new Uint8Array(info.data)).lastHandNumber;
        }
      } catch {
        // The next poll will try again.
      }
    };
    void read();
    const id = setInterval(() => void read(), HISTORY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, table]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(async () => {
      const c = crank.current;
      if (!c || running.current) return;
      running.current = true;
      try {
        const s = useTableStore.getState();
        const snap: CrankSnapshot = {
          table: s.table,
          hand: s.hand,
          seats: s.seats,
          myHoleHandNumber: s.myHoleHandNumber,
          leavingSeat: s.leavingSeat,
        };
        await c.tick(snap);
        await c.maybeCommit(snap, lastRecorded.current);
      } catch {
        // tick already routes real failures through onError.
      } finally {
        running.current = false;
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  return crank;
}
