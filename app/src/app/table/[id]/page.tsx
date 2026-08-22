"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { TableFelt } from "@/components/poker/TableFelt";
import { ActionBar, type ActionKind } from "@/components/poker/ActionBar";
import { Button } from "@/components/primitives/Button";
import { ChipGlyph } from "@/components/primitives/Chip";
import { Modal } from "@/components/primitives/Surface";
import { useTee } from "@/hooks/use-tee";
import { useTableSubscriptions } from "@/hooks/use-table-subscriptions";
import { useCrank } from "@/hooks/use-crank";
import { useHandCapture } from "@/hooks/use-hand-capture";
import { useShowdownSequence } from "@/hooks/use-showdown-sequence";
import { useTableSounds } from "@/hooks/use-table-sounds";
import { sfx } from "@/lib/sfx";
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
import { clearSession, ensureSession, loadSession } from "@/lib/session";
import { bestFive, describe, evaluate } from "@/lib/engine/evaluate";
import { NO_CARD } from "@/lib/engine/cards";
import {
  DECK_ACCOUNT_SIZE,
  MAX_SEATS,
  NO_SEAT,
  SHUFFLE_REQUESTED,
} from "@/lib/constants";
import { friendlyError, isRaceLost } from "@/lib/net";
import { toast } from "@/stores/ui-store";
import { spring } from "@/styles/theme";
import { useTableLayout } from "@/hooks/use-viewport";
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

  // The end of a hand, paced into reveal, compare, and pay.
  const showdown = useShowdownSequence(hand, tableView, seats);

  // The next hand waits for two things: the finished one to be written down,
  // and the showdown to have played out. Dealing over the top of the animation
  // is how a player misses the moment they won.
  const stageRef = useRef(showdown.stage);
  stageRef.current = showdown.stage;
  const captureReady = capture.ready;
  const readyForNextHand = useCallback(
    () => captureReady() && stageRef.current === null,
    [captureReady],
  );

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

  // Start, pause and cash-out all move the table between layers, and the page
  // reads whichever layer owns the accounts. Waiting up to six seconds for
  // the delegation poll to notice leaves the table rendering the frozen side.
  // The moment an action finishes, ask again.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && actions.busy === null) void refreshDelegation();
    wasBusy.current = actions.busy !== null;
  }, [actions.busy, refreshDelegation]);

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
    captureReady: readyForNextHand,
    // A refused session key is a dead end otherwise: the authorise button only
    // appears when there is no session, so dropping it is what lets the player
    // out.
    onSessionInvalid: useCallback(() => {
      if (publicKey) clearSession(publicKey);
      setSession(null);
      setSessionToken(null);
    }, [publicKey]),
  });

  // Sound is on by default and remembered once turned off.
  const [muted, setMuted] = useState(false);
  useEffect(() => setMuted(sfx.isMuted()), []);

  /** One prompt, then the table is silent for a day. */
  const [authorising, setAuthorising] = useState(false);
  const authorise = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    setAuthorising(true);
    try {
      const s = await ensureSession(getBaseConnection(), publicKey, signTransaction);
      setSession(s.keypair);
      setSessionToken(s.tokenPda);
      toast("Session key authorised. No more prompts while you play.", "good");
    } catch (e) {
      // The toast is for the player; the console line is for anything driving
      // the page that cannot read a toast.
      console.error("authorise session failed:", e);
      toast(friendlyError(e), "bad");
    } finally {
      setAuthorising(false);
    }
  }, [publicKey, signTransaction]);

  // What this player can actually put on the table: the table's limits capped
  // by what they hold. A modal that opens above their balance produces a join
  // that the program refuses.
  const minBuyIn = tableConfig?.minBuyIn ?? 40;
  const maxAffordable = Math.min(tableConfig?.maxBuyIn ?? 200, player.state?.chips ?? 0);
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
  // Retire the optimistic action once the chain has caught up with it, or
  // after long enough that it clearly never landed. Holding it any longer
  // would show a bet the chain might not have.
  useEffect(() => {
    if (!pending) return;
    if (!pendingApplies(pending, hand)) {
      setPending(null);
      return;
    }
    const t = setTimeout(() => setPending(null), 8_000);
    return () => clearTimeout(t);
  }, [pending, hand, setPending]);
  const showPending = pendingApplies(pending, hand);
  const viewSeats = showPending ? applyPending(seats, pending) : seats;
  const viewHand = showPending && hand ? applyPendingHand(hand, pending) : hand;
  const pot = potTotal(viewSeats);

  // Showdown highlighting: work out the winning five from what was shown.
  const { winningCards, winnerSeats, myHandName, handNames } = useShowdown(
    hand,
    seats,
    mySeat,
    myHole,
    myHoleHandNumber,
  );

  const onAct = useCallback(
    async (kind: ActionKind, toTotal: number) => {
      if (!hand) return;
      // Your own action answers immediately. Waiting for the chain to confirm
      // before making a sound turns a third of a second into a broken button.
      if (kind === "fold") sfx.fold();
      else if (kind === "check") sfx.check();
      else if (kind === "call") sfx.call();
      else sfx.bet();
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
        // Losing the race is not a failure worth showing. By the time a press
        // reaches the rollup the turn may already have moved, usually because
        // the clock ran out and a timeout acted for you, and telling the player
        // their own click was an error reads as a broken table when nothing
        // went wrong. The felt already shows what actually happened.
        if (!isRaceLost(e)) toast(friendlyError(e), "bad");
        // A failed action shows the truth again at once.
        setPending(null);
      } finally {
        // Deliberately not clearing `pending` on success here: the send
        // resolves a beat before the subscription delivers the acted-on state,
        // and clearing early snaps the seat back to its pre-action shape for
        // that frame. The chain retires it instead — the effect below drops it
        // the moment `toAct` moves on — with a timed backstop.
        setActing(false);
      }
    },
    [actions, hand, mySeat, setPending],
  );

  // A seat with no chips left cannot be dealt in, so it does not count toward
  // the two players a hand needs.
  const fundedCount = seats.filter((s) => s?.occupant && s.stack > 0).length;
  const status = useStalledStatus(
    useStatusLine(delegated, tableView, hand, seats, fundedCount, mySeat),
  );

  // The table is doing invisible work: salts, the enclave drawing randomness,
  // the deal being prepared. Show it shuffling rather than showing nothing.
  const working =
    delegated === true && tableView?.state === 0 && fundedCount >= 2;

  // The same events the felt draws, heard.
  useTableSounds({
    hand,
    table: tableView,
    seats,
    mySeat,
    stage: showdown.stage,
    working,
  });

  // Which room to build: the desktop corners, the portrait phone's stacked
  // rows, or the landscape phone's tightened corners. The CSS moves the HUD on
  // the same media queries; this moves the seats and sizes.
  const tableLayout = useTableLayout();
  const portrait = tableLayout === "portrait";
  const compact = tableLayout !== "desktop";

  // Long operations narrate themselves over the felt.
  const overlay =
    actions.busy === "start:funding"
      ? "funding the session key"
      : actions.busy === "start:delegating"
        ? "moving the table into the enclave"
        : actions.busy === "start:waiting"
          ? "waiting for the enclave"
          : actions.busy === "start:securing"
            ? "locking the cards down"
            : actions.busy === "start"
              ? "starting"
              : actions.busy === "pause"
                ? "returning to Solana"
                : actions.busy === "delete"
                  ? "closing the table"
                  : undefined;

  return (
    <>
      {/* The room fills the screen. The table sits in the middle of it and the
          controls live in the four corners, the way a real client is laid out,
          so nothing floats in a panel and nothing competes with the felt. */}
      <main
        className="table-room"
        style={{
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          background: "var(--panel-grad)",
          // A long press on a phone must not start selecting the table.
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <div className="felt-stage">
          <div className="felt-sizer">
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
              working={working}
              overlay={overlay}
              showdown={showdown}
              handNames={handNames}
              portrait={portrait}
              compact={compact}
              onSit={
                delegated === false && mySeat < 0 && connected
                  ? (i) => {
                      setSitting(i);
                      setBuyIn(affordableBuyIn);
                    }
                  : undefined
              }
            />
          </div>
        </div>

        {/* Top left: which table this is and how it is connected. Two tidy
            lines, label above value, with the controls in a row beside them.
            On a phone this strip runs the full width of the screen. */}
        <div className="hud-tl">
          <div className="hud-fields">
            <Field label="Blinds">
              {tableConfig
                ? `${tableConfig.smallBlind} / ${tableConfig.bigBlind}`
                : "-"}
            </Field>
            <Field label="Hand">{tableView?.handNumber ?? 0}</Field>
            {/* The id matters when comparing tables, which is a desk job. */}
            <span className="m-hide">
              <Field label="Table">{String(id).slice(-6)}</Field>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link href={`/history/${id}`} style={{ textDecoration: "none" }}>
              <IconButton title="Hand history">
                <HistoryIcon />
              </IconButton>
            </Link>
            {/* On a phone the room's own controls join the history button up
                here, so the row below carries only the table's state and does
                not strand two icons on a line of their own. */}
            <span className="m-only" style={{ display: "flex", gap: 8 }}>
              <MuteButton muted={muted} setMuted={setMuted} />
              <Link href="/" style={{ textDecoration: "none" }}>
                <IconButton title="Leave table">
                  <ExitIcon />
                </IconButton>
              </Link>
            </span>
            {connected && link === "offline" && (
              <Button variant="quiet" size="sm" onClick={() => void connectTee()}>
                Retry connection
              </Button>
            )}
          </div>
        </div>

        {/* Top right: everything that changes the table's state, ending in the
            way out. On a phone this is the second row, and it also carries
            your balance, whose desktop corner does not exist there. */}
        <div className="hud-tr">
          <div
            className="m-only"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginRight: "auto",
            }}
          >
            <BalancePill chips={player.state?.chips} small />
            <Link href="/" style={{ textDecoration: "none" }}>
              <IconButton title="Buy more chips" solid>
                <PlusIcon />
              </IconButton>
            </Link>
          </div>
          {connected && !session && (
            <Button variant="primary" size="sm" loading={authorising} onClick={authorise}>
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
          {/*
            One button, whatever the table is doing.

            Cashing out is a base-layer move, so the table does have to come off
            the rollup for a moment — but that is our problem, not the player's.
            They used to have to know it: press "Pause table", which stops
            everyone and reads like an admin action, and only then cash out.
            Now they press this, stop being dealt in immediately, and the rest
            happens on its own once the current hand ends.
          */}
          {mySeat >= 0 && (
            <Button
              variant="ghost"
              size="sm"
              loading={actions.busy?.startsWith("cashout") || actions.busy === "leave"}
              onClick={async () => {
                await actions.cashOut(mySeat);
                await player.refresh();
                await refreshDelegation();
              }}
            >
              {actions.busy === "cashout:pausing"
                ? "Closing the table…"
                : actions.busy === "cashout:leaving"
                  ? "Cashing out…"
                  : actions.busy === "cashout:resuming"
                    ? "Resuming for the others…"
                    : actions.busy === "cashout"
                      ? "Finishing this hand…"
                      : "Cash out"}
            </Button>
          )}
          {/*
            Pause stays for the creator alone, because deleting a table needs it
            off the rollup first. It is maintenance, not something a player at
            the table should ever have to reach for.
          */}
          {isCreator && session && delegated && tableView?.state === 0 && (
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
          <span className="m-hide" style={{ display: "flex", gap: 8 }}>
            <MuteButton muted={muted} setMuted={setMuted} />
            <Link href="/" style={{ textDecoration: "none" }}>
              <IconButton title="Leave table">
                <ExitIcon />
              </IconButton>
            </Link>
          </span>
        </div>

        {/* Bottom left: what you are carrying. On a phone this corner is gone
            and the balance lives in the top strip instead. */}
        <div className="hud-bl">
          <BalancePill chips={player.state?.chips} />
          <Link href="/" style={{ textDecoration: "none" }}>
            <IconButton title="Buy more chips" solid>
              <PlusIcon />
            </IconButton>
          </Link>
        </div>

        {/* Bottom right: the decision in front of you. On a phone it spans the
            whole bottom edge, above the home bar. */}
        <div className="hud-br">
          <AnimatePresence>
            {myHandName && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={spring.snappy}
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 12,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
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

          {connected && mySeat >= 0 && !session && (
            <Notice>
              <span>
                Authorise a session key to play without a wallet prompt on every
                action. It can bet for you at this table and nothing else.
              </span>
              <Button variant="primary" size="sm" loading={authorising} onClick={authorise}>
                Authorise
              </Button>
            </Notice>
          )}

          {connected && mySeat < 0 && delegated && (
            <Notice>
              <span>
                This table is playing. Seats open again when it pauses between
                hands.
              </span>
            </Notice>
          )}

          {outdated && (
            <Notice tone="var(--lose)">
              <span>
                This table cannot be played. It was made by an earlier version of
                the game and its deck no longer matches. Cash out and create a new
                one from the lobby.
              </span>
            </Notice>
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
          Chips move from your balance to the seat, and back when you cash
          out. They keep their SOL backing the whole time.
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
            Buy some in the lobby first.
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

/**
 * A labelled value in the corner strip.
 *
 * The stakes used to sit on their own as "5 / 10", which says nothing unless
 * you already know it means the blinds. Every figure up here now carries the
 * word for what it is, on a line above it, and they share a baseline so the
 * strip reads as a row rather than a pile.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, lineHeight: 1 }}>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 9,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-faint)",
        }}
      >
        {label}
      </span>
      <span
        className="tnum"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 14,
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          height: 18,
        }}
      >
        {children}
      </span>
    </div>
  );
}

/**
 * The sound switch. It appears in one corner on a desktop and another on a
 * phone, so it lives here rather than being written out twice.
 */
function MuteButton({
  muted,
  setMuted,
}: {
  muted: boolean;
  setMuted: (v: boolean) => void;
}) {
  return (
    <IconButton
      title={muted ? "Unmute" : "Mute"}
      onClick={() => {
        const next = !muted;
        sfx.setMuted(next);
        setMuted(next);
        // Unmuting is itself a gesture, so the browser will let the context
        // start; a small sound confirms it worked.
        if (!next) sfx.chip();
      }}
    >
      {muted ? <MutedIcon /> : <SoundIcon />}
    </IconButton>
  );
}

/** Your chip balance, worn as a quiet pill. */
function BalancePill({ chips, small = false }: { chips?: number; small?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: small ? 6 : 10,
        background: "var(--surface)",
        backdropFilter: "blur(8px)",
        borderRadius: "var(--r-panel)",
        padding: small ? "0 10px" : "12px 18px",
        height: small ? 36 : undefined,
      }}
    >
      <ChipGlyph size={small ? 14 : 20} />
      <span
        className="tnum"
        style={{
          fontWeight: 700,
          fontSize: small ? 12 : 15,
          color: "var(--text-dim)",
        }}
      >
        {chips !== undefined ? chips.toLocaleString() : "..."}
      </span>
    </div>
  );
}

/** A square icon button, the shape the corners of the room are built from. */
function IconButton({
  children,
  title,
  solid = false,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  solid?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.span
      className="m-icon"
      title={title}
      aria-label={title}
      role="button"
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.96 }}
      transition={spring.snappy}
      style={{
        width: 44,
        height: 44,
        display: "grid",
        placeItems: "center",
        borderRadius: "var(--r-panel)",
        background: solid ? "var(--control)" : "var(--surface)",
        color: solid ? "var(--accent)" : "var(--text-dim)",
        cursor: "pointer",
      }}
    >
      {children}
    </motion.span>
  );
}

/** A clock wound backwards: the usual mark for history. */
function HistoryIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 9.5A9 9 0 1 1 3 12"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M3 4.5v5h5"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7.5V12l3 2"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4.7 6.6 8.2H3v7.6h3.6L11 19.3V4.7Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </g>
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4.7 6.6 8.2H3v7.6h3.6L11 19.3V4.7Z" />
        <path d="M22 9.5 16 15.5M16 9.5l6 6" />
      </g>
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 4h5v16h-5M11 8l-4 4 4 4M7 12h10"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A short message in the corner, without a box around the whole screen. */
function Notice({
  children,
  tone = "var(--text-dim)",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--surface)",
        backdropFilter: "blur(8px)",
        borderRadius: "var(--r-panel)",
        padding: "12px 16px",
        fontSize: "var(--t-sm)",
        color: tone,
        textAlign: "left",
      }}
    >
      {children}
    </div>
  );
}

/**
 * How long a table may sit on the same waiting line before it is stuck.
 *
 * Setup normally takes a few seconds. Half a minute of no progress at all is
 * not a slow shuffle, it is something that is not going to finish.
 */
const STALLED_AFTER_MS = 35_000;

/**
 * Say when a wait has stopped being a wait.
 *
 * Every between-hands state here is driven by some other client doing its part,
 * and the errors that come back while waiting are all in `RACE_LOST` — they are
 * the normal case, so they are swallowed. That is right, and it means a table
 * that genuinely cannot continue shows exactly the same reassuring line as one
 * that is a second from dealing, forever.
 *
 * This is not hypothetical. A commit-phase change once let whichever browser
 * revealed its salt first lock the other one out; two players sat looking at
 * "waiting for players to shuffle in" with no way to tell it would never
 * change. The underlying bug is fixed, and the class of bug is not: anything
 * that stops one player's client contributing lands here. So after half a
 * minute the line stops reassuring and starts describing.
 */
function useStalledStatus(status: string | undefined): string | undefined {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    setStalled(false);
    if (!status) return;
    const id = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(id);
  }, [status]);

  if (!stalled || !status) return status;

  // Only the states that depend on someone else finishing something. "waiting
  // for players" really can last all day and is not a fault.
  switch (status) {
    case "waiting for players to shuffle in":
      return "a player has not shuffled in — try reloading, or pause the table";
    case "shuffling":
      return "the shuffle is taking longer than it should — it will retry, or pause the table";
    case "starting the next hand":
      return "the next hand has not started — try reloading, or pause the table";
    case "connecting":
      return "still connecting to the game validator — try reloading";
    default:
      return status;
  }
}

/** A short line explaining what the table is waiting for. */
function useStatusLine(
  delegated: boolean | null,
  table: TableView | null,
  hand: HandView | null,
  seats: (SeatView | null)[],
  funded: number,
  mySeat: number,
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
  // Your own seat could not be locked down, so the program will deal you out.
  //
  // This is the one failure a player would otherwise experience as the game
  // ignoring them: the hand starts, everyone else gets cards, and nothing
  // explains why they did not. It happens when the previous occupant of the
  // seat left without handing back their read right — a permission names one
  // member, only that member may update it, and it outlives a pause. Sitting
  // the seat out is the safe response (the alternative is dealing cards that
  // player could read), but it has to be said out loud, and the way out is to
  // take a different chair.
  const mine = mySeat >= 0 ? seats[mySeat] : null;
  if (mine?.occupant && !mine.cardsSecured) {
    return "this seat cannot be locked down — you will sit out; take another seat";
  }

  if (funded < 2) return "not enough players with chips";
  if (hand.shuffleState === SHUFFLE_REQUESTED) return "shuffling";
  const committed = seats.filter((s) => s?.occupant && s.saltState > 0).length;
  if (committed === 0) return "starting the next hand";
  if (committed < 2) return "waiting for players to shuffle in";
  return "shuffling";
}

// The Link field is gone from the HUD. Which layer a table is sitting on is
// plumbing, not something a player at the table needs to read every hand, and
// the status line already says when the room is not ready. The `link` store
// value still drives the offline notice below the felt.

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
      handNames: undefined as Map<number, string> | undefined,
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
    const handNames = new Map<number, string>();
    for (let i = 0; i < MAX_SEATS; i++) {
      if (!(hand.revealedMask & (1 << i))) continue;
      const hole = hand.revealed[i];
      if (hole[0] === NO_CARD) continue;
      const { five, rank } = bestFive([...hole, ...board]);
      fives.set(i, five);
      handNames.set(i, describe(evaluate([...hole, ...board])));
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
      handNames,
    };
  }, [hand, seats, mySeat, myHole, myHoleHandNumber]);
}
