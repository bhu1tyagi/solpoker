"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { TopBar } from "@/components/chrome/TopBar";
import { TableFelt } from "@/components/poker/TableFelt";
import { ActionBar, type ActionKind } from "@/components/poker/ActionBar";
import { Button } from "@/components/primitives/Button";
import { Modal, Panel } from "@/components/primitives/Surface";
import { useTee } from "@/hooks/use-tee";
import { useTableSubscriptions } from "@/hooks/use-table-subscriptions";
import { useCrank } from "@/hooks/use-crank";
import { useHandCapture } from "@/hooks/use-hand-capture";
import { usePlayer } from "@/hooks/use-player";
import { useTableActions } from "@/hooks/use-table-actions";
import {
  potTotal,
  useTableStore,
  type HandView,
  type SeatView,
  type TableView,
} from "@/stores/table-store";
import { configPda, tablePda } from "@/lib/pdas";
import { getBaseConnection } from "@/lib/connection";
import { decodeConfig } from "@/lib/decode";
import { ensureSession } from "@/lib/session";
import { bestFive, describe, evaluate } from "@/lib/engine/evaluate";
import { NO_CARD } from "@/lib/engine/cards";
import { MAX_SEATS, NO_SEAT, SHUFFLE_FULFILLED, SHUFFLE_REQUESTED } from "@/lib/constants";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";
import { spring } from "@/styles/theme";
import { isDelegated } from "@/lib/instructions";

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tableId = useMemo(() => new BN(id), [id]);
  const table = useMemo(() => tablePda(tableId), [tableId]);
  const config = useMemo(() => configPda(tableId), [tableId]);

  const { publicKey, signTransaction, connected } = useWallet();
  const { connection: erConnection, program: erProgram } = useTee();
  const player = usePlayer();

  // Selectors, not the whole store. Subscribing to everything makes the store
  // object a new identity on every change, which re-fires the effects that
  // write back into it, which loops forever. Actions are stable by
  // construction, so they can be pulled out once.
  const tableView = useTableStore((s) => s.table);
  const hand = useTableStore((s) => s.hand);
  const seats = useTableStore((s) => s.seats);
  const myHole = useTableStore((s) => s.myHole);
  const myHoleHandNumber = useTableStore((s) => s.myHoleHandNumber);
  const link = useTableStore((s) => s.link);
  const tableConfig = useTableStore((s) => s.config);
  const setConfig = useTableStore((s) => s.setConfig);
  const setMySeat = useTableStore((s) => s.setMySeat);
  const setPending = useTableStore((s) => s.setPending);

  const [session, setSession] = useState<Keypair | null>(null);
  const [sessionToken, setSessionToken] = useState<PublicKey | null>(null);
  const [sitting, setSitting] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const [acting, setActing] = useState(false);

  const me = publicKey?.toBase58() ?? null;
  const mySeat = useMemo(
    () => seats.findIndex((s) => s?.occupant && s.occupant === me),
    [seats, me],
  );

  // Config never changes, so read it once.
  useEffect(() => {
    void (async () => {
      const info = await getBaseConnection().getAccountInfo(config);
      if (info) setConfig(decodeConfig(new Uint8Array(info.data)));
    })();
  }, [config, setConfig]);

  useEffect(() => {
    setMySeat(mySeat);
  }, [mySeat, setMySeat]);

  // Delegation decides whether this is a lobby view or a live game.
  const refreshDelegation = useCallback(async () => {
    setDelegated(await isDelegated(getBaseConnection(), table));
  }, [table]);

  useEffect(() => {
    void refreshDelegation();
    const t = setInterval(() => void refreshDelegation(), 6000);
    return () => clearInterval(t);
  }, [refreshDelegation]);

  const capture = useHandCapture(tableView?.tableId ?? null);

  useTableSubscriptions(delegated ? erConnection : null, table, mySeat);

  const actions = useTableActions({
    erConnection,
    erProgram,
    table,
    config,
    tableId,
    session,
    sessionToken,
  });

  useCrank({
    connection: erConnection,
    program: erProgram,
    table,
    config,
    session,
    sessionToken,
    wallet: publicKey ?? null,
    mySeat,
    enabled: Boolean(delegated && session && sessionToken && erProgram && mySeat >= 0),
    captureReady: capture.ready,
  });

  /** One prompt, then the table is silent for a day. */
  const authorise = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    try {
      const s = await ensureSession(getBaseConnection(), publicKey, signTransaction);
      setSession(s.keypair);
      setSessionToken(s.tokenPda);
      toast("Session key authorised. No more prompts while you play.", "good");
    } catch (e) {
      toast(friendlyError(e), "bad");
    }
  }, [publicKey, signTransaction]);

  const pot = potTotal(seats);
  const seatedCount = seats.filter((s) => s?.occupant).length;
  const occupiedSeats = useMemo(
    () => seats.map((s, i) => (s?.occupant ? i : -1)).filter((i) => i >= 0),
    [seats],
  );

  // Showdown highlighting: work out the winning five from what was shown.
  const { winningCards, winnerSeats, myHandName } = useShowdown(
    hand,
    seats,
    mySeat,
    myHole,
    myHoleHandNumber,
  );

  const onAct = useCallback(
    async (kind: ActionKind, toTotal: number) => {
      if (!hand) return;
      setActing(true);
      // Show the result immediately. The chain confirms it about a third of a
      // second later, inside the chip animation.
      setPending({
        seat: mySeat,
        kind,
        toTotal,
        handNumber: hand.handNumber,
        sentAt: Date.now(),
      });
      try {
        await actions.act(kind, toTotal);
      } catch (e) {
        toast(friendlyError(e), "bad");
      } finally {
        setPending(null);
        setActing(false);
      }
    },
    [actions, hand, mySeat, setPending],
  );

  const status = useStatusLine(delegated, tableView, hand, seatedCount);

  return (
    <>
      <TopBar chips={player.state?.chips} />

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "20px 20px 40px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h1 style={{ fontSize: "var(--t-md)" }}>
              {tableConfig
                ? `${tableConfig.smallBlind} / ${tableConfig.bigBlind}`
                : "Table"}
            </h1>
            <span style={{ fontSize: "var(--t-xs)", color: "var(--text-faint)" }}>
              table {id} · hand {tableView?.handNumber ?? 0}
            </span>
            <LinkPill state={link} delegated={delegated} />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link href={`/history/${id}`} style={{ textDecoration: "none" }}>
              <Button variant="quiet" size="sm">
                Hand history
              </Button>
            </Link>
            {connected && !session && (
              <Button variant="primary" size="sm" onClick={authorise}>
                Authorise session key
              </Button>
            )}
            {session && delegated === false && seatedCount >= 2 && (
              <Button
                variant="primary"
                size="sm"
                loading={actions.busy?.startsWith("start")}
                onClick={() => actions.startTable(occupiedSeats)}
              >
                Start playing
              </Button>
            )}
            {session && delegated && tableView?.state === 0 && (
              <Button
                variant="ghost"
                size="sm"
                loading={actions.busy === "pause"}
                onClick={actions.pauseTable}
              >
                Pause table
              </Button>
            )}
            {delegated === false && mySeat >= 0 && (
              <Button
                variant="ghost"
                size="sm"
                loading={actions.busy === "leave"}
                onClick={async () => {
                  await actions.leave(mySeat);
                  await player.refresh();
                }}
              >
                Cash out
              </Button>
            )}
          </div>
        </div>

        <TableFelt
          table={tableView}
          hand={hand}
          seats={seats}
          mySeat={mySeat}
          myHole={myHole}
          myHoleHandNumber={myHoleHandNumber}
          pot={pot}
          winning={winningCards}
          winners={winnerSeats}
          timeoutSecs={tableConfig?.actionTimeoutSecs ?? 30}
          status={status}
          onSit={
            delegated === false && mySeat < 0 && connected
              ? (i) => {
                  setSitting(i);
                  setBuyIn(tableConfig?.maxBuyIn ?? 2000);
                }
              : undefined
          }
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            marginTop: 18,
            minHeight: 96,
          }}
        >
          <AnimatePresence>
            {myHandName && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring.snappy}
                style={{
                  fontSize: "var(--t-sm)",
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-display)",
                }}
              >
                you have {myHandName}
              </motion.div>
            )}
          </AnimatePresence>

          {mySeat >= 0 && session && (
            <ActionBar
              hand={hand}
              seat={seats[mySeat]}
              seatIndex={mySeat}
              pot={pot}
              busy={acting}
              onAct={onAct}
            />
          )}

          {connected && mySeat < 0 && delegated && (
            <Panel style={{ textAlign: "center", maxWidth: 460 }}>
              <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "var(--t-sm)" }}>
                This table is playing. Seats open again when it pauses between
                hands.
              </p>
            </Panel>
          )}

          {connected && mySeat >= 0 && !session && (
            <Panel style={{ textAlign: "center", maxWidth: 460 }}>
              <p style={{ margin: "0 0 10px", color: "var(--text-dim)", fontSize: "var(--t-sm)" }}>
                Authorise a session key to play without a wallet prompt on every
                action. It can bet for you at this table and nothing else.
              </p>
              <Button variant="primary" size="sm" onClick={authorise}>
                Authorise
              </Button>
            </Panel>
          )}
        </div>
      </main>

      <Modal
        open={sitting !== null}
        onClose={() => setSitting(null)}
        title={`Take seat ${(sitting ?? 0) + 1}`}
      >
        <p style={{ color: "var(--text-dim)", fontSize: "var(--t-sm)", marginTop: 0 }}>
          Chips move from your balance to the seat. You get them back when you
          cash out.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <input
            type="range"
            min={tableConfig?.minBuyIn ?? 200}
            max={Math.min(tableConfig?.maxBuyIn ?? 2000, player.state?.chips ?? 0)}
            step={10}
            value={buyIn}
            onChange={(e) => setBuyIn(Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--accent)" }}
          />
          <span
            className="tnum"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--t-md)",
              color: "var(--accent)",
              minWidth: 80,
              textAlign: "right",
            }}
          >
            {buyIn.toLocaleString()}
          </span>
        </div>
        <Button
          variant="primary"
          loading={actions.busy === "join"}
          onClick={async () => {
            if (sitting === null) return;
            await actions.join(sitting, buyIn);
            setSitting(null);
            await player.refresh();
          }}
        >
          Sit down
        </Button>
      </Modal>
    </>
  );
}

/** A short line explaining what the table is waiting for. */
function useStatusLine(
  delegated: boolean | null,
  table: TableView | null,
  hand: HandView | null,
  seated: number,
): string | undefined {
  if (delegated === null) return "loading";
  if (!delegated) {
    if (seated < 2) return "waiting for players";
    return "ready to start";
  }
  if (!hand || !table) return "connecting";
  if (table.state === 1) return undefined;
  if (hand.shuffleState === SHUFFLE_REQUESTED) return "drawing randomness";
  if (hand.shuffleState === SHUFFLE_FULFILLED) return "dealing";
  return "shuffling";
}

function LinkPill({ state, delegated }: { state: string; delegated: boolean | null }) {
  const tone =
    state === "live" ? "var(--win)" : state === "degraded" ? "var(--accent)" : "var(--text-faint)";
  const label = !delegated ? "on Solana" : state === "live" ? "live" : state;
  return (
    <span
      style={{
        fontSize: "var(--t-xs)",
        color: tone,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: tone,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

/**
 * Work out what to highlight at showdown.
 *
 * Only hands that were actually shown are known, which is the point: a pot won
 * on a fold reveals nothing, so there is nothing to highlight.
 */
function useShowdown(
  hand: HandView | null,
  seats: (SeatView | null)[],
  mySeat: number,
  myHole: number[] | null,
  myHoleHandNumber: number,
) {
  return useMemo(() => {
    const empty = {
      winningCards: undefined as Set<number> | undefined,
      winnerSeats: undefined as Set<number> | undefined,
      myHandName: undefined as string | undefined,
    };
    if (!hand) return empty;

    const board = hand.board.filter((c) => c !== NO_CARD);

    // Your own hand, named, as soon as there is enough board to name it.
    let myHandName: string | undefined;
    if (
      mySeat >= 0 &&
      myHole &&
      myHoleHandNumber === hand.handNumber &&
      myHole[0] !== NO_CARD &&
      board.length >= 3
    ) {
      myHandName = describe(evaluate([...myHole, ...board]));
    }

    if (hand.revealedMask === 0 || board.length < 5) {
      return { ...empty, myHandName };
    }

    // Rank everyone who showed, and highlight the best five.
    let best = -1;
    let bestSeats: number[] = [];
    const fives = new Map<number, number[]>();
    for (let i = 0; i < MAX_SEATS; i++) {
      if (!(hand.revealedMask & (1 << i))) continue;
      const hole = hand.revealed[i];
      if (hole[0] === NO_CARD) continue;
      const { five, rank } = bestFive([...hole, ...board]);
      fives.set(i, five);
      if (rank > best) {
        best = rank;
        bestSeats = [i];
      } else if (rank === best) {
        bestSeats.push(i);
      }
    }
    if (bestSeats.length === 0) return { ...empty, myHandName };

    const winningCards = new Set<number>();
    for (const s of bestSeats) for (const c of fives.get(s) ?? []) winningCards.add(c);

    return {
      winningCards,
      winnerSeats: new Set(bestSeats),
      myHandName,
    };
  }, [hand, seats, mySeat, myHole, myHoleHandNumber]);
}
