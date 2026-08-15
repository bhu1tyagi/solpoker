"use client";

import { AnimatePresence, motion } from "motion/react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { PlayingCard } from "@/components/primitives/PlayingCard";
import { ClockRing } from "@/components/primitives/ClockRing";
import { spring } from "@/styles/theme";
import type { SeatView } from "@/stores/table-store";
import { NO_CARD } from "@/lib/engine/cards";

interface Props {
  seat: SeatView | null;
  index: number;
  isMe: boolean;
  isTurn: boolean;
  isButton: boolean;
  dealtIn: boolean;
  /** Face-up cards: yours always, others only once shown at showdown. */
  cards: number[] | null;
  /** Winning cards to highlight, by card byte. */
  winning?: Set<number>;
  dimmed?: boolean;
  deadline: number;
  timeoutSecs: number;
  /** A hand is actually running, so per-hand labels mean something. */
  handLive?: boolean;
  onSit?: (index: number) => void;
}

export function SeatPod({
  seat,
  index,
  isMe,
  isTurn,
  isButton,
  dealtIn,
  cards,
  winning,
  dimmed,
  deadline,
  timeoutSecs,
  handLive = false,
  onSit,
}: Props) {
  const empty = !seat?.occupant;

  if (empty) {
    return (
      <motion.button
        onClick={() => onSit?.(index)}
        whileHover={{ scale: 1.04, borderColor: "var(--accent-deep)" }}
        whileTap={{ scale: 0.98 }}
        transition={spring.snappy}
        style={{
          width: 92,
          height: 62,
          borderRadius: "var(--r-card)",
          border: "1px dashed var(--line)",
          background: "rgba(0,0,0,0.22)",
          color: "var(--text-faint)",
          fontSize: "var(--t-xs)",
          cursor: onSit ? "pointer" : "default",
        }}
      >
        seat {index + 1}
      </motion.button>
    );
  }

  const status = statusOf(seat, dealtIn, handLive);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: dimmed ? 0.55 : 1, scale: isTurn ? 1.02 : 1 }}
      transition={spring.snappy}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        position: "relative",
      }}
    >
      {/* Cards sit above the pod, tucked behind it slightly. */}
      <div style={{ display: "flex", gap: 3, height: dealtIn ? undefined : 0 }}>
        <AnimatePresence>
          {dealtIn &&
            [0, 1].map((i) => {
              const card = cards?.[i];
              const known = card !== undefined && card !== NO_CARD;
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: -28, scale: 0.7 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ ...spring.deal, delay: i * 0.06 }}
                >
                  <PlayingCard
                    card={known ? card : undefined}
                    faceDown={!known}
                    size={isMe ? "md" : "sm"}
                    highlighted={known && winning?.has(card)}
                    dimmed={dimmed}
                  />
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--surface)",
          border: `1px solid ${isTurn ? "var(--accent-deep)" : "var(--line)"}`,
          borderRadius: "var(--r-card)",
          padding: "6px 10px 6px 6px",
          boxShadow: isTurn ? "var(--ring-gold)" : "var(--shadow-1)",
          minWidth: 132,
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        }}
      >
        {isTurn ? (
          <ClockRing deadline={deadline} totalSecs={timeoutSecs} size={42} thickness={2}>
            <Avatar pubkey={seat.occupant!} size={32} />
          </ClockRing>
        ) : (
          <Avatar
            pubkey={seat.occupant!}
            size={36}
            ring={isMe ? "var(--accent-deep)" : undefined}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
          <span
            style={{
              fontSize: "var(--t-xs)",
              color: isMe ? "var(--accent)" : "var(--text-dim)",
              fontWeight: isMe ? 600 : 400,
            }}
          >
            {isMe ? "you" : shortKey(seat.occupant!)}
          </span>
          <span className="tnum" style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>
            <AnimatedNumber value={seat.stack} />
          </span>
        </div>

        {isButton && <DealerButton />}
      </div>

      <AnimatePresence>
        {status && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{
              fontSize: "var(--t-xs)",
              color: status.tone,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              position: "absolute",
              bottom: -16,
            }}
          >
            {status.label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function statusOf(seat: SeatView, dealtIn: boolean, handLive: boolean) {
  if (seat.folded) return { label: "folded", tone: "var(--text-faint)" };
  if (seat.allIn) return { label: "all in", tone: "var(--accent)" };
  // Out of chips is worth saying at any time; sitting out only means something
  // once there is a hand to be sitting out of.
  if (seat.stack === 0) return { label: "no chips", tone: "var(--lose)" };
  if (handLive && !dealtIn) return { label: "sitting out", tone: "var(--text-faint)" };
  return null;
}

function DealerButton() {
  return (
    <motion.div
      layoutId="dealer-button"
      transition={spring.gentle}
      style={{
        width: 19,
        height: 19,
        borderRadius: "50%",
        background: "var(--text)",
        color: "var(--bg)",
        fontSize: 10,
        fontWeight: 700,
        display: "grid",
        placeItems: "center",
        marginLeft: 2,
        boxShadow: "var(--shadow-1)",
      }}
    >
      D
    </motion.div>
  );
}
