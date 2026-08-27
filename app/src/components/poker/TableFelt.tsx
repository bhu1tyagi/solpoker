"use client";

import { AnimatePresence, motion } from "motion/react";
import { SPADE_PATH } from "@/components/primitives/Logo";
import { PlayingCard, CardSlot } from "@/components/primitives/PlayingCard";
import { ChipStack } from "@/components/primitives/Chip";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { SeatPod } from "./SeatPod";
import { ShuffleLoop } from "./ShuffleLoop";
import { TABLE_GEOMETRY, spring, stagger } from "@/styles/theme";
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
  /** Stand the table on end, for a phone held upright. */
  portrait?: boolean;
  /** Phone-sized seats and cards, whichever way the table stands. */
  compact?: boolean;
  /** Your seat's TEE permission is confirmed, so your hole cards are secured. */
  secured?: boolean;
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
  portrait = false,
  compact = false,
  secured,
}: Props) {
  // Rotate the table so the local player sits at the bottom. Spectators get the
  // natural order.
  const view = (i: number) => (mySeat >= 0 ? (i - mySeat + MAX_SEATS) % MAX_SEATS : i);

  // Which way the table stands decides where everything around it sits. A
  // compact table also deals the small board: full-size cards would leave no
  // clear lane between the board and the seats for bets to sit in.
  const geo = TABLE_GEOMETRY[portrait ? "portrait" : "wide"];
  const boardSize = compact ? "sm" : "lg";

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
  const displayPot = stage !== null ? (showdown?.pot ?? 0) : pot;
  const awardBySeat = new Map((showdown?.awards ?? []).map((a) => [a.seat, a.amount]));

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        maxWidth: geo.maxWidth,
        aspectRatio: geo.aspect,
        margin: "0 auto",
      }}
    >
      {/* The table, per the Superdesign "High Stakes Table" draft: a stadium
          with a broad near-black rail around deep green cloth — the one place
          the product stops being a dark UI and becomes a physical object. The
          999px radius clamps to half the short side, so the ends are true
          semicircles at any width: a pill, never a rounded rectangle. */}
      <div
        style={{
          position: "absolute",
          inset: geo.ellipseInset,
          borderRadius: 999,
          border: "12px solid var(--c-felt-rail)",
          // The cloth: lit from dead centre, falling to near-black at the rim,
          // with the draft's deep inset shadow pooling against the rail.
          background:
            "radial-gradient(circle at center, var(--c-felt-cloth) 0%, var(--c-felt-cloth-deep) 100%)",
          boxShadow:
            "inset 0 0 150px rgba(0, 0, 0, 0.8), 0 50px 100px -20px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
        }}
      >
        {/* The house mark, printed dead centre into the cloth the way the
            draft prints its brand there — low contrast, so cards and chips
            always beat it, and an empty table still says whose room this is.
            Inside the cloth's own box so the overflow clip keeps it on the
            felt. */}
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: "19%",
            opacity: 0.09,
            filter: "blur(1px)",
            color: "var(--c-ink)",
            pointerEvents: "none",
          }}
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeDasharray="20.3 12.7"
            strokeDashoffset="10.15"
          />
          <circle cx="50" cy="50" r="33" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.7" />
          <g transform="translate(50 51) scale(0.5) translate(-50 -50)">
            <path d={SPADE_PATH} fill="currentColor" />
          </g>
        </svg>
      </div>

      {/* Board and pot, centred. Absolute centring shrink-wraps to half the
          felt, so the column takes its content's width or the status line
          would fold under a small board. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: geo.boardTop,
          transform: "translate(-50%, -50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: compact ? 10 : 12,
          width: "max-content",
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
              // The draft's pot: a black pill on the cloth, label over a mono
              // green figure, bordered with the faintest hairline.
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: compact ? "3px 12px" : "4px 16px",
                borderRadius: "var(--r-pill)",
                background: "rgba(0, 0, 0, 0.6)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              <span
                className="label"
                style={{
                  fontSize: compact ? 8 : 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "rgba(255, 255, 255, 0.4)",
                  fontWeight: 800,
                }}
              >
                main pot
              </span>
              <span
                className="num"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: compact ? 13 : 17,
                  fontWeight: 700,
                  color: "var(--c-green)",
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
          <div style={{ display: "flex", gap: compact ? 4 : 6 }}>
            {board.map((card, i) => (
              <div key={i}>
                {card === NO_CARD ? (
                  <CardSlot size={boardSize} />
                ) : (
                  <motion.div
                    initial={{ opacity: 0, y: -14, rotateY: 180 }}
                    animate={{ opacity: 1, y: 0, rotateY: 0 }}
                    transition={{ ...spring.deal, delay: (i % 3) * stagger.board }}
                  >
                    <PlayingCard
                      card={card}
                      size={boardSize}
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
        const pos = geo.seats[view(i)];
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
              // Only your own seat carries the indicator: it is a claim about
              // the cards you can read, not about anybody else's.
              secured={isMe ? secured : undefined}
              avatarOn={pos.x > 50 ? "left" : "right"}
              cardsOn={pos.y < 50 ? "below" : "above"}
              // Which rail the chair waits at, so an empty one turns its back
              // to the room. The end seats are the ones at mid-height.
              side={pos.y >= 60 ? "bottom" : pos.y <= 40 ? "top" : pos.x < 50 ? "left" : "right"}
              winner={awardBySeat.has(i)}
              compact={compact}
              onSit={onSit}
            />

            {/* What this hand actually was, named, while the table compares. */}
            <AnimatePresence>
              {comparing && handNames?.has(i) && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  style={{
                    position: "absolute",
                    left: "50%",
                    transform: "translateX(-50%)",
                    bottom: compact ? -24 : -30,
                    background: winners?.has(i) ? "var(--c-win)" : "var(--c-felt-edge)",
                    color: winners?.has(i) ? "var(--c-felt)" : "var(--c-ink)",
                    borderRadius: "var(--r-lg)",
                    fontFamily: "var(--font-display)",
                    fontSize: compact ? 9 : 10,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    padding: "4px 10px",
                    whiteSpace: "nowrap",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  {handNames.get(i)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Long operations narrate themselves in a small card over the middle of
          the felt. This used to dim the entire table to near-black, which read
          as the room breaking rather than the room working — and it hid the
          seats and stacks, the things a player most wants to keep an eye on
          while they wait. Status is a note on the table, not a curtain over
          it. */}
      <AnimatePresence>
        {overlay && (
          <div
            style={{
              position: "absolute",
              inset: geo.ellipseInset,
              display: "grid",
              placeItems: "center",
              zIndex: 25,
              pointerEvents: "none",
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.25 }}
              style={{
                padding: "14px 22px",
                borderRadius: "var(--r-lg)",
                background: "var(--c-felt-raised)",
                border: "1px solid var(--c-rule-strong)",
                boxShadow: "var(--e-overlay)",
              }}
            >
              <ShuffleLoop label={overlay} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Chips each seat has put in on this street, on their way to the pot. */}
      {stage === null &&
        Array.from({ length: MAX_SEATS }, (_, i) => {
          const seat = seats[i];
          if (!seat || seat.committedStreet <= 0) return null;
          const pos = geo.bets[view(i)];
          return (
            <motion.div
              key={`bet-${i}`}
              layoutId={`bet-${i}`}
              initial={{
                left: `${geo.seats[view(i)].x}%`,
                top: `${geo.seats[view(i)].y}%`,
                opacity: 0,
              }}
              animate={{ left: `${pos.x}%`, top: `${pos.y}%`, opacity: 1 }}
              exit={{
                left: `${geo.pot.x}%`,
                top: `${geo.pot.y}%`,
                opacity: 0,
                scale: 0.6,
              }}
              transition={spring.snappy}
              style={{ position: "absolute", transform: "translate(-50%, -50%)", zIndex: 20 }}
            >
              <ChipStack amount={seat.committedStreet} size={compact ? 12 : 15} compact />
            </motion.div>
          );
        })}

      {/* The pot going home. One pile per winner, so a split reads as a split. */}
      <AnimatePresence>
        {stage === "award" &&
          (showdown?.awards ?? []).map((award) => {
            const pos = geo.seats[view(award.seat)];
            return (
              <motion.div
                key={`award-${award.seat}`}
                initial={{
                  left: `${geo.pot.x}%`,
                  top: `${geo.pot.y}%`,
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
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "var(--c-green)",
                    color: "var(--c-felt)",
                    borderRadius: "var(--r-lg)",
                    padding: "6px 13px",
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--t-body-sm-size)",
                    boxShadow: "0 0 26px color-mix(in srgb, var(--c-green) 24%, transparent)",
                  }}
                >
                  <span className="num">+{award.amount.toLocaleString()}</span>
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
            fontFamily: "var(--font-display)",
            fontSize: 12,
            color: stage ? "var(--c-green)" : "var(--c-ink-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
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
            color: "var(--c-ink-faint)",
            display: "inline-block",
          }}
        />
      ))}
    </span>
  );
}
