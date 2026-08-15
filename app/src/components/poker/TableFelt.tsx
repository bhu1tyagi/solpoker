"use client";

import { AnimatePresence, motion } from "motion/react";
import { PlayingCard, CardSlot } from "@/components/primitives/PlayingCard";
import { ChipStack } from "@/components/primitives/Chip";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { SeatPod } from "./SeatPod";
import { BET_POSITIONS, POT_POSITION, SEAT_POSITIONS, spring, stagger } from "@/styles/theme";
import { MAX_SEATS, NO_SEAT, STREET_NAMES } from "@/lib/constants";
import { NO_CARD } from "@/lib/engine/cards";
import type { HandView, SeatView, TableView } from "@/stores/table-store";

interface Props {
  table: TableView | null;
  hand: HandView | null;
  seats: (SeatView | null)[];
  mySeat: number;
  myHole: number[] | null;
  myHoleHandNumber: number;
  pot: number;
  winning?: Set<number>;
  winners?: Set<number>;
  timeoutSecs: number;
  onSit?: (index: number) => void;
  /** Where a viewer sits determines the rotation, so you are always at the bottom. */
  status?: string;
}

export function TableFelt({
  table,
  hand,
  seats,
  mySeat,
  myHole,
  myHoleHandNumber,
  pot,
  winning,
  winners,
  timeoutSecs,
  onSit,
  status,
}: Props) {
  // Rotate the table so the local player sits at the bottom. Spectators get the
  // natural order.
  const view = (i: number) => (mySeat >= 0 ? (i - mySeat + MAX_SEATS) % MAX_SEATS : i);

  const board = hand?.board ?? [NO_CARD, NO_CARD, NO_CARD, NO_CARD, NO_CARD];
  const dealt = (i: number) => (hand ? (hand.dealtIn & (1 << i)) !== 0 : false);
  const revealed = (i: number) =>
    hand && hand.revealedMask & (1 << i) ? hand.revealed[i] : null;

  const handLive = table?.state === 1;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 940,
        aspectRatio: "16 / 10",
        margin: "0 auto",
      }}
    >
      {/* The felt: a padded rail around a lit oval. The light sits slightly
          above centre so the board reads as the brightest thing on the table. */}
      <div
        style={{
          position: "absolute",
          inset: "8% 4%",
          borderRadius: "50% / 50%",
          background: "linear-gradient(180deg, #16241c 0%, #0c1712 100%)",
          padding: 14,
          boxShadow:
            "0 26px 70px rgba(0,0,0,0.6), inset 0 1px 0 rgba(216,179,106,0.10)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 14,
            borderRadius: "50% / 50%",
            background:
              "radial-gradient(ellipse at 50% 40%, #17492f 0%, var(--felt-hi) 42%, var(--felt-lo) 78%, #091a12 100%)",
            boxShadow:
              "inset 0 10px 40px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(0,0,0,0.5)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 26,
            borderRadius: "50% / 50%",
            border: "1px solid rgba(216,179,106,0.13)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Board and pot, centred. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "44%",
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {board.map((card, i) => (
            <div key={i}>
              {card === NO_CARD ? (
                <CardSlot size="lg" />
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: -14, rotateY: 180 }}
                  animate={{ opacity: 1, y: 0, rotateY: 0 }}
                  transition={{ ...spring.deal, delay: (i % 3) * stagger.board }}
                >
                  <PlayingCard
                    card={card}
                    size="lg"
                    highlighted={winning?.has(card)}
                  />
                </motion.div>
              )}
            </div>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {pot > 0 && (
            <motion.div
              key="pot"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring.snappy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(0,0,0,0.35)",
                borderRadius: 999,
                padding: "5px 14px",
                border: "1px solid rgba(216,179,106,0.16)",
              }}
            >
              <span
                style={{
                  fontSize: "var(--t-xs)",
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.09em",
                }}
              >
                pot
              </span>
              <span
                className="tnum"
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--t-md)",
                  color: "var(--accent)",
                }}
              >
                <AnimatedNumber value={pot} />
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <span
          style={{
            fontSize: "var(--t-xs)",
            color: "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            minHeight: 14,
          }}
        >
          {status ?? (handLive && hand ? STREET_NAMES[hand.street] : "waiting")}
        </span>
      </div>

      {/* Seats. */}
      {Array.from({ length: MAX_SEATS }, (_, i) => {
        const pos = SEAT_POSITIONS[view(i)];
        const isMe = i === mySeat;
        const cards = isMe
          ? myHoleHandNumber === hand?.handNumber
            ? myHole
            : null
          : revealed(i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <SeatPod
              seat={seats[i]}
              index={i}
              isMe={isMe}
              isTurn={hand?.toAct === i && handLive}
              isButton={table?.button === i}
              dealtIn={dealt(i)}
              cards={cards}
              winning={winning}
              dimmed={
                winners !== undefined && winners.size > 0 && !winners.has(i) && dealt(i)
              }
              deadline={hand?.deadline ?? 0}
              timeoutSecs={timeoutSecs}
              handLive={handLive}
              onSit={onSit}
            />
          </div>
        );
      })}

      {/* Chips each seat has put in on this street, on their way to the pot. */}
      {Array.from({ length: MAX_SEATS }, (_, i) => {
        const seat = seats[i];
        if (!seat || seat.committedStreet <= 0) return null;
        const pos = BET_POSITIONS[view(i)];
        return (
          <motion.div
            key={`bet-${i}`}
            layoutId={`bet-${i}`}
            initial={{
              left: `${SEAT_POSITIONS[view(i)].x}%`,
              top: `${SEAT_POSITIONS[view(i)].y}%`,
              opacity: 0,
            }}
            animate={{ left: `${pos.x}%`, top: `${pos.y}%`, opacity: 1 }}
            exit={{
              left: `${POT_POSITION.x}%`,
              top: `${POT_POSITION.y}%`,
              opacity: 0,
              scale: 0.6,
            }}
            transition={spring.snappy}
            style={{ position: "absolute", transform: "translate(-50%, -50%)" }}
          >
            <ChipStack amount={seat.committedStreet} size={15} compact />
          </motion.div>
        );
      })}
    </div>
  );
}
