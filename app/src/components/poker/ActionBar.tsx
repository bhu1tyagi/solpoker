"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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

  return (
    <AnimatePresence>
      {myTurn && (
        <motion.div
          // The class carries the width: a corner panel on a desktop, the
          // whole bottom edge on a phone.
          className="action-bar"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={spring.gentle}
        >
          {la.canRaise && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* Sideways on a phone there is no row to spare; the slider
                  covers the same range the presets shortcut. */}
              <div
                className="bar-presets"
                style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
              >
                {presets.map((p) => (
                  <PresetButton
                    key={p.label}
                    active={raiseTo === p.to}
                    onClick={() => setRaiseTo(p.to)}
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
                    fontSize: "var(--t-sm)",
                    color: "var(--gold)",
                    background: "var(--surface)",
                    borderRadius: "var(--r-panel)",
                    padding: "7px 14px",
                    minWidth: 76,
                    textAlign: "right",
                  }}
                >
                  {raiseTo.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min={la.minRaiseTo}
                max={la.maxRaiseTo}
                step={1}
                value={raiseTo}
                onChange={(e) => setRaiseTo(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <BigButton
              tone="danger"
              disabled={busy}
              onClick={() => onAct("fold", 0)}
              flex={1}
            >
              Fold
            </BigButton>

            {la.canCheck ? (
              <BigButton
                tone="dark"
                disabled={busy}
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

            {la.canRaise && (
              <BigButton
                tone="accent"
                disabled={busy}
                onClick={() => onAct(raiseTo >= la.maxRaiseTo ? "allin" : "raise", raiseTo)}
                flex={1.35}
              >
                {raiseTo >= la.maxRaiseTo
                  ? "All in"
                  : hand?.currentBet
                    ? `Raise ${raiseTo.toLocaleString()}`
                    : `Bet ${raiseTo.toLocaleString()}`}
              </BigButton>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
        background: active ? "var(--gold)" : "var(--surface)",
        color: active ? "var(--on-gold)" : "var(--text-dim)",
        border: "none",
        borderRadius: "var(--r-panel)",
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

const TONES = {
  danger: {
    background: "var(--lose)",
    color: "var(--on-danger)",
  },
  accent: {
    background: "var(--gold)",
    color: "var(--on-gold)",
  },
  dark: {
    background: "var(--control)",
    color: "var(--text)",
  },
} as const;

/** The three verbs. Flat, wide, and unmistakable at arm's length. */
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
      className="tnum"
      style={{
        ...TONES[tone],
        flex,
        height: 52,
        border: "none",
        borderRadius: "var(--r-panel)",
        fontFamily: "var(--font-display)",
        fontSize: "var(--t-sm)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </motion.button>
  );
}
