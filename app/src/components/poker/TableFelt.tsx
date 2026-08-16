"use client";

import { AnimatePresence, motion } from "motion/react";
import { PlayingCard, CardSlot } from "@/components/primitives/PlayingCard";
import { ChipStack } from "@/components/primitives/Chip";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { SeatPod } from "./SeatPod";
import { ShuffleLoop } from "./ShuffleLoop";
import { BET_POSITIONS, POT_POSITION, SEAT_POSITIONS, spring, stagger } from "@/styles/theme";
import { MAX_SEATS, STREET_NAMES } from "@/lib/constants";
import { NO_CARD } from "@/lib/engine/cards";
import type { HandView, SeatView, TableView } from "@/stores/table-store";
import type { Award, ShowdownStage } from "@/hooks/use-showdown-sequence";

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
  /** The table is working on something invisible, so show it shuffling. */
  working?: boolean;
  /** A long operation with steps, drawn over the felt. */
  overlay?: string;
  /** The end-of-hand sequence: reveal, compare, award. */
  showdown?: {
    stage: ShowdownStage;
    awards: Award[];
    pot: number;
    shown: Set<number>;
    /** Who was in the hand, kept from before settlement cleared it. */
    dealtIn: number;
  };
  /** Named hands at showdown, by seat, shown under each pod. */
  handNames?: Map<number, string>;
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
  working = false,
  overlay,
  showdown,
  handNames,
}: Props) {
  // Rotate the table so the local player sits at the bottom. Spectators get the
  // natural order.
  const view = (i: number) => (mySeat >= 0 ? (i - mySeat + MAX_SEATS) % MAX_SEATS : i);

  const stage = showdown?.stage ?? null;
  const handLive = table?.state === 1;
  // Between hands the previous board is stale. It stays up through the
  // showdown, because that is what everyone is looking at, and clears once the
  // table is genuinely waiting for the next one.
  const showBoard = handLive || stage !== null;

  const board = showBoard
    ? (hand?.board ?? [NO_CARD, NO_CARD, NO_CARD, NO_CARD, NO_CARD])
    : [NO_CARD, NO_CARD, NO_CARD, NO_CARD, NO_CARD];
  const dealt = (i: number) => {
    if (!hand) return false;
    // Settlement clears the mask on chain, so through the showdown the cards
    // stay on the table on the strength of the copy taken while it was live.
    if (stage !== null) return ((showdown?.dealtIn ?? 0) & (1 << i)) !== 0;
    if (!handLive) return false;
    return (hand.dealtIn & (1 << i)) !== 0;
  };

  /**
   * Whose cards are face up.
   *
   * During the reveal beat only the seats turned over so far are shown, so the
   * hands arrive one at a time instead of all at once. Outside the sequence,
   * anything the chain says was revealed is shown, which is what a reload
   * mid-showdown needs.
   */
  const revealed = (i: number) => {
    if (!hand || !(hand.revealedMask & (1 << i))) return null;
    if (stage === "reveal" && showdown && !showdown.shown.has(i)) return null;
    return hand.revealed[i];
  };

  /**
   * Your own two cards.
   *
   * Settlement wipes the hole-card account, so from that moment the live copy
   * is blank and your hand would turn face down exactly when the showdown is
   * asking you to compare it. What the chain revealed stands in, which is the
   * same two cards, and it needs no stagger because you have been looking at
   * them all along.
   */
  const myCards = () => {
    const liveHole =
      myHoleHandNumber === hand?.handNumber && myHole && myHole[0] !== NO_CARD
        ? myHole
        : null;
    if (liveHole) return liveHole;
    if (!hand || !(hand.revealedMask & (1 << mySeat))) return null;
    return hand.revealed[mySeat];
  };

  // The comparison only lights up once every hand is face up. Highlighting the
  // winner while cards are still turning over gives the ending away.
  const comparing = stage === "compare" || stage === "award";
  const highlight = stage === null || comparing ? winning : undefined;
  const dimLosers = stage === null || comparing;

  // Every pile is drawn against the biggest stack at the table.
  const stackReference = Math.max(1, ...seats.map((s) => s?.stack ?? 0));
  const displayPot = stage !== null ? (showdown?.pot ?? 0) : pot;
  const awardBySeat = new Map((showdown?.awards ?? []).map((a) => [a.seat, a.amount]));

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: 980,
        aspectRatio: "16 / 10",
        margin: "0 auto",
      }}
    >
      {/* The felt: a padded rail around a lit oval. The light sits slightly
          above centre so the board reads as the brightest thing on the table.
          It is inset far enough that the seat plates sit on the rail rather
          than across the cloth. */}
      <div
        style={{
          position: "absolute",
          inset: "13% 9%",
          borderRadius: "50% / 50%",
          background: "linear-gradient(180deg, var(--felt-rail-hi) 0%, var(--felt-rail-lo) 100%)",
          padding: 14,
          boxShadow:
            "0 26px 70px rgba(3,8,14,0.6), inset 0 1px 0 var(--accent-soft)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 14,
            borderRadius: "50% / 50%",
            background:
              "radial-gradient(var(--felt-speck) 1px, transparent 1.4px), radial-gradient(ellipse at 50% 40%, var(--felt-glow) 0%, var(--felt-hi) 42%, var(--felt-lo) 78%, var(--felt-edge) 100%)",
            backgroundSize: "22px 22px, 100% 100%",
            boxShadow:
              "inset 0 10px 40px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(0,0,0,0.5)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 26,
            borderRadius: "50% / 50%",
            border: "1px solid var(--accent-soft)",
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
        {/* Settlement zeroes the live pot, so through the reveal and the
            comparison the figure comes from the snapshot taken just before it.
            It disappears when the chips themselves fly to the winner. */}
        <AnimatePresence mode="wait">
          {displayPot > 0 && stage !== "award" && (
            <motion.div
              key="pot"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring.snappy}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: "var(--t-xs)",
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                }}
              >
                total pot :
              </span>
              <span
                className="tnum"
                style={{
                  fontSize: "var(--t-md)",
                  fontWeight: 800,
                  color: "var(--text)",
                  letterSpacing: "0.04em",
                }}
              >
                <AnimatedNumber value={displayPot} />
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {working && !handLive && stage === null ? (
          <div style={{ padding: "6px 0 2px" }}>
            <ShuffleLoop />
          </div>
        ) : (
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
                      highlighted={highlight?.has(card)}
                    />
                  </motion.div>
                )}
              </div>
            ))}
          </div>
        )}

        <StatusLine
          stage={stage}
          fallback={status ?? (handLive && hand ? STREET_NAMES[hand.street] : "waiting")}
        />
      </div>

      {/* Seats. */}
      {Array.from({ length: MAX_SEATS }, (_, i) => {
        const pos = SEAT_POSITIONS[view(i)];
        const isMe = i === mySeat;
        const cards = isMe ? myCards() : revealed(i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: "translate(-50%, -50%)",
              zIndex: hand?.toAct === i && handLive ? 12 : 10,
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
              winning={highlight}
              dimmed={
                dimLosers &&
                winners !== undefined &&
                winners.size > 0 &&
                !winners.has(i) &&
                dealt(i)
              }
              deadline={hand?.deadline ?? 0}
              timeoutSecs={timeoutSecs}
              handLive={handLive}
              stackReference={stackReference}
              chipsOn={pos.x > 50 ? "right" : "left"}
              cardsOn={pos.y < 50 ? "below" : "above"}
              winner={awardBySeat.has(i)}
              onSit={onSit}
            />

            {/* What this hand actually was, named, while the table compares. */}
            <AnimatePresence>
              {comparing && handNames?.has(i) && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="plaque"
                  style={{
                    position: "absolute",
                    left: "50%",
                    transform: "translateX(-50%)",
                    bottom: -38,
                    background: winners?.has(i)
                      ? "var(--grad-accent)"
                      : "rgba(0,0,0,0.6)",
                    color: winners?.has(i) ? "var(--on-accent)" : "var(--text-dim)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "3px 10px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {handNames.get(i)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <AnimatePresence>
        {overlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              position: "absolute",
              inset: "13% 9%",
              borderRadius: "50% / 50%",
              background: "rgba(6, 10, 15, 0.72)",
              backdropFilter: "blur(3px)",
              display: "grid",
              placeItems: "center",
              zIndex: 25,
            }}
          >
            <ShuffleLoop label={overlay} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chips each seat has put in on this street, on their way to the pot. */}
      {stage === null &&
        Array.from({ length: MAX_SEATS }, (_, i) => {
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
              style={{ position: "absolute", transform: "translate(-50%, -50%)", zIndex: 20 }}
            >
              <ChipStack amount={seat.committedStreet} size={15} compact />
            </motion.div>
          );
        })}

      {/* The pot going home. One pile per winner, so a split reads as a split. */}
      <AnimatePresence>
        {stage === "award" &&
          (showdown?.awards ?? []).map((award) => {
            const pos = SEAT_POSITIONS[view(award.seat)];
            return (
              <motion.div
                key={`award-${award.seat}`}
                initial={{
                  left: `${POT_POSITION.x}%`,
                  top: `${POT_POSITION.y}%`,
                  opacity: 0,
                  scale: 0.8,
                }}
                animate={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  opacity: 1,
                  scale: 1,
                }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 150, damping: 20 }}
                style={{
                  position: "absolute",
                  transform: "translate(-50%, -50%)",
                  zIndex: 30,
                  pointerEvents: "none",
                }}
              >
                <div
                  className="plaque"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "var(--grad-accent)",
                    color: "var(--on-accent)",
                    padding: "5px 12px",
                    fontSize: "var(--t-sm)",
                    fontWeight: 800,
                    boxShadow: "0 0 26px var(--accent-glow)",
                  }}
                >
                  <span className="tnum">+{award.amount.toLocaleString()}</span>
                </div>
              </motion.div>
            );
          })}
      </AnimatePresence>
    </div>
  );
}

/** What the table is doing, in words, under the board. */
function StatusLine({ stage, fallback }: { stage: ShowdownStage; fallback: string }) {
  const label =
    stage === "reveal"
      ? "showing hands"
      : stage === "compare"
        ? "comparing"
        : stage === "award"
          ? "paying the winner"
          : fallback;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 16 }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.18 }}
          style={{
            fontSize: "var(--t-xs)",
            color: stage ? "var(--accent)" : "var(--text-faint)",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontWeight: 600,
          }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
      {/* Anything the table is waiting on gets a pulse, so a slow moment never
          looks like a stuck one. */}
      {isWaiting(label) && <WaitingDots />}
    </div>
  );
}

const SETTLED_LABELS = new Set(["preflop", "flop", "turn", "river", "showdown"]);
const isWaiting = (label: string) => !SETTLED_LABELS.has(label);

function WaitingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.18 }}
          style={{
            width: 3,
            height: 3,
            borderRadius: "50%",
            background: "currentColor",
            color: "var(--text-faint)",
            display: "inline-block",
          }}
        />
      ))}
    </span>
  );
}
