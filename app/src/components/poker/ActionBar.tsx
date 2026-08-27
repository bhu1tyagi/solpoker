"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { spring } from "@/styles/theme";
import { legalActions, raisePresets, type LegalActions } from "@/lib/engine/legal-actions";
import type { HandView, SeatView } from "@/stores/table-store";

export type ActionKind = "fold" | "check" | "call" | "raise" | "allin";

interface Props {
  hand: HandView | null;
  seat: SeatView | null;
  seatIndex: number;
  pot: number;
  /** True while an action is in flight, so the bar locks without going blank. */
  busy: boolean;
  onAct: (kind: ActionKind, toTotal: number) => void;
}

export function ActionBar({ hand, seat, seatIndex, pot, busy, onAct }: Props) {
  const la: LegalActions = useMemo(
    () =>
      hand && seat
        ? legalActions(
            { toAct: hand.toAct, currentBet: hand.currentBet, minRaise: hand.minRaise },
            {
              inHand: seat.inHand,
              folded: seat.folded,
              allIn: seat.allIn,
              stack: seat.stack,
              committedStreet: seat.committedStreet,
              mayRaise: seat.mayRaise,
            },
            seatIndex,
          )
        : {
            canFold: false,
            canCheck: false,
            canCall: false,
            callAmount: 0,
            canRaise: false,
            minRaiseTo: 0,
            maxRaiseTo: 0,
          },
    [hand, seat, seatIndex],
  );

  const myTurn = la.canFold;
  const [raiseTo, setRaiseTo] = useState(la.minRaiseTo);

  // Reset the slider whenever the situation changes under it.
  useEffect(() => {
    setRaiseTo(la.minRaiseTo);
  }, [la.minRaiseTo, myTurn]);

  const presets = useMemo(() => {
    const sized = raisePresets(la, pot, hand?.currentBet ?? 0);
    const all = [{ label: "min", to: la.minRaiseTo }, ...sized];
    // Dedup by target, keeping the first label that lands there.
    const seen = new Set<number>();
    return all.filter((p) => (seen.has(p.to) ? false : (seen.add(p.to), true)));
  }, [la, pot, hand?.currentBet]);

  // Whether the sizing controls do anything right now. They stay on screen
  // regardless — a real client's bet controls are furniture, not a popup —
  // and simply sleep between turns.
  const sizingLive = myTurn && la.canRaise;
  // Between turns the engine has no sizes to offer; the sleeping row shows
  // the standard menu so the section keeps its shape and its meaning.
  const shownPresets = sizingLive
    ? presets
    : [
        { label: "min", to: 0 },
        { label: "1/3", to: 0 },
        { label: "1/2", to: 0 },
        { label: "pot", to: 0 },
        { label: "all in", to: 0 },
      ];

  return (
    <motion.div
      // The class carries the width: the whole band under the table on a
      // desktop, the bottom edge on a phone.
      //
      // Always mounted, all of it. The bar used to appear only on your turn,
      // and the moment between turns read as the controls being gone rather
      // than waiting. A real client keeps the whole section standing — the
      // sizing row, the amount, the slider, the verbs — so this one does
      // too: the parts that cannot act simply sleep.
      className="action-bar glass"
      initial={false}
      animate={{ opacity: myTurn ? 1 : 0.85 }}
      transition={spring.gentle}
      style={{ padding: "14px 16px" }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 12,
          opacity: sizingLive ? 1 : 0.35,
          pointerEvents: sizingLive ? undefined : "none",
          transition: "opacity 220ms ease",
        }}
        aria-hidden={!sizingLive}
      >
        {/* Sideways on a phone there is no row to spare; the slider
            covers the same range the presets shortcut. */}
        <div
          className="bar-presets"
          style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
        >
          <span
            className="label"
            style={{
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--c-ink-faint)",
              marginRight: 4,
            }}
          >
            bet amount
          </span>
          {shownPresets.map((p) => (
            <PresetButton
              key={p.label}
              active={sizingLive && raiseTo === p.to}
              onClick={() => sizingLive && setRaiseTo(p.to)}
            >
              {p.label}
            </PresetButton>
          ))}
          {/* On a phone this readout would wrap the row; the raise
              button already repeats the figure. */}
          <span
            className="tnum bar-readout"
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-display)",
              fontSize: "var(--t-body-sm-size)",
              color: sizingLive ? "var(--c-green)" : "var(--c-ink-faint)",
              fontWeight: 700,
              background: "var(--c-felt-raised)",
              borderRadius: "var(--r-lg)",
              padding: "7px 14px",
              minWidth: 76,
              textAlign: "right",
            }}
          >
            {sizingLive ? raiseTo.toLocaleString() : "—"}
          </span>
        </div>
        <input
          type="range"
          min={sizingLive ? la.minRaiseTo : 0}
          max={sizingLive ? la.maxRaiseTo : 100}
          step={1}
          value={sizingLive ? raiseTo : 0}
          disabled={!sizingLive}
          onChange={(e) => setRaiseTo(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--c-green)", height: 18 }}
        />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <BigButton
          tone="danger"
          disabled={busy || !la.canFold}
          onClick={() => onAct("fold", 0)}
          flex={1}
        >
          Fold
        </BigButton>

        {/* Check when it is legal, and also while it is not your turn: a
            quiet "Call 0" there implied money where none was asked. */}
        {la.canCheck || !myTurn ? (
          <BigButton
            tone="dark"
            disabled={busy || !la.canCheck}
            onClick={() => onAct("check", seat?.committedStreet ?? 0)}
            flex={1}
          >
            Check
          </BigButton>
        ) : (
          <BigButton
            tone="dark"
            disabled={busy || !la.canCall}
            onClick={() => onAct("call", (seat?.committedStreet ?? 0) + la.callAmount)}
            flex={1}
          >
            Call {la.callAmount.toLocaleString()}
          </BigButton>
        )}

        <BigButton
          tone="accent"
          disabled={busy || !la.canRaise}
          onClick={() => onAct(raiseTo >= la.maxRaiseTo ? "allin" : "raise", raiseTo)}
          flex={1.35}
        >
          {!myTurn || !la.canRaise
            ? "Raise"
            : raiseTo >= la.maxRaiseTo
              ? "All in"
              : hand?.currentBet
                ? `Raise ${raiseTo.toLocaleString()}`
                : `Bet ${raiseTo.toLocaleString()}`}
        </BigButton>
      </div>
    </motion.div>
  );
}

/** The sizing row's small angular buttons: MIN, 1/3, POT, ALL IN. */
function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      transition={spring.snappy}
      style={{
        background: active ? "var(--c-green)" : "var(--c-felt-raised)",
        color: active ? "var(--c-felt)" : "var(--c-ink-muted)",
        border: "none",
        borderRadius: "var(--r-lg)",
        fontFamily: "var(--font-display)",
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        padding: "8px 13px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </motion.button>
  );
}

/**
 * The verbs in the design system's own voice. One accent: the raise is the
 * only filled button, because it is the one that escalates. Fold carries its
 * meaning in an outlined wash of the loss colour rather than a red slab —
 * a slab shouted over the whole room — and check/call is quiet glass.
 */
const TONES = {
  danger: {
    background: "color-mix(in srgb, var(--c-loss) 10%, transparent)",
    border: "1px solid color-mix(in srgb, var(--c-loss) 38%, transparent)",
    color: "var(--c-loss)",
  },
  accent: {
    background: "var(--c-green)",
    border: "1px solid var(--c-green)",
    color: "var(--c-felt)",
  },
  dark: {
    background: "var(--c-glass-fill)",
    border: "1px solid var(--c-glass-border)",
    color: "var(--c-ink)",
  },
} as const;

/** The three verbs. Wide, quiet, and unmistakable at arm's length. */
function BigButton({
  tone,
  disabled,
  onClick,
  flex,
  children,
}: {
  tone: keyof typeof TONES;
  disabled?: boolean;
  onClick: () => void;
  flex: number;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      whileHover={disabled ? undefined : { y: -1 }}
      transition={spring.snappy}
      className="num"
      style={{
        ...TONES[tone],
        flex,
        height: 48,
        borderRadius: "var(--r-md)",
        fontFamily: "var(--font-display)",
        fontSize: "var(--t-body-sm-size)",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.38 : 1,
        whiteSpace: "nowrap",
        backdropFilter: "blur(8px)",
        boxShadow:
          tone === "accent" && !disabled
            ? "0 0 24px color-mix(in srgb, var(--c-green) 22%, transparent)"
            : "var(--e-raised)",
      }}
    >
      {children}
    </motion.button>
  );
}
