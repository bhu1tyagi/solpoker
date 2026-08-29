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

  const canCall = myTurn && la.canCall;
  const raiseLabel = !sizingLive
    ? "raise"
    : raiseTo >= la.maxRaiseTo
      ? "all in"
      : hand?.currentBet
        ? `raise to ${raiseTo.toLocaleString()}`
        : `bet ${raiseTo.toLocaleString()}`;

  return (
    <motion.div
      // The betting console, laid out as the reference client draws it: the
      // sizing card on the left — BET AMOUNT, the figure, the slider, the
      // pot-fraction presets — and the four verbs beside it.
      //
      // Always mounted, all of it. The bar used to appear only on your turn,
      // and the moment between turns read as the controls being gone rather
      // than waiting. A real client keeps the whole console standing, so
      // this one does too: the parts that cannot act simply sleep.
      className="action-bar"
      initial={false}
      animate={{ opacity: myTurn ? 1 : 0.8 }}
      transition={spring.gentle}
    >
      <div
        className="bar-sizing"
        style={{
          opacity: sizingLive ? 1 : 0.35,
          pointerEvents: sizingLive ? undefined : "none",
        }}
        aria-hidden={!sizingLive}
      >
        {shownPresets.map((p) => (
          <PresetButton
            key={p.label}
            active={sizingLive && raiseTo === p.to}
            onClick={() => sizingLive && setRaiseTo(p.to)}
          >
            {p.label}
          </PresetButton>
        ))}
        <input
          type="range"
          className="bar-slider"
          min={sizingLive ? la.minRaiseTo : 0}
          max={sizingLive ? la.maxRaiseTo : 100}
          step={1}
          value={sizingLive ? raiseTo : 0}
          disabled={!sizingLive}
          onChange={(e) => setRaiseTo(Number(e.target.value))}
          style={
            {
              flex: 1,
              minWidth: 60,
              height: 18,
              // The green fill runs exactly to the thumb.
              "--pct": sizingLive
                ? `${
                    la.maxRaiseTo > la.minRaiseTo
                      ? ((raiseTo - la.minRaiseTo) / (la.maxRaiseTo - la.minRaiseTo)) * 100
                      : 100
                  }%`
                : "0%",
            } as React.CSSProperties
          }
        />
        <span
          className="tnum bar-readout"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--t-body-sm-size)",
            fontWeight: 700,
            minWidth: 56,
            textAlign: "right",
            color: sizingLive ? "var(--c-green)" : "var(--c-ink-faint)",
          }}
        >
          {sizingLive ? raiseTo.toLocaleString() : "—"}
        </span>
      </div>

      <div className="bar-verbs">
        {/* Fold keeps its own air. A misplaced fold costs real money and there
            is no undo, so it is the one verb the thumb must not find by
            accident — the gap is the guard rail. */}
        <BigButton
          tone="dark"
          className="bar-verb-fold"
          disabled={busy || !la.canFold}
          onClick={() => onAct("fold", 0)}
          flex={1}
        >
          Fold
        </BigButton>
        <BigButton
          tone="dark"
          disabled={busy || !la.canCheck}
          onClick={() => onAct("check", seat?.committedStreet ?? 0)}
          flex={1}
        >
          Check
        </BigButton>
        <BigButton
          tone="outline"
          disabled={busy || !canCall}
          onClick={() => onAct("call", (seat?.committedStreet ?? 0) + la.callAmount)}
          flex={1}
        >
          {canCall ? `Call (${la.callAmount.toLocaleString()})` : "Call"}
        </BigButton>
        {/* On a phone this one takes a line of its own — see .bar-verbs in
            globals.css. Its label is the longest thing on the bar and the only
            one that carries a figure the player is about to commit, so it is
            the last control that may ever be clipped to make room. */}
        <BigButton
          tone="gradient"
          className="bar-verb-raise"
          disabled={busy || !la.canRaise}
          onClick={() => onAct(raiseTo >= la.maxRaiseTo ? "allin" : "raise", raiseTo)}
          flex={1.4}
        >
          {raiseLabel}
        </BigButton>
      </div>
    </motion.div>
  );
}

/** The sizing card's preset tiles: MIN, 1/3, 1/2, POT, ALL IN. */
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
        // The active size takes the purple, as the reference's ALL-IN tile
        // does — green is spoken for by the money and the raise.
        background: active ? "var(--c-purple)" : "var(--c-felt-raised)",
        color: active ? "var(--c-ink)" : "var(--c-ink-muted)",
        border: "1px solid var(--c-glass-border)",
        borderRadius: "var(--r-sm)",
        fontFamily: "var(--font-display)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        padding: "5px 9px",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </motion.button>
  );
}

/**
 * The verbs in the reference client's voice. Fold and check are quiet dark
 * tiles; call is a green outline, money-coloured but not shouting; the raise
 * is the one loud object — the brand's purple-to-green gradient — because it
 * is the action that escalates.
 */
const TONES = {
  dark: {
    background: "var(--c-glass-solid)",
    backgroundImage: "linear-gradient(var(--c-glass-fill), var(--c-glass-fill))",
    border: "1px solid var(--c-glass-border)",
    color: "var(--c-ink-muted)",
  },
  outline: {
    background: "color-mix(in srgb, var(--c-green) 6%, transparent)",
    border: "1px solid color-mix(in srgb, var(--c-green) 55%, transparent)",
    color: "var(--c-green)",
  },
  gradient: {
    background: "linear-gradient(90deg, var(--c-purple) 0%, var(--c-green) 100%)",
    border: "1px solid transparent",
    color: "var(--c-felt)",
  },
} as const;

/** The four verbs. Wide, quiet, and unmistakable at arm's length. */
function BigButton({
  tone,
  disabled,
  onClick,
  flex,
  className,
  children,
}: {
  tone: keyof typeof TONES;
  disabled?: boolean;
  onClick: () => void;
  flex: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      whileHover={disabled ? undefined : { y: -1 }}
      transition={spring.snappy}
      className={className ? `num bar-verb ${className}` : "num bar-verb"}
      style={{
        ...TONES[tone],
        flex,
        // Without this the label's own width is the floor a flex item may
        // shrink to, and four nowrap verbs simply ran off the side of a
        // phone: the raise, with the figure on it, was the half that went.
        minWidth: 0,
        padding: "0 10px",
        // A hand's height, exactly. The verbs once stretched to whatever
        // stood beside them and turned into billboards.
        height: 46,
        borderRadius: "var(--r-md)",
        fontFamily: "var(--font-display)",
        fontSize: "var(--t-body-sm-size)",
        fontWeight: tone === "gradient" ? 800 : 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        whiteSpace: "nowrap",
        boxShadow:
          tone === "gradient" && !disabled
            ? "0 0 26px rgba(20, 241, 149, 0.2)"
            : "var(--e-raised)",
      }}
    >
      {children}
    </motion.button>
  );
}
