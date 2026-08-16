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

/**
 * A seat, built the way the design spec draws it.
 *
 * The plate is two frosted bands: a taller lighter one carrying the stack and
 * the chip mark, and a shorter darker one carrying the name and the seat
 * number. A square avatar tile sits at the table-facing end and stands proud of
 * the plate's top edge, and the text runs away from it, so a seat on the left
 * of the table mirrors one on the right.
 *
 * An empty seat is the same plate with its bands dimmed and the avatar tile
 * replaced by a cyan square with a plus in it, which is the invitation to sit.
 */

const PLATE_W = 220;
const BAND_HI = 38;
const BAND_LO = 26;
const PLATE_H = BAND_HI + BAND_LO;
const AVATAR = 56;
/** How far the avatar tile stands above the plate. */
const PROUD = 20;

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
  /** Which end the avatar tile sits at. It faces the middle of the table. */
  avatarOn?: "left" | "right";
  /**
   * Which side the cards sit on. Seats along the top of the table lay their
   * cards toward the felt, or the cards would run off the top of the screen.
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
  avatarOn = "left",
  cardsOn = "above",
  winner = false,
  onSit,
}: Props) {
  const empty = !seat?.occupant;
  const lit = isTurn || winner;
  // Text runs away from the avatar, so both mirrorings read the same way.
  const textAlign = avatarOn === "left" ? "flex-end" : "flex-start";

  // The avatar tile overlaps the plate's end and stands above its top edge, so
  // the two read as one object. The bands keep clear of it with padding.
  const clearance = AVATAR + 12;

  const plate = (
    <div
      style={{
        position: "relative",
        width: PLATE_W,
        height: PLATE_H,
      }}
    >
      <div
        style={{
          position: "absolute",
          [avatarOn]: 4,
          top: -PROUD,
          width: AVATAR,
          height: AVATAR,
          background: empty ? "var(--accent)" : "var(--avatar)",
          color: empty ? "var(--on-accent)" : "var(--accent)",
          // An open seat is a bubble inviting you in, with its tail pointing
          // down at the plate. A taken one is a plain tile.
          borderRadius: empty
            ? avatarOn === "left"
              ? "18px 18px 18px 4px"
              : "18px 18px 4px 18px"
            : "var(--r-panel)",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          boxShadow: "0 4px 10px rgba(7,12,15,0.45)",
          zIndex: 2,
        }}
      >
        {empty ? (
          <PlusMark />
        ) : isTurn ? (
          <ClockRing deadline={deadline} totalSecs={timeoutSecs} size={AVATAR - 6} thickness={3}>
            <Avatar pubkey={seat!.occupant!} size={AVATAR - 20} square />
          </ClockRing>
        ) : (
          <Avatar pubkey={seat!.occupant!} size={AVATAR} square />
        )}
      </div>

      <div
        style={{ height: "100%" }}
      >
        {/* Upper band: the stack, in cyan, with the chip mark beside it. The
            bands run the full width; only their contents keep clear of the
            avatar, so the plate stays one unbroken bar behind it. */}
        <div
          style={{
            height: BAND_HI,
            background: bandColor(empty, lit, "hi"),
            display: "flex",
            alignItems: "center",
            justifyContent: textAlign,
            gap: 7,
            paddingLeft: avatarOn === "left" ? clearance : 12,
            paddingRight: avatarOn === "right" ? clearance : 12,
          }}
        >
          {avatarOn === "right" && <ChipGlyph size={14} />}
          <span
            className="tnum"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              color: "var(--accent)",
              lineHeight: 1.32,
            }}
          >
            {empty ? "-" : <AnimatedNumber value={seat!.stack} />}
          </span>
          {avatarOn === "left" && <ChipGlyph size={14} />}
        </div>

        {/* Lower band: who it is, and which seat. */}
        <div
          style={{
            height: BAND_LO,
            background: bandColor(empty, lit, "lo"),
            display: "flex",
            alignItems: "center",
            flexDirection: avatarOn === "left" ? "row" : "row-reverse",
            justifyContent: "space-between",
            gap: 8,
            paddingLeft: avatarOn === "left" ? clearance : 12,
            paddingRight: avatarOn === "right" ? clearance : 12,
            position: "relative",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: "var(--text-dim)",
              opacity: 0.88,
            }}
          >
            {index + 1}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 11,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: isMe ? "var(--accent)" : "var(--text-dim)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {empty ? "open" : isMe ? "you" : shortKey(seat!.occupant!)}
          </span>

          {/* The action tag sweeps in over the lower band. */}
          <AnimatePresence>
            {!empty && statusOf(seat!, dealtIn, handLive) && (
              <motion.div
                initial={{ opacity: 0, x: avatarOn === "left" ? 12 : -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={spring.snappy}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: statusOf(seat!, dealtIn, handLive)!.bg(avatarOn),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: avatarOn === "left" ? "flex-end" : "flex-start",
                  padding: "0 12px",
                  fontFamily: "var(--font-display)",
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: statusOf(seat!, dealtIn, handLive)!.fg,
                  whiteSpace: "nowrap",
                }}
              >
                {statusOf(seat!, dealtIn, handLive)!.label}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {isButton && <DealerButton on={avatarOn === "left" ? "right" : "left"} />}
    </div>
  );

  if (empty) {
    return (
      <motion.button
        onClick={() => onSit?.(index)}
        // The plate shows a number and the word open, which is right on the
        // table but says nothing on its own. The name is what a screen reader
        // announces and what the browser tests click.
        aria-label={`Seat ${index + 1}`}
        whileHover={onSit ? { scale: 1.03 } : undefined}
        whileTap={onSit ? { scale: 0.98 } : undefined}
        transition={spring.snappy}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          paddingTop: PROUD,
          cursor: onSit ? "pointer" : "default",
        }}
      >
        {plate}
      </motion.button>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: dimmed ? 0.5 : 1, scale: isTurn ? 1.02 : 1 }}
      transition={spring.snappy}
      style={{
        display: "flex",
        flexDirection: cardsOn === "below" ? "column-reverse" : "column",
        alignItems: "center",
        paddingTop: PROUD,
        position: "relative",
      }}
    >
      {/* Cards, tucked behind the plate's edge.
          They centre over the plate's text area rather than the whole plate,
          because the avatar tile stands proud of one end and would otherwise
          cover a card. Your own hand being half hidden by your own picture is
          the one thing on this table you must always be able to read. */}
      <div
        style={{
          display: "flex",
          gap: 3,
          height: dealtIn ? undefined : 0,
          marginBottom: cardsOn === "above" ? -14 : 0,
          marginTop: cardsOn === "below" ? -10 : 0,
          marginLeft: avatarOn === "left" ? AVATAR + 8 : 0,
          marginRight: avatarOn === "right" ? AVATAR + 8 : 0,
          zIndex: 0,
        }}
      >
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

      <motion.div
        animate={{ scale: winner ? [1, 1.05, 1] : 1 }}
        transition={winner ? { duration: 0.6, times: [0, 0.4, 1] } : spring.snappy}
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 6,
          zIndex: 1,
          filter: lit ? "drop-shadow(0 0 12px var(--accent-glow))" : undefined,
        }}
      >
        {plate}
        {seat!.stack > 0 && (
          <div style={{ paddingBottom: 2, opacity: 0.92 }}>
            <ChipStack
              amount={seat!.stack}
              size={11}
              showAmount={false}
              reference={stackReference}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Band fills: dim for an open seat, full strength for the one to act. */
function bandColor(empty: boolean, lit: boolean, band: "hi" | "lo") {
  if (empty) {
    return band === "hi" ? "var(--plate-hi-idle)" : "var(--plate-lo-idle)";
  }
  if (lit) return band === "hi" ? "var(--plate-hi)" : "var(--plate-lo)";
  // Seated but not to act: between the two, so the active seat still stands out.
  return band === "hi" ? "var(--plate-hi-taken)" : "var(--plate-lo-taken)";
}

function statusOf(seat: SeatView, dealtIn: boolean, handLive: boolean) {
  const sweep = (color: string) => (on: "left" | "right") =>
    `linear-gradient(${on === "left" ? "270deg" : "90deg"}, ${color} 12.75%, rgba(55, 71, 82, 0) 92.45%)`;

  if (seat.folded) {
    return { label: "fold", bg: sweep("var(--lose)"), fg: "var(--on-danger)" };
  }
  if (seat.allIn) {
    return { label: "all in", bg: sweep("var(--accent)"), fg: "var(--on-accent)" };
  }
  // Out of chips is worth saying at any time; sitting out only means something
  // once there is a hand to be sitting out of.
  if (seat.stack === 0) {
    return { label: "no chips", bg: sweep("rgba(237,116,131,0.7)"), fg: "var(--text)" };
  }
  if (handLive && !dealtIn) {
    return { label: "sitting out", bg: sweep("rgba(85,99,107,0.9)"), fg: "var(--text)" };
  }
  return null;
}

/** The invitation on an open seat. */
function PlusMark() {
  return (
    <span
      aria-hidden
      style={{ position: "relative", width: 16, height: 16, display: "inline-block" }}
    >
      <span
        style={{
          position: "absolute",
          left: 6.5,
          top: 0,
          width: 3,
          height: 16,
          background: "currentColor",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 6.5,
          width: 16,
          height: 3,
          background: "currentColor",
        }}
      />
    </span>
  );
}

function DealerButton({ on }: { on: "left" | "right" }) {
  return (
    <motion.div
      layoutId="dealer-button"
      transition={spring.gentle}
      style={{
        position: "absolute",
        [on]: -9,
        bottom: -9,
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "var(--accent)",
        color: "var(--on-accent)",
        fontSize: 10,
        fontWeight: 700,
        display: "grid",
        placeItems: "center",
        boxShadow: "var(--shadow-1)",
        zIndex: 3,
      }}
    >
      D
    </motion.div>
  );
}
