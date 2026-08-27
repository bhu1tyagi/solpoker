"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from "@/lib/engine/cards";
import { spring } from "@/styles/theme";

type Size = "sm" | "md" | "lg";

/**
 * Card geometry, laid out the way a real card is: an index in the top-left
 * corner — rank over suit — its mirror in the bottom-right, and one large pip
 * in the middle. The corner is what reads in a fanned or partly covered hand;
 * the pip is what reads across the table.
 */
const SIZES: Record<
  Size,
  { w: number; h: number; rank: number; suit: number; pip: number; pad: number }
> = {
  sm: { w: 40, h: 57, rank: 13, suit: 9, pip: 21, pad: 3 },
  md: { w: 56, h: 80, rank: 17, suit: 12, pip: 30, pad: 5 },
  lg: { w: 72, h: 102, rank: 21, suit: 14, pip: 40, pad: 6 },
};

/**
 * The four-colour deck, in suit order: clubs, diamonds, hearts, spades.
 *
 * This is the default rather than an option, and the reason is accessibility
 * before convention: red-versus-black is the worst possible pairing for the
 * most common colour blindness, and it is the exact pairing a poker interface
 * reaches for by default. All four are measured against --c-card-face.
 */
export const SUIT_COLORS = [
  "var(--c-suit-club)",
  "var(--c-suit-diamond)",
  "var(--c-suit-heart)",
  "var(--c-suit-spade)",
];

/** The two-colour deck, for players who switch four-colour off in settings. */
export const SUIT_COLORS_TWO = [
  "var(--c-suit-two-color-black)",
  "var(--c-suit-two-color-red)",
  "var(--c-suit-two-color-red)",
  "var(--c-suit-two-color-black)",
];

interface Props {
  /** Card byte, or NO_CARD. */
  card?: number;
  /** Show the back regardless of card. An opponent's hand is face down. */
  faceDown?: boolean;
  size?: Size;
  /** Dim it, for losing hands at showdown. */
  dimmed?: boolean;
  /** Lift and ring it, for the winning five. */
  highlighted?: boolean;
  /** Two-colour deck. Off by default; four-colour is the accessible choice. */
  twoColor?: boolean;
  className?: string;
}

export function PlayingCard({
  card,
  faceDown = false,
  size = "md",
  dimmed = false,
  highlighted = false,
  twoColor = false,
  className,
}: Props) {
  const reduce = useReducedMotion();
  const s = SIZES[size];
  const known = card !== undefined && card !== NO_CARD && card < 52;
  const showFace = known && !faceDown;

  return (
    <motion.div
      className={className}
      style={{
        width: s.w,
        height: s.h,
        perspective: 600,
        position: "relative",
      }}
      animate={{
        // Two cues, not one: the winning cards lift as well as brighten, and a
        // folded hand dims as well as turning over.
        y: highlighted ? -8 : 0,
        opacity: dimmed ? 0.4 : 1,
        filter: highlighted ? "brightness(1.06)" : "brightness(1)",
      }}
      transition={reduce ? { duration: 0.15 } : spring.snappy}
    >
      <motion.div
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transformStyle: "preserve-3d",
        }}
        initial={false}
        animate={{ rotateY: showFace ? 0 : 180 }}
        transition={reduce ? { duration: 0.15 } : spring.deal}
      >
        <Face card={card} s={s} highlighted={highlighted} twoColor={twoColor} />
        <Back s={s} />
      </motion.div>
    </motion.div>
  );
}

function Face({
  card,
  s,
  highlighted,
  twoColor,
}: {
  card?: number;
  s: (typeof SIZES)[Size];
  highlighted: boolean;
  twoColor: boolean;
}) {
  const known = card !== undefined && card !== NO_CARD && card < 52;
  const palette = twoColor ? SUIT_COLORS_TWO : SUIT_COLORS;
  const color = known ? palette[suitOf(card)] : "var(--c-ink-faint)";
  const rank = known ? RANK_CHARS[rankOf(card)].replace("T", "10") : "";
  const suit = known ? SUIT_SYMBOLS[suitOf(card)] : "";

  // The index column: rank over suit, tight as print. "10" is the one
  // two-character rank, so it drops a size to hold the same column width.
  const index = (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        lineHeight: 1,
        gap: Math.max(1, Math.round(s.rank * 0.08)),
      }}
    >
      <span
        className="num"
        style={{
          fontSize: rank === "10" ? s.rank * 0.8 : s.rank,
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: rank === "10" ? "-0.06em" : undefined,
        }}
      >
        {rank}
      </span>
      <span style={{ fontSize: s.suit, lineHeight: 1 }}>{suit}</span>
    </span>
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        borderRadius: "var(--r-card)",
        /*
         * A card is a light object on a dark table, exactly like a real one.
         * The previous deck was dark slate on dark felt, which reads as a hole
         * in the table rather than a card lying on it.
         */
        background: "var(--c-card-face)",
        // A hairline of the paper's own shadow along the bottom edge, so a
        // fanned hand shows where one card ends and the next begins.
        boxShadow: highlighted
          ? "0 0 0 2px var(--c-green), inset 0 -1px 0 var(--c-card-face-edge)"
          : "inset 0 -1px 0 var(--c-card-face-edge)",
        color,
        userSelect: "none",
      }}
    >
      {known && (
        <>
          <span style={{ position: "absolute", top: s.pad, left: s.pad + 1 }}>{index}</span>
          {/* The mirror index: the same column turned through 180°, so the
              card reads the same whichever way it lands. */}
          <span
            style={{
              position: "absolute",
              bottom: s.pad,
              right: s.pad + 1,
              transform: "rotate(180deg)",
            }}
          >
            {index}
          </span>
          {/* The pip, seated just below centre the way weight sits on printed
              stock — dead centre reads high once the corners are inked. */}
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              fontSize: s.pip,
              lineHeight: 1,
              paddingTop: s.pad,
            }}
          >
            {suit}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The back: the dark card stock with the chip ring's dash rhythm laid over it
 * at low contrast. It is the mark's geometry rather than a generic pattern,
 * and it is what makes a face-down hand read as a physical object at a glance.
 */
function Back({ s }: { s: (typeof SIZES)[Size] }) {
  const inset = Math.max(3, Math.round(s.w * 0.07));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        transform: "rotateY(180deg)",
        borderRadius: "var(--r-card)",
        background: "var(--c-card-back)",
        boxShadow: "var(--e-raised)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset,
          borderRadius: "var(--r-sm)",
          border: "1px solid color-mix(in srgb, var(--c-purple) 34%, transparent)",
          background:
            "repeating-linear-gradient(45deg, color-mix(in srgb, var(--c-purple) 16%, transparent) 0 2px, transparent 2px 7px)",
        }}
      />
    </div>
  );
}

/** An empty slot, for board positions not yet dealt. */
export function CardSlot({ size = "md" }: { size?: Size }) {
  const s = SIZES[size];
  return (
    <div
      style={{
        width: s.w,
        height: s.h,
        borderRadius: "var(--r-card)",
        // A recess in the felt, not a card: darker than the table, no rim-light.
        background: "color-mix(in srgb, var(--c-felt) 55%, transparent)",
        border: "1px solid var(--c-rule)",
      }}
    />
  );
}
