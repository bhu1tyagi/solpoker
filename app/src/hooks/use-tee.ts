"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import { makeErConnection } from "@/lib/connection";
import { clearAuthToken, getAuthToken } from "@/lib/tee-auth";
import { clearSession } from "@/lib/session";
import { makeProgram, type SolpokerProgram } from "@/lib/anchor";
import { useTableStore } from "@/stores/table-store";
import { toast } from "@/stores/ui-store";

/**
 * An authenticated connection to the rollup.
 *
 * The token is what makes the connection yours: it decides which accounts the
 * validator will serve you. Your hole cards come back over this one and over
 * nobody else's, so every player needs their own, and the connection must be
 * rebuilt if the user switches wallets, or it would keep the old identity and
 * quietly stop being able to read the new player's cards.
 *
 * Reconnecting is expected rather than exceptional. A long session on a public
 * endpoint loses its socket eventually, and a user can dismiss the signature
 * request that mints the token, so this never treats a failed connect as
 * final.
 */
export function useTee() {
  const { publicKey, signMessage, connected } = useWallet();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [program, setProgram] = useState<SolpokerProgram | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setLink = useTableStore((s) => s.setLink);
  const bumpEpoch = useTableStore((s) => s.bumpEpoch);
  const busy = useRef(false);
  /** Whose token the current connection carries. */
  const identity = useRef<string | null>(null);

  const connect = useCallback(
    async (force = false) => {
      if (!publicKey || !signMessage || busy.current) return;
      busy.current = true;
      setLink("connecting");
      try {
        const token = await getAuthToken(publicKey, signMessage, { force });
        const conn = makeErConnection(token);
        identity.current = publicKey.toBase58();
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
    if (!connected || !publicKey) {
      // Disconnecting has to take the credentials with it. Both of these are
      // bearer credentials in `localStorage`: the token reads hole cards and
      // the session key signs bets. Leaving them behind meant "log out" cleared
      // the UI and nothing else, so the next person at that browser — or any
      // script on the origin — still held a working pair. Whoever was signed in
      // last is the only identity we can clear, which is why it is tracked.
      const last = identity.current;
      if (last) {
        try {
          const key = new PublicKey(last);
          clearAuthToken(key);
          clearSession(key);
        } catch {
          // Not a key we can parse; nothing to clear.
        }
      }
      identity.current = null;
      setConnection(null);
      setProgram(null);
      setLink("offline");
      return;
    }
    // No connection yet, or a connection minted for a different wallet.
    if (!connection || identity.current !== publicKey.toBase58()) {
      void connect();
    }
  }, [connected, publicKey, connection, connect, setLink]);

  /** Rebuild after a dropped socket. Reuses the cached token. */
  const reconnect = useCallback(async () => {
    setLink("degraded");
    await connect(false);
  }, [connect, setLink]);

  useEffect(() => {
    if (error) {
      toast(
        "Could not reach the game validator. Approve the signature request and press retry.",
        "bad",
      );
    }
  }, [error]);

  return { connection, program, connect, reconnect, error };
}
