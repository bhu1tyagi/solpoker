"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from "@/lib/engine/cards";
import { spring } from "@/styles/theme";

type Size = "sm" | "md" | "lg";

/**
 * Card geometry, in the proportions the design spec draws: a 96 by 136 slab for
 * the board, smaller ones for hands. The rank is set large and low, with the
 * suit above it, so a fanned hand reads from the top corner.
 */
const SIZES: Record<Size, { w: number; h: number; rank: number; suit: number }> = {
  sm: { w: 40, h: 57, rank: 24, suit: 11 },
  md: { w: 56, h: 80, rank: 32, suit: 14 },
  lg: { w: 72, h: 102, rank: 40, suit: 17 },
};

/** The four colour deck, straight from the spec. */
export const SUIT_COLORS = [
  "var(--suit-clubs)",
  "var(--suit-diamonds)",
  "var(--suit-hearts)",
  "var(--suit-spades)",
];

interface Props {
  /** Card byte, or NO_CARD. */
  card?: number;
  /** Show the back regardless of card. An opponent's hand is face down. */
  faceDown?: boolean;
  size?: Size;
  /** Dim it, for losing hands at showdown. */
  dimmed?: boolean;
  /** Lift and glow it, for the winning five. */
  highlighted?: boolean;
  className?: string;
}

export function PlayingCard({
  card,
  faceDown = false,
  size = "md",
  dimmed = false,
  highlighted = false,
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
        y: highlighted ? -8 : 0,
        opacity: dimmed ? 0.4 : 1,
        filter: highlighted ? "brightness(1.1)" : "brightness(1)",
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
        <Face card={card} s={s} highlighted={highlighted} />
        <Back s={s} />
      </motion.div>
    </motion.div>
  );
}

function Face({
  card,
  s,
  highlighted,
}: {
  card?: number;
  s: (typeof SIZES)[Size];
  highlighted: boolean;
}) {
  const known = card !== undefined && card !== NO_CARD && card < 52;
  const color = known ? SUIT_COLORS[suitOf(card)] : "var(--text-faint)";
  const rank = known ? RANK_CHARS[rankOf(card)].replace("T", "10") : "";
  const suit = known ? SUIT_SYMBOLS[suitOf(card)] : "";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        borderRadius: "var(--r-card)",
        // Lit from the bottom edge, as the spec's radial gradient does.
        background:
          "radial-gradient(98.12% 100% at 50% 100%, var(--card-hi) 0%, var(--card-lo) 100%)",
        color,
        boxShadow: highlighted
          ? "0 0 0 1px var(--accent), 0 0 20px var(--accent-glow), var(--card-shadow)"
          : "var(--card-shadow)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: s.rank * 0.06,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: s.suit, lineHeight: 1 }}>{suit}</span>
      <span
        style={{
          // The wordmark face, on purpose. These cards were drawn around Dela
          // Gothic's heavy single weight — when the display token moved to
          // Bricolage the ranks thinned out and the deck stopped looking like
          // itself. `--font-wordmark` is where Dela lives now.
          fontFamily: "var(--font-wordmark)",
          fontSize: rank === "10" ? s.rank * 0.78 : s.rank,
          lineHeight: 1.08,
          letterSpacing: "-0.02em",
        }}
      >
        {rank}
      </span>
    </div>
  );
}

/**
 * The back: an outer slab with a lighter inset panel, both lit from below.
 * Two layers rather than a pattern, which is what makes a face-down hand read
 * as a physical object at a glance.
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
        background:
          "radial-gradient(98.12% 100% at 50% 100%, var(--card-hi) 0%, var(--card-lo) 100%)",
        boxShadow: "var(--card-shadow)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset,
          borderRadius: 2,
          background:
            "radial-gradient(98.12% 100% at 50% 100%, var(--card-back-hi) 0%, var(--card-back-lo) 100%)",
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
        background: "rgba(7, 12, 15, 0.24)",
        boxShadow: "inset 0 1px 0 rgba(114, 127, 135, 0.1)",
      }}
    />
  );
}
