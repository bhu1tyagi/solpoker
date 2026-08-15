"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
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

const bs58encode = (b: Uint8Array) => {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits: number[] = [];
  for (const byte of b) {
    let carry = byte;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return digits.reverse().map((d) => ALPHABET[d]).join("");
};

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
        filters: [{ memcmp: { offset: 0, bytes: bs58encode(TABLE_DISCRIMINATOR) } }],
      });

      const decoded = accounts.map((a) => ({
        table: decodeTable(new Uint8Array(a.account.data), a.pubkey.toBase58()),
        delegated: a.account.owner.equals(DELEGATION_PROGRAM),
      }));

      // Config never changes, so one batched read covers the whole lobby.
      const configs = await conn.getMultipleAccountsInfo(
        decoded.map((d) => new PublicKey(d.table.config)),
      );

      setTables(
        decoded
          .map((d, i) => ({
            table: d.table,
            delegated: d.delegated,
            config: configs[i] ? decodeConfig(new Uint8Array(configs[i]!.data)) : null,
            seated: d.table.seats.filter(Boolean).length,
          }))
          .sort((a, b) => b.table.tableId - a.table.tableId),
      );
    } catch (e) {
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
