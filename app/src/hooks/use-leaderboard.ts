"use client";

import { useCallback, useEffect, useState } from "react";
import bs58 from "bs58";
import { getBaseConnection } from "@/lib/connection";
import { decodePlayer } from "@/lib/decode";
import { PROGRAM_ID } from "@/lib/constants";

/**
 * The leaderboard, read straight off the chain.
 *
 * Every player has one account holding their chip balance and how many hands
 * they have played, so the ranking needs no server and no extra state: it is
 * whatever the program already stores, sorted. Chips sitting on a seat are not
 * counted, because they are on the seat rather than in the balance, which is
 * also why a player deep in a game can rank lower than their table presence
 * suggests.
 */

/** Anchor account discriminator for Player, from the IDL. */
const PLAYER_DISCRIMINATOR = Uint8Array.from([205, 222, 112, 7, 165, 155, 206, 218]);

export interface LeaderRow {
  authority: string;
  chips: number;
  handsPlayed: number;
}

export function useLeaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const conn = getBaseConnection();
      const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(PLAYER_DISCRIMINATOR) } }],
      });

      const decoded = accounts.flatMap((a) => {
        try {
          const p = decodePlayer(new Uint8Array(a.account.data));
          return [{ authority: p.authority, chips: p.chips, handsPlayed: p.handsPlayed }];
        } catch {
          // One unreadable account must not empty the whole board.
          return [];
        }
      });

      decoded.sort((a, b) => b.chips - a.chips || b.handsPlayed - a.handsPlayed);
      setRows(decoded);
    } catch {
      // Leave the previous board up rather than blanking it on a failed read.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { rows, loading, refresh };
}
