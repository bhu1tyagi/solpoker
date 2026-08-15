"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getBaseConnection } from "@/lib/connection";
import { decodeConfig, decodeTable } from "@/lib/decode";
import { DELEGATION_PROGRAM, PROGRAM_ID } from "@/lib/constants";
import type { ConfigView, TableView } from "@/stores/table-store";

/** Anchor account discriminator for Table, from the IDL. */
const TABLE_DISCRIMINATOR = Uint8Array.from([34, 100, 138, 97, 236, 129, 230, 112]);

export interface LobbyTable {
  table: TableView;
  config: ConfigView | null;
  /** Delegated means a game is live on the rollup, so seats are locked. */
  delegated: boolean;
  seated: number;
}

/**
 * Every table on the program.
 *
 * A table's base-layer account is owned by the delegation program while a game
 * is running, which is exactly the signal the lobby needs: you can only take a
 * seat while the table is back on the base layer.
 */
export function useTables() {
  const [tables, setTables] = useState<LobbyTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const conn = getBaseConnection();
    try {
      setError(null);
      const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(TABLE_DISCRIMINATOR) } }],
      });

      // One unreadable account must not take the lobby down with it. Older
      // builds of the program left accounts with a different layout, and a
      // failed listing is indistinguishable from an empty one on screen.
      const decoded = accounts.flatMap((a) => {
        try {
          return [
            {
              table: decodeTable(new Uint8Array(a.account.data), a.pubkey.toBase58()),
              delegated: a.account.owner.equals(DELEGATION_PROGRAM),
            },
          ];
        } catch {
          return [];
        }
      });

      // Config never changes, so one batched read covers the whole lobby.
      const configs = decoded.length
        ? await conn.getMultipleAccountsInfo(decoded.map((d) => new PublicKey(d.table.config)))
        : [];

      setTables(
        decoded
          .map((d, i) => {
            let config: ConfigView | null = null;
            try {
              const info = configs[i];
              if (info) config = decodeConfig(new Uint8Array(info.data));
            } catch {
              // Show the table without its stakes rather than not at all.
            }
            return {
              table: d.table,
              delegated: d.delegated,
              config,
              seated: d.table.seats.filter(Boolean).length,
            };
          })
          .sort((a, b) => b.table.tableId - a.table.tableId),
      );
    } catch (e) {
      // Loud on purpose: a failed listing looked exactly like an empty lobby,
      // and a player who had just created a table concluded it was gone.
      console.error("table listing failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 12_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { tables, loading, error, refresh };
}

/**
 * A delegated table's base-layer copy is frozen, so reading it tells you what
 * the table looked like when play started, not what it looks like now.
 */
export function isJoinable(t: LobbyTable) {
  return !t.delegated && t.table.state === 0 && t.seated < 6;
}
