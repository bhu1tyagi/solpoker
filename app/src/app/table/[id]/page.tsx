"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { configPda, deckPda, tablePda } from "@/lib/pdas";
import { getBaseConnection } from "@/lib/connection";
import { decodeConfig } from "@/lib/decode";
import { ensureSession, loadSession } from "@/lib/session";
import { bestFive, describe, evaluate } from "@/lib/engine/evaluate";
import { NO_CARD } from "@/lib/engine/cards";
import {
  DECK_ACCOUNT_SIZE,
  MAX_SEATS,
  NO_SEAT,
  SHUFFLE_REQUESTED,
} from "@/lib/constants";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";
import { spring } from "@/styles/theme";
import { isDelegated } from "@/lib/instructions";
import { applyPending, applyPendingHand, pendingApplies } from "@/lib/optimistic";

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tableId = useMemo(() => new BN(id), [id]);
  const table = useMemo(() => tablePda(tableId), [tableId]);
  const config = useMemo(() => configPda(tableId), [tableId]);

  const router = useRouter();
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection: erConnection, program: erProgram, connect: connectTee } = useTee();
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

  // A valid session may already be sitting in storage from an earlier visit.
  // Restore it silently, so a reload does not demand re-authorising a key that
  // never expired.
  useEffect(() => {
    if (!publicKey) {
      setSession(null);
      setSessionToken(null);
      return;
    }
    // Clear first. Switching wallets must not leave the previous wallet's
    // session key in place, or the Authorise button never comes back and every
    // action is signed for the wrong player.
    setSession(null);
    setSessionToken(null);
    const stored = loadSession(publicKey);
    if (!stored) return;
    setSession(stored.keypair);
    setSessionToken(stored.tokenPda);
    // Trust it optimistically, but confirm the token account still exists.
    // A stored key whose token is gone would fail every action with no way
    // to re-authorise, because the button hides once a session is set.
    void getBaseConnection()
      .getAccountInfo(stored.tokenPda)
      .then((info) => {
        if (!info) {
          setSession(null);
          setSessionToken(null);
        }
      })
      .catch(() => {});
  }, [publicKey]);
  const [sitting, setSitting] = useState<number | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const [acting, setActing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const me = publicKey?.toBase58() ?? null;
  const mySeat = useMemo(
    () => seats.findIndex((s) => s?.occupant && s.occupant === me),
    [seats, me],
  );

  // The store outlives navigation, so clear the previous table's state before
  // this one starts writing. Without this, opening a second table briefly
  // shows the first table's seats and hand.
  const resetStore = useTableStore((s) => s.reset);
  useEffect(() => {
    resetStore();
    return () => resetStore();
  }, [table, resetStore]);

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

  // A table whose deck predates the current program cannot deal. Spot it here
  // rather than letting the player press start and collect a raw error.
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    void getBaseConnection()
      .getAccountInfo(deckPda(table))
      .then((info) => setOutdated(!!info && info.data.length < DECK_ACCOUNT_SIZE))
      .catch(() => {});
  }, [table]);

  useEffect(() => {
    void refreshDelegation();
    const t = setInterval(() => void refreshDelegation(), 6000);
    return () => clearInterval(t);
  }, [refreshDelegation]);

  // Only the creator gets a delete button. The config is immutable, so this is
  // read once alongside it.
  const [creator, setCreator] = useState<string | null>(null);
  useEffect(() => {
    void getBaseConnection()
      .getAccountInfo(config)
      .then((info) => {
        if (info && info.data.length >= 48) {
          setCreator(new PublicKey(info.data.subarray(16, 48)).toBase58());
        }
      })
      .catch(() => {});
  }, [config]);
  const isCreator = !!me && creator === me;

  const capture = useHandCapture(tableView?.tableId ?? null, erConnection, table);

  // Read from whichever layer owns the accounts right now. Before delegation
  // the game lives on the base layer, and that is where seats fill up. Hole
  // cards only ever come over the player's own authenticated rollup
  // connection, and only matter while a game is live.
  useTableSubscriptions(
    delegated === true ? erConnection : getBaseConnection(),
    delegated === true ? erConnection : null,
    table,
    mySeat,
  );

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
    enabled: Boolean(
      delegated && !outdated && session && sessionToken && erProgram && mySeat >= 0,
    ),
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

  // What this player can actually put on the table: the table's limits capped
  // by what they hold. A modal that opens above their balance produces a join
  // that the program refuses.
  const minBuyIn = tableConfig?.minBuyIn ?? 200;
  const maxAffordable = Math.min(tableConfig?.maxBuyIn ?? 2000, player.state?.chips ?? 0);
  const canAfford = maxAffordable >= minBuyIn;
  const affordableBuyIn = Math.max(minBuyIn, maxAffordable);

  const seatedCount = seats.filter((s) => s?.occupant).length;
  const occupiedSeats = useMemo(
    () => seats.map((s, i) => (s?.occupant ? i : -1)).filter((i) => i >= 0),
    [seats],
  );

  // Your own action, shown before the chain confirms it. The overlay drops the
  // moment the chain reports something newer, so it can never mask reality for
  // more than the round trip.
  const pending = useTableStore((s) => s.pending);
  const showPending = pendingApplies(pending, hand);
  const viewSeats = showPending ? applyPending(seats, pending) : seats;
  const viewHand = showPending && hand ? applyPendingHand(hand, pending) : hand;
  const pot = potTotal(viewSeats);

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

  // A seat with no chips left cannot be dealt in, so it does not count toward
  // the two players a hand needs.
  const fundedCount = seats.filter((s) => s?.occupant && s.stack > 0).length;
  const status = useStatusLine(delegated, tableView, hand, seats, fundedCount);

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
            {connected && link === "offline" && (
              <Button variant="quiet" size="sm" onClick={() => void connectTee()}>
                Retry connection
              </Button>
            )}
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
            {session && mySeat >= 0 && !outdated && delegated === false && seatedCount >= 2 && (
              <Button
                variant="primary"
                size="sm"
                loading={actions.busy?.startsWith("start")}
                onClick={async () => {
                  await actions.startTable(occupiedSeats);
                  await refreshDelegation();
                }}
              >
                Start playing
              </Button>
            )}
            {session && mySeat >= 0 && delegated && tableView?.state === 0 && (
              <Button
                variant="ghost"
                size="sm"
                loading={actions.busy === "pause"}
                onClick={async () => {
                  await actions.pauseTable();
                  await refreshDelegation();
                }}
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
            {isCreator && delegated === false && (
              <Button
                variant="danger"
                size="sm"
                loading={actions.busy === "delete"}
                onClick={() => setConfirmDelete(true)}
              >
                Delete table
              </Button>
            )}
          </div>
        </div>

        <TableFelt
          table={tableView}
          hand={viewHand}
          seats={viewSeats}
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
                  setBuyIn(affordableBuyIn);
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
          {outdated && (
            <Panel style={{ textAlign: "center", maxWidth: 520 }}>
              <p style={{ margin: "0 0 6px", color: "var(--lose)" }}>
                This table cannot be played.
              </p>
              <p style={{ margin: 0, color: "var(--text-dim)", fontSize: "var(--t-sm)" }}>
                It was created by an earlier version of the game, and its deck no
                longer matches. Pause it if it is running, cash out, and create a
                new table from the lobby.
              </p>
            </Panel>
          )}

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
              hand={viewHand}
              seat={viewSeats[mySeat]}
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
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this table?"
      >
        <p style={{ color: "var(--text-dim)", fontSize: "var(--t-sm)", marginTop: 0 }}>
          The table and its seats are removed and the rent comes back to you.
          Anyone still sitting is sent home with their chips first, so nobody
          loses anything.
        </p>
        {seatedCount > 0 && (
          <p style={{ color: "var(--text-dim)", fontSize: "var(--t-sm)" }}>
            {seatedCount} {seatedCount === 1 ? "player is" : "players are"} still
            seated and will be cashed out.
          </p>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Button
            variant="danger"
            loading={actions.busy === "delete"}
            onClick={async () => {
              const occupants = seats
                .map((s, i) => (s?.occupant ? { seat: i, occupant: s.occupant } : null))
                .filter((x): x is { seat: number; occupant: string } => x !== null);
              const ok = await actions.deleteTable(occupants);
              setConfirmDelete(false);
              if (ok) router.push("/");
            }}
          >
            Delete it
          </Button>
          <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
        </div>
      </Modal>

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
            min={minBuyIn}
            max={Math.max(minBuyIn, maxAffordable)}
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
        {!canAfford && (
          <p style={{ color: "var(--lose)", fontSize: "var(--t-sm)", marginTop: 0 }}>
            You need at least {minBuyIn.toLocaleString()} chips to sit here.
            Claim from the faucet in the lobby.
          </p>
        )}
        <Button
          variant="primary"
          disabled={!canAfford}
          loading={actions.busy === "join"}
          onClick={async () => {
            if (sitting === null) return;
            await actions.join(sitting, Math.min(Math.max(buyIn, minBuyIn), maxAffordable));
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
  seats: (SeatView | null)[],
  funded: number,
): string | undefined {
  if (delegated === null) return "loading";
  if (!delegated) {
    if (funded < 2) return "waiting for players";
    return "ready to start";
  }
  if (!hand || !table) return "connecting";
  if (table.state === 1) return undefined;

  // Between hands. Say what is actually being waited on, and in particular
  // say when the table cannot continue at all, rather than showing a
  // reassuring "shuffling" forever.
  if (funded < 2) return "not enough players with chips";
  if (hand.shuffleState === SHUFFLE_REQUESTED) return "shuffling";
  const committed = seats.filter((s) => s?.occupant && s.saltState > 0).length;
  if (committed === 0) return "starting the next hand";
  if (committed < 2) return "waiting for players to shuffle in";
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
