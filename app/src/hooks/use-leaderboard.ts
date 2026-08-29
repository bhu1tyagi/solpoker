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

      // Rank only players who actually hold chips. A Player account can never
      // be closed — the program has no instruction for it, and `sell_chips`
      // only zeroes the balance — so every wallet that has ever bought in is
      // on chain permanently. Without this the board fills with accounts
      // holding nothing, including abandoned test wallets whose keys are gone.
      //
      // `handsPlayed` is not used to rescue them, because it is dead: the
      // program sets it to 0 in `init_player` and never increments it. It
      // stays in the sort as a tiebreaker so that ranking starts working on
      // its own if the program ever begins recording it.
      const ranked = decoded.filter((p) => p.chips > 0);
      ranked.sort((a, b) => b.chips - a.chips || b.handsPlayed - a.handsPlayed);
      setRows(ranked);
    } catch {
      // Leave the previous board up rather than blanking it on a failed read.
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * One scan to build the board, then the websocket keeps it honest.
   *
   * A Player account changes only on base-layer moves — buying chips, selling
   * them, sitting down, cashing out — so the stream is quiet and every event
   * is one row's worth of news. The full scan repeated every twenty seconds
   * was the second-biggest RPC spender after the lobby listing, and with a
   * room of concurrent viewers it multiplied; now it runs once a minute as a
   * reconcile for whatever a reconnect may have dropped.
   */
  useEffect(() => {
    const conn = getBaseConnection();
    const sub = conn.onProgramAccountChange(
      PROGRAM_ID,
      ({ accountInfo }) => {
        try {
          const p = decodePlayer(new Uint8Array(accountInfo.data));
          setRows((cur) => {
            const rest = cur.filter((r) => r.authority !== p.authority);
            // The zero-chip filter, applied live: a player selling out drops
            // off the board the moment the sale lands.
            if (p.chips > 0) {
              rest.push({ authority: p.authority, chips: p.chips, handsPlayed: p.handsPlayed });
            }
            rest.sort((a, b) => b.chips - a.chips || b.handsPlayed - a.handsPlayed);
            return rest;
          });
        } catch {
          // One unreadable account must not disturb the board.
        }
      },
      {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(PLAYER_DISCRIMINATOR) } }],
      },
    );
    return () => void conn.removeProgramAccountChangeListener(sub).catch(() => {});
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return { rows, loading, refresh };
}
