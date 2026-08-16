"use client";

import { AnimatePresence, motion } from "motion/react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { PlayingCard } from "@/components/primitives/PlayingCard";
import { ChipGlyph, ChipStack } from "@/components/primitives/Chip";
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
  /** Largest stack on the table, so piles are drawn to the same scale. */
  stackReference?: number;
  /** Which side the chip pile sits on, so it faces away from the felt. */
  chipsOn?: "left" | "right";
  /**
   * Which side the cards sit on. Seats along the top of the table deal their
   * cards downward, toward the felt, or the cards would run off the screen.
   */
  cardsOn?: "above" | "below";
  /** This seat just won something, so the plate celebrates briefly. */
  winner?: boolean;
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
  stackReference,
  chipsOn = "right",
  cardsOn = "above",
  winner = false,
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
        className="plaque"
        style={{
          width: 96,
          height: 56,
          border: "1px dashed var(--line)",
          background: "rgba(0,0,0,0.22)",
          color: "var(--text-faint)",
          fontSize: "var(--t-xs)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
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
        flexDirection: cardsOn === "below" ? "column-reverse" : "column",
        alignItems: "center",
        gap: 4,
        position: "relative",
      }}
    >
      {/* Cards sit on the felt side of the plate, tucked behind it slightly. */}
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

      {/* The plate, with the seat's pile beside it rather than over it. The
          pile faces away from the felt so it never lands on the name, the
          cards, or another seat's chips. */}
      <div
        style={{
          display: "flex",
          flexDirection: chipsOn === "left" ? "row-reverse" : "row",
          alignItems: "flex-end",
          gap: 6,
        }}
      >
      <motion.div
        className="plaque"
        animate={{
          scale: winner ? [1, 1.06, 1] : 1,
        }}
        transition={winner ? { duration: 0.6, times: [0, 0.4, 1] } : spring.snappy}
        style={{
          background: winner
            ? "var(--accent)"
            : isTurn
              ? "var(--accent)"
              : "var(--line)",
          padding: 1,
          filter:
            isTurn || winner ? "drop-shadow(0 0 10px var(--accent-glow))" : undefined,
          transition: "filter 0.2s ease",
        }}
      >
        <div
          className="plaque"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: "var(--plate)",
            padding: "7px 14px 7px 8px",
            minWidth: 138,
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

          <div style={{ display: "flex", flexDirection: "column", gap: 2, lineHeight: 1.15 }}>
            <span
              className="tnum"
              style={{
                fontSize: "var(--t-base)",
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <AnimatedNumber value={seat.stack} />
              <ChipGlyph size={13} />
            </span>
            <span
              style={{
                fontSize: 10,
                color: isMe ? "var(--accent)" : "var(--text-dim)",
                fontWeight: isMe ? 700 : 500,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
              }}
            >
              {isMe ? "you" : shortKey(seat.occupant!)}
            </span>
          </div>

          {isButton && <DealerButton />}
        </div>
      </motion.div>

        {seat.stack > 0 && (
          <div style={{ paddingBottom: 3, opacity: 0.92 }}>
            <ChipStack
              amount={seat.stack}
              size={12}
              showAmount={false}
              reference={stackReference}
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {status && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="plaque"
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: status.fg,
              background: status.bg,
              padding: "3px 12px",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              position: "absolute",
              bottom: -18,
              whiteSpace: "nowrap",
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
  const quiet = { bg: "rgba(0,0,0,0.5)", fg: "var(--text-dim)" };
  if (seat.folded) return { label: "fold", bg: "var(--grad-danger)", fg: "var(--on-danger)" };
  if (seat.allIn) return { label: "all in", bg: "var(--grad-accent)", fg: "var(--on-accent)" };
  // Out of chips is worth saying at any time; sitting out only means something
  // once there is a hand to be sitting out of.
  if (seat.stack === 0) return { label: "no chips", bg: "rgba(0,0,0,0.5)", fg: "var(--lose)" };
  if (handLive && !dealtIn) return { label: "sitting out", ...quiet };
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
        background: "var(--grad-accent)",
        color: "var(--on-accent)",
        fontSize: 10,
        fontWeight: 800,
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
