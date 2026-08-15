"use client";

import { useEffect, useRef } from "react";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Crank, type CrankSnapshot } from "@/lib/crank";
import type { SolpokerProgram } from "@/lib/anchor";
import { useTableStore } from "@/stores/table-store";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";

const TICK_MS = 500;

/**
 * Runs the table state machine while this page is open.
 *
 * Every seated client runs one. They step on each other harmlessly, and if all
 * of them close the tab the table simply pauses until someone opens it again.
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
}) {
  const crank = useRef<Crank | null>(null);
  const running = useRef(false);

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
        // Losing a race is silent. Anything that reaches here is worth saying.
        toast(`${stepName.split(":")[0]}: ${friendlyError(e)}`, "bad");
      },
    };

    if (crank.current) crank.current.update(ctx);
    else crank.current = new Crank(ctx);
  }, [enabled, connection, program, table, config, session, sessionToken, wallet, mySeat, captureReady]);

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
        };
        await c.tick(snap);
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
