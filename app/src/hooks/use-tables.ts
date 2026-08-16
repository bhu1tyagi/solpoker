"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getBaseConnection } from "@/lib/connection";
import { decodeConfig, decodeTable } from "@/lib/decode";
import {
  ABANDONED_AFTER_SECS,
  DECK_ACCOUNT_SIZE,
  DELEGATION_PROGRAM,
  PROGRAM_ID,
} from "@/lib/constants";
import { deckPda } from "@/lib/pdas";
import type { ConfigView, TableView } from "@/stores/table-store";

/** Anchor account discriminator for Table, from the IDL. */
const TABLE_DISCRIMINATOR = Uint8Array.from([34, 100, 138, 97, 236, 129, 230, 112]);

/**
 * Tables this browser deleted. The chain forgets them the moment the close
 * lands, but an RPC node can echo the dead account for a while afterwards, and
 * a table you just deleted reappearing in the lobby reads as a failed delete.
 */
const TOMBSTONE_KEY = "solpoker:deleted-tables";
const TOMBSTONE_TTL_MS = 30 * 60 * 1000;

export function tombstoneTable(tableId: number | string) {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? "{}") as Record<
      string,
      number
    >;
    raw[String(tableId)] = Date.now();
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(raw));
  } catch {
    // Storage being unavailable only costs the cosmetic filter.
  }
}

function tombstonedIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? "{}") as Record<
      string,
      number
    >;
    const now = Date.now();
    return new Set(
      Object.entries(raw)
        .filter(([, ts]) => now - Number(ts) < TOMBSTONE_TTL_MS)
        .map(([id]) => id),
    );
  } catch {
    return new Set();
  }
}

export interface LobbyTable {
  table: TableView;
  config: ConfigView | null;
  /** Delegated means a game is live on the rollup, so seats are locked. */
  delegated: boolean;
  seated: number;
  /**
   * Created by an older build, so its deck no longer fits the program. Such a
   * table can be paused and cashed out but never played.
   */
  outdated: boolean;
  /** Empty long enough that anyone may sweep it away. */
  abandoned: boolean;
}

/**
 * Every table on the program, including the ones currently playing.
 *
 * The subtlety that once made live tables vanish: while a game runs, the
 * table's base-layer account is owned by the delegation program, not by ours.
 * A query for our program's accounts therefore returns only idle tables, and a
 * player who stepped away from a live one found a lobby that said it did not
 * exist. So this asks both owners.
 *
 * The delegation program hosts frozen accounts from every app on the network,
 * and Anchor discriminators are just a hash of the struct name, so another
 * app's "Table" matches ours byte for byte. Each candidate is verified by
 * re-deriving its address from its own table id; an impostor cannot sit at our
 * program's address.
 */
export function useTables() {
  const [tables, setTables] = useState<LobbyTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reload the list.
   *
   * `showLoading` is for a refresh the player asked for by hand: the list goes
   * back to skeletons so the press visibly did something. The background poll
   * leaves it alone, because flashing the whole lobby every few seconds on its
   * own schedule is worse than showing nothing.
   */
  const refresh = useCallback(async (showLoading = false) => {
    const conn = getBaseConnection();
    if (showLoading) setLoading(true);
    try {
      setError(null);
      const filters = [{ memcmp: { offset: 0, bytes: bs58.encode(TABLE_DISCRIMINATOR) } }];
      const [ownAccounts, delegatedAccounts] = await Promise.all([
        conn.getProgramAccounts(PROGRAM_ID, { filters }),
        conn.getProgramAccounts(DELEGATION_PROGRAM, { filters }),
      ]);
      const enc = new TextEncoder();
      const accounts = [...ownAccounts, ...delegatedAccounts].filter((a) => {
        const d = a.account.data;
        if (d.length < 16) return false;
        const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
        const idBytes = new Uint8Array(8);
        new DataView(idBytes.buffer).setBigUint64(0, view.getBigUint64(8, true), true);
        const [expected] = PublicKey.findProgramAddressSync(
          [enc.encode("table"), idBytes],
          PROGRAM_ID,
        );
        return expected.equals(a.pubkey);
      });

      // One unreadable account must not take the lobby down with it. Older
      // builds of the program left accounts with a different layout, and a
      // failed listing is indistinguishable from an empty one on screen.
      const dead = tombstonedIds();
      const decoded = accounts.flatMap((a) => {
        try {
          const table = decodeTable(new Uint8Array(a.account.data), a.pubkey.toBase58());
          if (dead.has(String(table.tableId))) return [];
          return [
            {
              table,
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

      // A deck from an older layout cannot be dealt from, so say so here
      // rather than letting someone sit down and hit a deserialization error
      // the moment they press start.
      const decks = decoded.length
        ? await conn.getMultipleAccountsInfo(
            decoded.map((d) => deckPda(new PublicKey(d.table.address))),
          )
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
            const deck = decks[i];
            const seated = d.table.seats.filter(Boolean).length;
            const emptyFor = d.table.emptySince
              ? Math.floor(Date.now() / 1000) - d.table.emptySince
              : 0;
            return {
              table: d.table,
              delegated: d.delegated,
              config,
              seated,
              outdated: !deck || deck.data.length < DECK_ACCOUNT_SIZE,
              abandoned:
                !d.delegated && seated === 0 && emptyFor >= ABANDONED_AFTER_SECS,
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
  return !t.outdated && !t.delegated && t.table.state === 0 && t.seated < 6;
}

/** Tables that have sat empty long enough for anyone to clear away. */
export const abandonedTables = (tables: LobbyTable[]) => tables.filter((t) => t.abandoned);
