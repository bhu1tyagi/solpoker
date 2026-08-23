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

    // Updates arrive from two directions at once: websocket pushes and the
    // batched poll. Without an ordering rule, a poll that was issued before an
    // action but answered after its push overwrites new state with old — a
    // stack un-pays a bet, a folded player un-folds, the turn jumps backwards.
    // Every write carries the slot it was read at and older slots are dropped.
    // The map lives inside this effect on purpose: the base layer and the
    // rollup count slots on unrelated clocks, so a connection switch must
    // start the comparison over.
    const lastSlot = new Map<string, number>();
    const fresh = (k: string, slot: number) => {
      if (slot < (lastSlot.get(k) ?? 0)) return false;
      lastSlot.set(k, slot);
      return true;
    };

    const applyHand = (data: Buffer) => store.getState().setHand(decodeHand(new Uint8Array(data)));
    const applyTable = (data: Buffer) =>
      store.getState().setTable(decodeTable(new Uint8Array(data), table.toBase58()));
    const applySeat = (i: number, data: Buffer) =>
      store.getState().setSeat(i, decodeSeat(new Uint8Array(data)));

    /** One batched read of everything public. Also the initial load. */
    const readAll = async () => {
      try {
        const resp = await connection.getMultipleAccountsInfoAndContext(
          [table, hand, ...seats],
          "processed",
        );
        if (cancelled) return;
        const slot = resp.context.slot;
        const infos = resp.value;
        if (infos[0] && fresh("table", slot)) applyTable(infos[0].data);
        if (infos[1] && fresh("hand", slot)) applyHand(infos[1].data);
        for (let i = 0; i < MAX_SEATS; i++) {
          const info = infos[2 + i];
          if (info && fresh(`seat:${i}`, slot)) applySeat(i, info.data);
        }
      } catch {
        // The watchdog will try again shortly.
      }
    };

    void readAll();

    try {
      subs.current.push(
        connection.onAccountChange(
          hand,
          (info, ctx) => {
            if (fresh("hand", ctx.slot)) applyHand(info.data);
          },
          "processed",
        ),
        connection.onAccountChange(
          table,
          (info, ctx) => {
            if (fresh("table", ctx.slot)) applyTable(info.data);
          },
          "processed",
        ),
        ...seats.map((seat, i) =>
          connection.onAccountChange(
            seat,
            (info, ctx) => {
              if (fresh(`seat:${i}`, ctx.slot)) applySeat(i, info.data);
            },
            "processed",
          ),
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
      // Clear the cards only when they are genuinely not yours to hold — you
      // stood up, or left the table. A reconnecting socket also passes through
      // here with a null connection, and wiping then blanks your own hand
      // mid-play for the length of the flap; the cards are still valid for
      // the hand number they carry, and the render layer already checks that.
      if (!table || mySeat < 0) store.getState().setMyHole(null, 0);
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

    // Chase the current hand until our cards are for it, backing off as we go.
    //
    // The hole account is permission-gated, so its change notifications are not
    // reliable and this poll is the fallback that makes your own cards appear.
    // But a denied read looks exactly like a slow one, and a seat that is not
    // in the hand at all — sitting out because its permission could not be
    // pointed at it — never catches up. A flat 900ms retry then hammers the
    // enclave for the whole hand, on every such client, forever.
    //
    // Backing off keeps the fast path fast (the first few tries are what
    // actually deliver your cards) and turns the hopeless case into a trickle
    // rather than a flood. The delay resets whenever the hand number moves, so
    // the next hand starts responsive again.
    let delay = 300;
    let chasing = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const s = store.getState();
      const handNumber = s.hand?.handNumber ?? 0;
      // Hand number 0 does not mean "no hand" here — it also means "this
      // client has not heard about the hand yet", which is exactly when the
      // chase must keep running. On the first hand after delegation the hand
      // account can arrive seconds late, and a chase that trusted the stale 0
      // sat idle while the player stared at the backs of their own cards.
      const caughtUp = handNumber !== 0 && s.myHoleHandNumber === handNumber;

      if (handNumber !== chasing) {
        // A new hand: start eager again.
        chasing = handNumber;
        delay = 300;
      }
      if (!caughtUp) {
        void read();
        delay = Math.min(delay * 1.6, 8_000);
      } else {
        delay = 900;
      }
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (subId !== null) {
        void holeConnection.removeAccountChangeListener(subId).catch(() => {});
      }
    };
  }, [holeConnection, table, mySeat, store]);
}
