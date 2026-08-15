"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection } from "@solana/web3.js";
import { makeErConnection } from "@/lib/connection";
import { getAuthToken } from "@/lib/tee-auth";
import { makeProgram, type SolpokerProgram } from "@/lib/anchor";
import { useTableStore } from "@/stores/table-store";
import { toast } from "@/stores/ui-store";

/**
 * An authenticated connection to the rollup.
 *
 * The token is what makes the connection yours: it decides which accounts the
 * validator will serve you. Your hole cards come back over this one and over
 * nobody else's, so every player needs their own.
 *
 * Reconnecting is expected rather than exceptional. A long session on a public
 * endpoint loses its socket eventually, so this exposes a reconnect that
 * rebuilds both the connection and the program handle.
 */
export function useTee() {
  const { publicKey, signMessage, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [program, setProgram] = useState<SolpokerProgram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setLink = useTableStore((s) => s.setLink);
  const bumpEpoch = useTableStore((s) => s.bumpEpoch);
  const busy = useRef(false);

  const connect = useCallback(
    async (force = false) => {
      if (!publicKey || !signMessage || busy.current) return;
      busy.current = true;
      setLink("connecting");
      try {
        const token = await getAuthToken(publicKey, signMessage, { force });
        const conn = makeErConnection(token);
        setConnection(conn);
        setProgram(makeProgram(conn));
        setError(null);
        setLink("live");
        bumpEpoch();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setLink("offline");
      } finally {
        busy.current = false;
      }
    },
    [publicKey, signMessage, setLink, bumpEpoch],
  );

  useEffect(() => {
    if (connected && publicKey && !connection) void connect();
    if (!connected) {
      setConnection(null);
      setProgram(null);
      setLink("offline");
    }
  }, [connected, publicKey, connection, connect, setLink]);

  /** Rebuild after a dropped socket. Reuses the cached token. */
  const reconnect = useCallback(async () => {
    setLink("degraded");
    await connect(false);
  }, [connect, setLink]);

  useEffect(() => {
    if (error) toast(`Could not reach the game validator. ${error}`, "bad");
  }, [error]);

  return { connection, program, connect, reconnect, error };
}
