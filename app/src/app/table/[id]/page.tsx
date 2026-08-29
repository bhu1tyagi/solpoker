"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useReadiness } from "@/hooks/use-readiness";
import { useUiStore } from "@/stores/ui-store";
import { LobbyGate } from "@/components/onboarding/LobbyGate";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { TableFelt } from "@/components/poker/TableFelt";
import { ActionBar, type ActionKind } from "@/components/poker/ActionBar";
import { Button } from "@/components/primitives/Button";
import { ChipGlyph } from "@/components/primitives/Chip";
import { PrivacyRing } from "@/components/primitives/ChipRing";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { TableIcon } from "@/components/primitives/Icons";
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
import { readConfigCache, writeConfigCache } from "@/lib/config-cache";
import { clearSession, ensureSession, loadSession } from "@/lib/session";
import { bestFive, describe, evaluate } from "@/lib/engine/evaluate";
import { NO_CARD } from "@/lib/engine/cards";
import {
  DECK_ACCOUNT_SIZE,
  MAX_SEATS,
  NO_SEAT,
  SHUFFLE_REQUESTED,
} from "@/lib/constants";
import { formatUsd } from "@/lib/money";
import { friendlyError, isRaceLost, net } from "@/lib/net";
import { toast } from "@/stores/ui-store";
import { spring } from "@/styles/theme";
import { useTableLayout } from "@/hooks/use-viewport";
import { isDelegated } from "@/lib/instructions";
import { applyPending, applyPendingHand, pendingApplies } from "@/lib/optimistic";

/**
 * What the felt says while the table is busy, in the language of the game.
 *
 * Every busy phase is here on purpose. This used to be a ternary chain that
 * covered six of the twelve, so the overlay blinked out in the middle of a
 * cash-out and again during a rollback — the two moments a player most needs
 * telling that something is still happening. Anything unmapped falls through to
 * a plain line rather than to nothing.
 *
 * The words are the ones a dealer would use. A player does not need to know
 * that their table is being delegated to an ephemeral rollup, or that a
 * permission is being written to an enclave; they need to know the table is
 * being set and their cards are coming. The machinery is real and it is
 * explained on the fairness page, which is where somebody who wants it can go.
 */
const OVERLAY_COPY: Record<string, string> = {
  start: "shuffling up",
  "start:funding": "shuffling up",
  "start:delegating": "setting the table",
  "start:waiting": "setting the table",
  "start:securing": "dealing you in",
  "start:rollback": "putting things back — nothing was lost",
  pause: "finishing up",
  "pause:waiting": "letting the hand finish",
  cashout: "finishing this hand",
  "cashout:pausing": "cashing you out",
  "cashout:leaving": "sending your chips home",
  "cashout:resuming": "dealing the others back in",
  leave: "sending your chips home",
  delete: "putting the table away",
};

export default function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tableId = useMemo(() => new BN(id), [id]);
  const table = useMemo(() => tablePda(tableId), [tableId]);
  const config = useMemo(() => configPda(tableId), [tableId]);

  const router = useRouter();
  const { publicKey, signTransaction, connected } = useWallet();
  // Same source the lobby and the gate use, so all three agree on who may sit.
  const readiness = useReadiness();
  const openGate = useUiStore((s) => s.openGate);
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

  /*
   * The table's own terms: blinds, and the buy-in this table allows.
   *
   * A config is written once at creation and no instruction can ever change
   * it, so the remembered copy goes up first and the page opens already
   * knowing its own stakes. This is what "stakes arrive late" actually was:
   * not the network, but a page asking the chain for something immutable that
   * it had already been told, and having nowhere to keep the answer.
   *
   * The read still runs behind it. It corrects a config written by an older
   * build, and on a first visit it is the only source — retried through the
   * weather, because everything downstream treats "no data" as an answer and
   * a buy-in offered below this table's minimum is one the program rejects.
   */
  useEffect(() => {
    const cached = readConfigCache(config.toBase58());
    if (cached) setConfig(cached);
  }, [config, setConfig]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await net(
          () => getBaseConnection().getAccountInfo(config),
          "table config",
        );
        if (!info) {
          console.warn(`table config ${config.toBase58()} does not exist on the base layer`);
          return;
        }
        if (cancelled) return;
        const decoded = decodeConfig(new Uint8Array(info.data));
        setConfig(decoded);
        writeConfigCache(config.toBase58(), decoded);
      } catch (e) {
        // Nothing invented in its place; the sit modal says it is still
        // reading rather than offering a buy-in this table may refuse. With a
        // cached copy already showing, this is invisible and harmless.
        console.error(`could not read table config ${config.toBase58()}:`, e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, setConfig]);

  useEffect(() => {
    setMySeat(mySeat);
  }, [mySeat, setMySeat]);

  /*
   * Delegation decides whether this is a lobby view or a live game.
   *
   * This ran every ten seconds with nothing catching it. One failed read —
   * and a rate-limited response reaches the browser as a bare "Failed to
   * fetch", because an error response carries no CORS headers — became an
   * unhandled rejection, which is what put a runtime error over the table and
   * made the seats unclickable while it sat there. Every other background read
   * on this page was already wrapped; this one had been missed.
   *
   * Two rules now. It is retried, because a blip is not an answer. And a
   * failure LEAVES THE LAST KNOWN VALUE ALONE: reporting "not delegated"
   * because a read failed would redraw a live game as an empty lobby, which is
   * far worse than briefly showing a stale one.
   */
  const refreshDelegation = useCallback(async () => {
    try {
      const on = await net(() => isDelegated(getBaseConnection(), table), "delegation");
      setDelegated(on);
    } catch (e) {
      console.warn(`delegation check failed for ${table.toBase58()}, keeping last known:`, e);
    }
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
    const t = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshDelegation();
    }, 10_000);
    return () => clearInterval(t);
  }, [refreshDelegation]);


  /*
   * Only the creator gets a delete button — and the config already says who
   * that is. This used to be a second `getAccountInfo` on the very same
   * account, parsing bytes 16..48 by hand: two round trips, on every visit,
   * for one immutable record. The decoder has read that field the whole time.
   */
  const isCreator = !!me && tableConfig?.creator === me;

  const capture = useHandCapture(tableView?.tableId ?? null, erConnection, table);

  // A read-only window handle for driven browsers (the two-browser gate) to
  // report what the store actually held when a check failed. Reads only.
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__pokerableDebug = () => {
      const s = useTableStore.getState();
      return {
        connected,
        mySeat: s.mySeat,
        link: s.link,
        handNumber: s.hand?.handNumber,
        dealtIn: s.hand?.dealtIn,
        myHole: s.myHole,
        myHoleHandNumber: s.myHoleHandNumber,
        delegated,
        crankEnabled: Boolean(
          delegated && !outdated && session && sessionToken && erProgram && s.mySeat >= 0,
        ),
        saltStates: s.seats.map((x) => x?.saltState ?? null),
      };
    };
    // Re-bound on every value it reports, or the handle lies with first-render
    // state forever.
  }, [connected, delegated, outdated, session, sessionToken, erProgram]);

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
    // While delegated the rollup owns the truth — but a viewer whose rollup
    // link is not up yet (spectator mid-auth, token refused, TEE hiccup) used
    // to get an empty felt while the lobby showed a full table. The base
    // layer's frozen copy is truthful as of delegation, so show that until
    // the live link lands.
    delegated === true ? (erConnection ?? getBaseConnection()) : getBaseConnection(),
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

  /*
   * Stop cranking while this client is taking the table apart.
   *
   * Undelegation is not instant — the accounts spend seconds owned by neither
   * layer, and every send the crank makes in that window fails as a wrong-layer
   * error. Silencing those was half the fix; not making them is the other half,
   * and it also stops this client fighting its own cash-out.
   *
   * Deliberately not plain `cashout`. That phase is the wait for the current
   * hand to end, up to three minutes, and heads-up it is this very crank that
   * calls `force_timeout` on an opponent who has closed their tab. Stop there
   * and the hand never ends, so the cash-out never starts. The teardown begins
   * at `cashout:pausing`, and so does the quiet.
   */
  const crankQuiesced = /^(cashout:|pause|start:rollback)/.test(actions.busy ?? "");

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
      delegated &&
        !outdated &&
        session &&
        sessionToken &&
        erProgram &&
        mySeat >= 0 &&
        !crankQuiesced,
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
  /*
   * Never invent a table's terms.
   *
   * These used to fall back to 40 and 200 whenever the config had not
   * arrived, which is not a safe guess in either direction: at a table whose
   * real minimum is 400, the modal offered to sit for 200 — a buy-in the
   * program rejects outright — and capped a player holding 659 chips at 200
   * when the table would have taken all of them. Unknown stakes are now
   * unknown, and the modal waits instead of guessing.
   */
  const stakesKnown = tableConfig !== null;
  const minBuyIn = tableConfig?.minBuyIn ?? 0;
  const maxAffordable = Math.min(tableConfig?.maxBuyIn ?? 0, player.state?.chips ?? 0);
  const canAfford = stakesKnown && maxAffordable >= minBuyIn;
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

  /*
   * Your chair, and whether its card lock is a wait or a problem.
   *
   * Sitting down clears the lock on chain — a permission still naming the last
   * occupant would let them read your cards — and the crank puts it back within
   * a few seconds. So "not secured" is the normal state of a chair you just
   * took, and the table used to greet every new player by telling them to go
   * and sit somewhere else. Only a lock that will not take, after time and
   * repeated refusals, is the seat genuinely still held by whoever left it.
   */
  const mySeatView = mySeat >= 0 ? seats[mySeat] : null;
  const chairUnsecured = Boolean(mySeatView?.occupant && !mySeatView.cardsSecured);
  const secureFails = useTableStore((s) => s.secureFailures[mySeat] ?? 0);
  const clearSecureFailures = useTableStore((s) => s.clearSecureFailures);
  useEffect(() => {
    if (!chairUnsecured && mySeat >= 0) clearSecureFailures(mySeat);
  }, [chairUnsecured, mySeat, clearSecureFailures]);
  const chair = useChairHeld(chairUnsecured, secureFails);

  // While the table is being taken apart, the cash-out narrates and everything
  // else holds its tongue. Chairs are meant to be unsecured at that point.
  const quiescing = /^(cashout|pause|start:rollback)/.test(actions.busy ?? "");

  const status = useStalledStatus(
    useStatusLine(delegated, tableView, hand, seats, fundedCount, chair, quiescing),
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
    myHole,
  });

  // Which room to build: the desktop corners, the portrait phone's stacked
  // rows, or the landscape phone's tightened corners. The CSS moves the HUD on
  // the same media queries; this moves the seats and sizes.
  const tableLayout = useTableLayout();
  const portrait = tableLayout === "portrait";
  const compact = tableLayout !== "desktop";

  // Long operations narrate themselves over the felt.
  const overlay = actions.busy && actions.busy !== "join"
    ? OVERLAY_COPY[actions.busy] ?? "working on it"
    : undefined;

  /*
   * Taking a seat is the only thing that needs a set-up wallet, so it is the
   * only thing that asks.
   *
   * Watching costs nothing and gives away nothing — the felt shows what is
   * public on chain either way — so a link followed from a friend lands on the
   * table, not on a door. The gate opens at the chair, over the room, at
   * whichever step is actually missing.
   */
  const onSeatClick = useCallback(
    (i: number) => {
      if (!connected || !readiness.ready) {
        openGate();
        return;
      }
      setSitting(i);
      setBuyIn(affordableBuyIn);
    },
    [connected, readiness.ready, openGate, affordableBuyIn],
  );

  return (
    <>
      {/* Mounted, not shown. A seat click is the only thing that opens it. */}
      <LobbyGate onlyWhenAsked lockWhenSignedOut />
      {/* The room fills the screen. The table sits in the middle of it and the
          controls live in the four corners, the way a real client is laid out,
          so nothing floats in a panel and nothing competes with the felt. */}
      <main
        className="table-room"
        style={{
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          // The same ground the rest of the site stands on. The ambience comes
          // from the orb layer below, exactly as it does in the lobby, so
          // walking from one room to the other never changes the light. The
          // raised rail is what keeps the table reading as a table against it.
          background: "var(--c-felt)",
          // A long press on a phone must not start selecting the table.
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* The lobby's ambient glow, unchanged: same classes, same colours. */}
        <div className="landing-orbs" aria-hidden>
          <div className="orb orb-purple" />
          <div className="orb orb-green" />
        </div>
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
              // Your seat is secured when the authenticated rollup link is up:
              // that connection is precisely what decides whether the validator
              // will serve your hole cards to you and to nobody else. Only
              // shown once you are actually seated.
              secured={mySeat >= 0 ? link === "live" : undefined}
              onSit={delegated === false && mySeat < 0 ? onSeatClick : undefined}
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
            {/*
              The trust indicator: the one piece of chrome that earns its place
              by stating the product's whole claim, so it links to the page that
              makes that claim in full.

              What it says is deliberately the least it can say. Not "provably
              fair", not "trustless", and nothing implying the hole cards are
              cryptographically guaranteed rather than hardware-protected. The
              honest claim is a provably fair shuffle and TEE-protected hole
              cards, and the interface must not outrun the docs.
            */}
            {mySeat >= 0 && (
              <Link
                href="/trust"
                className="m-hide"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  textDecoration: "none",
                  padding: "6px 2px",
                  minHeight: "var(--touch-target)",
                }}
                title="How the shuffle and your hole cards are protected"
              >
                <PrivacyRing secured={link === "live"} size={15} />
                <span
                  className="label"
                  style={{
                    color: link === "live" ? "var(--c-green)" : "var(--c-ink-faint)",
                  }}
                >
                  {link === "live" ? "Cards secured" : "Not secured"}
                </span>
              </Link>
            )}
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
              <Link href="/lobby" style={{ textDecoration: "none" }}>
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
            <Link href="/lobby" style={{ textDecoration: "none" }}>
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
            <Link href="/lobby" style={{ textDecoration: "none" }}>
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
          <Link href="/lobby" style={{ textDecoration: "none" }}>
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
                  color: "var(--c-green)",
                }}
              >
                you have {myHandName}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Always mounted, for everyone. The room's controls are part of
              the room: a spectator sees the same three greyed verbs a seated
              player waits behind, and nothing about the page rearranges when
              they finally sit. `busy` locks the buttons for anyone who could
              not act anyway — no seat, or no session key yet. */}
          <ActionBar
            hand={viewHand}
            seat={mySeat >= 0 ? viewSeats[mySeat] : null}
            seatIndex={mySeat}
            pot={pot}
            busy={acting || mySeat < 0 || !session}
            onAct={onAct}
          />

          {/* Taking a seat sets this up on its own. The notice is what is left
              when that did not land — a refused prompt, an expired key, a
              wallet switched mid-session — so it reads as "finish this", not
              as a step nobody was told about. */}
          {connected && mySeat >= 0 && !session && (
            <Notice>
              <span>
                One more signature and this table stops asking. The key it
                creates can bet for you here and nothing else — it cannot touch
                your balance or cash anything out.
              </span>
              <Button variant="primary" size="sm" loading={authorising} onClick={authorise}>
                Continue
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
            <Notice tone="var(--c-loss)">
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
        <p style={{ color: "var(--c-ink-muted)", fontSize: "var(--t-body-sm-size)", marginTop: 0 }}>
          The table and its seats are removed and the rent comes back to you.
          Anyone still sitting is sent home with their chips first, so nobody
          loses anything.
        </p>
        {seatedCount > 0 && (
          <p style={{ color: "var(--c-ink-muted)", fontSize: "var(--t-body-sm-size)" }}>
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
        {/* The amount you are about to commit, led by the dollar figure and
            with the chip count under it — the same shape as the deposit sheet,
            because they are the same decision at two moments. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--sp-3)",
            padding: "var(--sp-4)",
            marginBottom: "var(--sp-4)",
            background: "var(--c-felt-raised)",
            border: "1px solid var(--c-rule)",
            borderRadius: "var(--r-lg)",
          }}
        >
          <ChipGlyph size={30} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span
              className="num"
              style={{
                fontSize: "var(--t-display-lg-size)",
                fontWeight: 700,
                color: "var(--c-ink)",
                lineHeight: 1.05,
              }}
            >
              {stakesKnown ? buyIn.toLocaleString() : "—"}
            </span>
            <span style={{ fontSize: "var(--t-body-sm-size)", color: "var(--c-ink-muted)" }}>
              chips · <span className="num">{formatUsd(buyIn)}</span>
            </span>
          </div>
        </div>

        <input
          type="range"
          min={minBuyIn}
          max={Math.max(minBuyIn, maxAffordable)}
          step={1}
          value={buyIn}
          disabled={!canAfford}
          aria-label="Buy-in"
          onChange={(e) => setBuyIn(Number(e.target.value))}
          style={{ width: "100%", marginBottom: "var(--sp-3)" }}
        />

        <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
          {([
            ["Min", minBuyIn],
            ["Half", Math.round((minBuyIn + maxAffordable) / 2 / 10) * 10],
            ["Max", maxAffordable],
          ] as const).map(([label, v]) => (
            <Button
              key={label}
              size="sm"
              variant={buyIn === v ? "primary" : "ghost"}
              disabled={!canAfford}
              onClick={() => setBuyIn(Math.max(minBuyIn, Math.min(v, maxAffordable)))}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* The table's own terms, demoted to a caption. They are context for
            the number above, not a competing headline. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "var(--sp-3)",
            flexWrap: "wrap",
            marginBottom: "var(--sp-4)",
            fontSize: "var(--t-label-size)",
            color: "var(--c-ink-faint)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <TableIcon size={13} />
            {stakesKnown ? (
              <>
                Blinds{" "}
                <span className="num">
                  {tableConfig!.smallBlind}/{tableConfig!.bigBlind}
                </span>
                {" · "}
                buy-in{" "}
                <span className="num">
                  {minBuyIn.toLocaleString()}–{tableConfig!.maxBuyIn.toLocaleString()}
                </span>
              </>
            ) : (
              "reading this table's stakes…"
            )}
          </span>
          <span>
            you hold <span className="num">{(player.state?.chips ?? 0).toLocaleString()}</span> chips
          </span>
        </div>

        {stakesKnown && !canAfford && (
          <p
            role="status"
            style={{
              margin: "0 0 var(--sp-4)",
              padding: "var(--sp-3)",
              borderRadius: "var(--r-md)",
              background: "var(--c-felt-raised)",
              borderLeft: "2px solid var(--c-info)",
              fontSize: "var(--t-body-sm-size)",
              color: "var(--c-ink-muted)",
              lineHeight: 1.5,
            }}
          >
            You need at least {minBuyIn.toLocaleString()} chips ({formatUsd(minBuyIn)}) to sit
            here. Buy some chips in the lobby first.
          </p>
        )}
        <Button
          variant="primary"
          fullWidth
          disabled={!canAfford}
          loading={actions.busy === "join"}
          onClick={async () => {
            if (sitting === null) return;
            // One signature covers the seat and the key that lets you act at
            // it; `join` bundles them. Whatever comes back is already real on
            // chain, so it goes straight into state.
            const s = await actions.join(
              sitting,
              Math.min(Math.max(buyIn, minBuyIn), maxAffordable),
            );
            if (s) {
              setSession(s.keypair);
              setSessionToken(s.tokenPda);
            }
            setSitting(null);
            await player.refresh();
          }}
        >
          {stakesKnown
            ? `Sit down with ${Math.min(
                Math.max(buyIn, minBuyIn),
                Math.max(minBuyIn, maxAffordable),
              ).toLocaleString()} chips`
            : "Reading this table…"}
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
          color: "var(--c-ink-faint)",
        }}
      >
        {label}
      </span>
      <span
        className="num"
        style={{
          fontSize: 14,
          color: "var(--c-ink)",
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
        background: "var(--c-felt-raised)",
        backdropFilter: "blur(8px)",
        borderRadius: "var(--r-lg)",
        padding: small ? "0 10px" : "12px 18px",
        height: small ? 36 : undefined,
      }}
    >
      <ChipGlyph size={small ? 14 : 20} />
      <span
        className="num"
        style={{
          fontWeight: 700,
          fontSize: small ? 12 : 15,
          color: "var(--c-ink-muted)",
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
        borderRadius: "var(--r-lg)",
        background: solid ? "var(--c-felt-edge)" : "var(--c-felt-raised)",
        color: solid ? "var(--c-green)" : "var(--c-ink-muted)",
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
  tone = "var(--c-ink-muted)",
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
        background: "var(--c-felt-raised)",
        backdropFilter: "blur(8px)",
        borderRadius: "var(--r-lg)",
        padding: "12px 16px",
        fontSize: "var(--t-body-sm-size)",
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
      return "a player has not shuffled in, so try reloading, or pause the table";
    case "shuffling":
      return "the shuffle is taking longer than it should. It will retry, or pause the table";
    case "starting the next hand":
      return "the next hand has not started, so try reloading, or pause the table";
    case "connecting":
      return "still connecting to the game validator, so try reloading";
    default:
      return status;
  }
}

/** How long an unsecured chair is given before it is called stuck. */
const CHAIR_PATIENCE_MS = 25_000;
const CHAIR_GIVE_UP_MS = 60_000;

/**
 * Is your chair still being locked down, or is it genuinely held?
 *
 * Both look identical on chain — an occupied seat without `cards_secured` — and
 * the difference is only time and the crank's luck. Two timers rather than a
 * clock read in render, so this stays a pure function of state and does not
 * need the page re-rendering every second to be right.
 *
 * The failure count is what separates a slow validator from a chair that will
 * never take. Past a minute it stops mattering: whatever the reason, a player
 * who has waited that long should be told to move rather than kept waiting.
 */
function useChairHeld(unsecured: boolean, failures: number): "securing" | "stuck" | null {
  const [waited, setWaited] = useState<"briefly" | "a while" | "too long">("briefly");

  useEffect(() => {
    setWaited("briefly");
    if (!unsecured) return;
    const soft = setTimeout(() => setWaited("a while"), CHAIR_PATIENCE_MS);
    const hard = setTimeout(() => setWaited("too long"), CHAIR_GIVE_UP_MS);
    return () => {
      clearTimeout(soft);
      clearTimeout(hard);
    };
  }, [unsecured]);

  if (!unsecured) return null;
  if (waited === "too long") return "stuck";
  if (waited === "a while" && failures >= 2) return "stuck";
  return "securing";
}

/** A short line explaining what the table is waiting for. */
function useStatusLine(
  delegated: boolean | null,
  table: TableView | null,
  hand: HandView | null,
  seats: (SeatView | null)[],
  funded: number,
  chair: "securing" | "stuck" | null,
  quiescing: boolean,
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
  //
  // Your own chair first, since nothing else matters if you are not being dealt
  // in. Two different things wear the same face on chain, and only one of them
  // is bad news:
  //
  //   securing  the ordinary few seconds after sitting down, while the lock
  //             that makes your cards yours is written. Say what is happening
  //             and stop there.
  //   stuck     the lock will not take, which means the last player at this
  //             chair left without handing it back. A permission names one
  //             member, only that member may update it, and it outlives a
  //             pause — so the chair really is theirs and the only way in is
  //             another one. The program deals this seat out rather than
  //             dealing cards somebody else could read.
  //
  // Silent during a cash-out, where the chair is unsecured because we asked for
  // it to be, and the overlay is already saying so.
  if (chair && !quiescing) {
    return chair === "stuck"
      ? "this chair still belongs to its last player, so take another seat to be dealt in"
      : "locking your cards down";
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

/*
 * There used to be a "Not yet" page here.
 *
 * Anyone whose wallet was not fully set up had the entire table replaced by a
 * door: no felt, no players, no idea what they had been sent a link to, just a
 * refusal and two buttons. It refused people who were merely still loading, and
 * it refused people who had no intention of sitting down and only wanted to
 * watch — which a poker room has never had a reason to stop.
 *
 * The room is open now. Nothing is gated on being able to play except playing:
 * clicking a chair opens the same setup gate the lobby uses, at the step that
 * is actually missing, over the table you were looking at rather than instead
 * of it.
 */
