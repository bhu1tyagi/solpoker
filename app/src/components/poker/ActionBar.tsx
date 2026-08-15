"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/primitives/Button";
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
  const [showSlider, setShowSlider] = useState(false);

  // Reset the slider whenever the situation changes under it.
  useEffect(() => {
    setRaiseTo(la.minRaiseTo);
    if (!myTurn) setShowSlider(false);
  }, [la.minRaiseTo, myTurn]);

  const presets = useMemo(
    () => raisePresets(la, pot, hand?.currentBet ?? 0),
    [la, pot, hand?.currentBet],
  );

  return (
    <AnimatePresence>
      {myTurn && (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={spring.gentle}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-card)",
            boxShadow: "var(--shadow-2)",
            padding: 14,
            width: "100%",
            maxWidth: 560,
          }}
        >
          <AnimatePresence>
            {showSlider && la.canRaise && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.16 }}
                style={{ overflow: "hidden" }}
              >
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  {presets.map((p) => (
                    <Button
                      key={p.label}
                      size="sm"
                      variant={raiseTo === p.to ? "primary" : "ghost"}
                      onClick={() => setRaiseTo(p.to)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="range"
                    min={la.minRaiseTo}
                    max={la.maxRaiseTo}
                    step={1}
                    value={raiseTo}
                    onChange={(e) => setRaiseTo(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "var(--accent)" }}
                  />
                  <span
                    className="tnum"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "var(--t-md)",
                      color: "var(--accent)",
                      minWidth: 74,
                      textAlign: "right",
                    }}
                  >
                    {raiseTo.toLocaleString()}
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="danger"
              size="lg"
              disabled={busy}
              onClick={() => onAct("fold", 0)}
              style={{ flex: 1 }}
            >
              Fold
            </Button>

            {la.canCheck ? (
              <Button
                variant="ghost"
                size="lg"
                disabled={busy}
                onClick={() => onAct("check", seat?.committedStreet ?? 0)}
                style={{ flex: 1 }}
              >
                Check
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="lg"
                disabled={busy || !la.canCall}
                onClick={() =>
                  onAct("call", (seat?.committedStreet ?? 0) + la.callAmount)
                }
                style={{ flex: 1 }}
              >
                Call {la.callAmount.toLocaleString()}
              </Button>
            )}

            {la.canRaise && (
              <Button
                variant="primary"
                size="lg"
                disabled={busy}
                onClick={() => {
                  if (!showSlider) {
                    setShowSlider(true);
                    return;
                  }
                  onAct(raiseTo >= la.maxRaiseTo ? "allin" : "raise", raiseTo);
                }}
                style={{ flex: 1.3 }}
              >
                {showSlider
                  ? raiseTo >= la.maxRaiseTo
                    ? "All in"
                    : `Raise to ${raiseTo.toLocaleString()}`
                  : hand?.currentBet
                    ? "Raise"
                    : "Bet"}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
