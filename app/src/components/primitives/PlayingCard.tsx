"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from "@/lib/engine/cards";
import { spring } from "@/styles/theme";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, { w: number; h: number; rank: number; suit: number }> = {
  sm: { w: 34, h: 46, rank: 20, suit: 10 },
  md: { w: 48, h: 66, rank: 30, suit: 13 },
  lg: { w: 64, h: 88, rank: 42, suit: 16 },
};

/** The four colour deck: every suit its own colour, so a flush reads at a glance. */
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
        y: highlighted ? -6 : 0,
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
        borderRadius: 8,
        background: "linear-gradient(180deg, var(--card-face-hi), var(--card-face-lo))",
        border: "1px solid var(--card-line)",
        color,
        boxShadow: highlighted
          ? "0 0 0 1px var(--accent), 0 0 18px var(--accent-glow), var(--shadow-1)"
          : "var(--shadow-1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        lineHeight: 1,
        userSelect: "none",
      }}
    >
      <span style={{ fontSize: s.suit, opacity: 0.95 }}>{suit}</span>
      <span
        className="tnum"
        style={{
          fontSize: rank === "10" ? s.rank * 0.82 : s.rank,
          fontWeight: 800,
          letterSpacing: "-0.03em",
        }}
      >
        {rank}
      </span>
    </div>
  );
}

function Back({ s }: { s: (typeof SIZES)[Size] }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        transform: "rotateY(180deg)",
        borderRadius: 8,
        background: "var(--card-back)",
        boxShadow: "var(--shadow-1)",
        border: "1px solid var(--card-back-line)",
        overflow: "hidden",
      }}
    >
      {/* A mint lattice, faint enough to read as texture rather than pattern. */}
      <div
        style={{
          position: "absolute",
          inset: 3,
          borderRadius: 5,
          border: "1px solid var(--card-back-line)",
          backgroundImage: `repeating-linear-gradient(45deg, var(--card-back-line) 0 1px, transparent 1px ${Math.round(s.w / 6)}px),
                            repeating-linear-gradient(-45deg, var(--card-back-line) 0 1px, transparent 1px ${Math.round(s.w / 6)}px)`,
          opacity: 0.5,
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
        borderRadius: 8,
        border: "1px dashed var(--line)",
        background: "rgba(0, 0, 0, 0.16)",
      }}
    />
  );
}
