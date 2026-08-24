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

/**
 * Two sizes of the same plate. The full one is the desktop seat; the compact
 * one is for phones, where six full plates would bury the felt. The compact
 * numbers are load-bearing: a portrait side seat sits at 21% of the table box,
 * so its half-width must stay under that 21% on the smallest screen served.
 */
const DIMS = {
  full: {
    plateW: 220,
    bandHi: 38,
    bandLo: 26,
    avatar: 56,
    proud: 20,
    gutter: 12,
    stackFont: 17,
    nameFont: 11,
    seatFont: 13,
    tagFont: 11,
    glyph: 14,
    ringPad: 6,
    ringAvatar: 20,
  },
  compact: {
    plateW: 104,
    bandHi: 26,
    bandLo: 17,
    avatar: 32,
    proud: 11,
    gutter: 7,
    stackFont: 11,
    nameFont: 9,
    seatFont: 9,
    tagFont: 9,
    glyph: 10,
    ringPad: 4,
    ringAvatar: 12,
  },
} as const;

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
  /** The phone-sized plate. */
  compact?: boolean;
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
  compact = false,
  onSit,
}: Props) {
  const d = DIMS[compact ? "compact" : "full"];
  const empty = !seat?.occupant;
  const lit = isTurn || winner;
  // Text runs away from the avatar, so both mirrorings read the same way.
  const textAlign = avatarOn === "left" ? "flex-end" : "flex-start";

  // The avatar tile overlaps the plate's end and stands above its top edge, so
  // the two read as one object. The bands keep clear of it with padding.
  const clearance = d.avatar + d.gutter;

  const plate = (
    <div
      style={{
        position: "relative",
        width: d.plateW,
        height: d.bandHi + d.bandLo,
      }}
    >
      <div
        style={{
          position: "absolute",
          [avatarOn]: 4,
          top: -d.proud,
          width: d.avatar,
          height: d.avatar,
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
          <ClockRing
            deadline={deadline}
            totalSecs={timeoutSecs}
            size={d.avatar - d.ringPad}
            thickness={compact ? 2.5 : 3}
          >
            <Avatar pubkey={seat!.occupant!} size={d.avatar - d.ringAvatar} square />
          </ClockRing>
        ) : (
          <Avatar pubkey={seat!.occupant!} size={d.avatar} square />
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
            height: d.bandHi,
            background: bandColor(empty, lit, "hi"),
            display: "flex",
            alignItems: "center",
            justifyContent: textAlign,
            gap: compact ? 5 : 7,
            paddingLeft: avatarOn === "left" ? clearance : d.gutter,
            paddingRight: avatarOn === "right" ? clearance : d.gutter,
          }}
        >
          {avatarOn === "right" && <ChipGlyph size={d.glyph} />}
          <span
            className="num"
            style={{
              fontSize: d.stackFont,
              color: "var(--gold)",
              lineHeight: 1.32,
            }}
          >
            {empty ? "-" : <AnimatedNumber value={seat!.stack} />}
          </span>
          {avatarOn === "left" && <ChipGlyph size={d.glyph} />}
        </div>

        {/* Lower band: who it is, and which seat. */}
        <div
          style={{
            height: d.bandLo,
            background: bandColor(empty, lit, "lo"),
            display: "flex",
            alignItems: "center",
            flexDirection: avatarOn === "left" ? "row" : "row-reverse",
            justifyContent: "space-between",
            gap: 8,
            paddingLeft: avatarOn === "left" ? clearance : d.gutter,
            paddingRight: avatarOn === "right" ? clearance : d.gutter,
            position: "relative",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: d.seatFont,
              color: "var(--text-dim)",
              opacity: 0.88,
            }}
          >
            {index + 1}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: d.nameFont,
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
                  padding: compact ? "0 8px" : "0 12px",
                  fontFamily: "var(--font-display)",
                  fontSize: d.tagFont,
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

      {isButton && (
        <DealerButton on={avatarOn === "left" ? "right" : "left"} small={compact} />
      )}
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
          paddingTop: d.proud,
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
        paddingTop: d.proud,
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
          marginBottom: cardsOn === "above" ? (compact ? -10 : -14) : 0,
          marginTop: cardsOn === "below" ? (compact ? -8 : -10) : 0,
          marginLeft: avatarOn === "left" ? d.avatar + (compact ? 4 : 8) : 0,
          marginRight: avatarOn === "right" ? d.avatar + (compact ? 4 : 8) : 0,
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
                    size={isMe && !compact ? "md" : "sm"}
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
          filter: winner
            ? "drop-shadow(0 0 12px var(--win-glow))"
            : lit
              ? "drop-shadow(0 0 12px var(--accent-glow))"
              : undefined,
        }}
      >
        {plate}
        {/* The physical pile is a desktop luxury; on a phone the plate's
            figure carries the same fact in a tenth of the width. */}
        {!compact && seat!.stack > 0 && (
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

function DealerButton({ on, small = false }: { on: "left" | "right"; small?: boolean }) {
  const size = small ? 16 : 20;
  return (
    <motion.div
      layoutId="dealer-button"
      transition={spring.gentle}
      style={{
        position: "absolute",
        [on]: small ? -7 : -9,
        bottom: small ? -7 : -9,
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--gold)",
        color: "var(--on-gold)",
        fontSize: small ? 9 : 10,
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
