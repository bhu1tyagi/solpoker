"use client";

import { useEffect, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeHand, decodeHole, decodeSeat, decodeTable } from "@/lib/decode";
import { holePda, seatPda, handPda } from "@/lib/pdas";
import { MAX_SEATS } from "@/lib/constants";
import { useTableStore } from "@/stores/table-store";

/**
 * Keeping the table in sync.
 *
 * Which endpoint is the truth depends on where the table lives. Before a game
 * starts the accounts sit on the base layer, and that is where seats fill up,
 * so that is what must be read: rendering only the rollup's view left a fresh
 * table looking empty to the very player who had just sat down at it. Once
 * delegated, the base copies freeze and the rollup takes over, so the caller
 * passes whichever connection is authoritative right now.
 *
 * Websocket subscriptions on the hand and all six seats cover every change a
 * betting action makes, since each action rewrites all of them. Polling is the
 * fallback for a quiet socket, not the primary path.
 *
 * The deck is never read. It is unreadable by design, and asking for it would
 * only produce a stream of denials.
 */

const POLL_MS = 1000;
/** How long the socket may go quiet before polling steps in. */
const STALE_LIVE_MS = 4000;
const STALE_IDLE_MS = 6000;

export function useTableSubscriptions(
  /** Whichever endpoint owns the accounts right now: base until delegation, then the rollup. */
  connection: Connection | null,
  /**
   * The player's own authenticated rollup connection, the only one that can
   * read their hole cards. Null when there is no live game to read them from.
   */
  holeConnection: Connection | null,
  table: PublicKey | null,
  mySeat: number,
) {
  const store = useTableStore;
  const subs = useRef<number[]>([]);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!connection || !table) return;

    const hand = handPda(table);
    const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
    let cancelled = false;

    const applyHand = (data: Buffer) => store.getState().setHand(decodeHand(new Uint8Array(data)));
    const applyTable = (data: Buffer) =>
      store.getState().setTable(decodeTable(new Uint8Array(data), table.toBase58()));
    const applySeat = (i: number, data: Buffer) =>
      store.getState().setSeat(i, decodeSeat(new Uint8Array(data)));

    /** One batched read of everything public. Also the initial load. */
    const readAll = async () => {
      try {
        const infos = await connection.getMultipleAccountsInfo(
          [table, hand, ...seats],
          "processed",
        );
        if (cancelled) return;
        if (infos[0]) applyTable(infos[0].data);
        if (infos[1]) applyHand(infos[1].data);
        for (let i = 0; i < MAX_SEATS; i++) {
          const info = infos[2 + i];
          if (info) applySeat(i, info.data);
        }
      } catch {
        // The watchdog will try again shortly.
      }
    };

    void readAll();

    try {
      subs.current.push(
        connection.onAccountChange(hand, (info) => applyHand(info.data), "processed"),
        connection.onAccountChange(table, (info) => applyTable(info.data), "processed"),
        ...seats.map((seat, i) =>
          connection.onAccountChange(seat, (info) => applySeat(i, info.data), "processed"),
        ),
      );
    } catch {
      // No websocket means polling carries the table on its own.
      store.getState().setLink("degraded");
    }

    // Watchdog. Only polls when the socket has gone quiet.
    poller.current = setInterval(() => {
      const { lastUpdate, table: t } = store.getState();
      const staleAfter = t?.state === 1 ? STALE_LIVE_MS : STALE_IDLE_MS;
      if (Date.now() - lastUpdate > staleAfter) void readAll();
    }, POLL_MS);

    return () => {
      cancelled = true;
      for (const id of subs.current) {
        void connection.removeAccountChangeListener(id).catch(() => {});
      }
      subs.current = [];
      if (poller.current) clearInterval(poller.current);
    };
  }, [connection, table, store]);

  // Your own cards, over your own authenticated connection. Nobody else's works.
  //
  // This one polls as well as subscribing, and the polling is not a nicety.
  // The account is permission gated, so a change notification for it is not
  // something to count on, and if the update never arrives the player sits
  // there looking at the backs of their own cards for the whole hand.
  useEffect(() => {
    if (!holeConnection || !table || mySeat < 0) {
      store.getState().setMyHole(null, 0);
      return;
    }

    const hole = holePda(table, mySeat);
    let cancelled = false;
    let subId: number | null = null;

    const apply = (data: Buffer) => {
      const h = decodeHole(new Uint8Array(data));
      store.getState().setMyHole(h.cards, h.handNumber);
    };

    const read = async () => {
      try {
        const info = await holeConnection.getAccountInfo(hole, "processed");
        if (cancelled) return;
        // A denied read is null, which means hidden, not missing.
        if (info) apply(info.data);
      } catch {
        // Ignore, the next poll will catch up.
      }
    };

    void read();
    try {
      subId = holeConnection.onAccountChange(hole, (info) => apply(info.data), "processed");
    } catch {
      // Polling below carries it.
    }

    // Chase the current hand until our cards are for it.
    const poller = setInterval(() => {
      const s = store.getState();
      const handNumber = s.hand?.handNumber ?? 0;
      if (handNumber > 0 && s.myHoleHandNumber !== handNumber) void read();
    }, 900);

    return () => {
      cancelled = true;
      clearInterval(poller);
      if (subId !== null) {
        void holeConnection.removeAccountChangeListener(subId).catch(() => {});
      }
    };
  }, [holeConnection, table, mySeat, store]);
}
