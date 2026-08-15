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
 * Websocket subscriptions on the hand and all six seats cover every change a
 * betting action makes, since each action rewrites all of them. Polling is the
 * fallback for when the socket goes quiet, not the primary path: at four
 * hundred milliseconds a round trip, polling fast enough to feel live would
 * mean hammering the validator.
 *
 * The deck is never read. It is unreadable by design, and asking for it would
 * only produce a stream of denials.
 */

const POLL_MS = 1000;
const STALE_MS = 4000;

export function useTableSubscriptions(
  connection: Connection | null,
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
      const handLive = t?.state === 1;
      if (Date.now() - lastUpdate > (handLive ? STALE_MS : STALE_MS * 3)) {
        void readAll();
      }
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

  // Your own cards, over your own connection. Nobody else's read works.
  useEffect(() => {
    if (!connection || !table || mySeat < 0) {
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
        const info = await connection.getAccountInfo(hole, "processed");
        if (cancelled) return;
        // A denied read is null, which means hidden, not missing.
        if (info) apply(info.data);
      } catch {
        // Ignore, the subscription or the next hand will catch up.
      }
    };

    void read();
    try {
      subId = connection.onAccountChange(hole, (info) => apply(info.data), "processed");
    } catch {
      // Falls back to the read above plus the next hand's read.
    }

    return () => {
      cancelled = true;
      if (subId !== null) {
        void connection.removeAccountChangeListener(subId).catch(() => {});
      }
    };
  }, [connection, table, mySeat, store]);
}
