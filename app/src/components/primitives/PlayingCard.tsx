"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from "@/lib/engine/cards";
import { spring } from "@/styles/theme";

type Size = "sm" | "md" | "lg";

/**
 * Card geometry: the corner index (rank over suit, both corners, one rotated)
 * and a big centre pip — the anatomy of an actual playing card, which is the
 * fastest thing in the world to read because everyone has been reading it
 * their whole life. The previous design was a dark slab with a lone rank
 * floating in it, which read as a tile from some other game.
 */
const SIZES: Record<
  Size,
  { w: number; h: number; rank: number; cornerSuit: number; pip: number; pad: number }
> = {
  sm: { w: 40, h: 57, rank: 13, cornerSuit: 9, pip: 19, pad: 3 },
  md: { w: 56, h: 80, rank: 17, cornerSuit: 12, pip: 27, pad: 4 },
  lg: { w: 72, h: 102, rank: 21, cornerSuit: 14, pip: 35, pad: 6 },
};

/** The four colour deck on dark grounds (seat tags, verify view). */
export const SUIT_COLORS = [
  "var(--suit-clubs)",
  "var(--suit-diamonds)",
  "var(--suit-hearts)",
  "var(--suit-spades)",
];

/**
 * The same four suits as ink on the paper face. The pastel set above is tuned
 * for dark slabs and washes out on white, so the faces get full-strength ink:
 * green clubs, orange diamonds, red hearts, blue spades — the four colour deck
 * every poker tool uses, where a flush cannot be misread at a glance.
 */
const SUIT_INKS = ["#137a4a", "#c2601e", "#cc2438", "#2b5fc2"];

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

/** One corner index: rank with its suit tucked under it. */
function CornerIndex({
  rank,
  suit,
  s,
  flipped,
}: {
  rank: string;
  suit: string;
  s: (typeof SIZES)[Size];
  flipped?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: flipped ? undefined : s.pad,
        left: flipped ? undefined : s.pad + 1,
        bottom: flipped ? s.pad : undefined,
        right: flipped ? s.pad + 1 : undefined,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        lineHeight: 1,
        transform: flipped ? "rotate(180deg)" : undefined,
      }}
    >
      <span
        className="num"
        style={{
          fontSize: rank === "10" ? s.rank * 0.82 : s.rank,
          fontWeight: 600,
          letterSpacing: rank === "10" ? "-0.08em" : "-0.02em",
        }}
      >
        {rank}
      </span>
      <span style={{ fontSize: s.cornerSuit, marginTop: 1 }}>{suit}</span>
    </div>
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
  const ink = known ? SUIT_INKS[suitOf(card)] : "var(--text-faint)";
  const rank = known ? RANK_CHARS[rankOf(card)].replace("T", "10") : "";
  const suit = known ? SUIT_SYMBOLS[suitOf(card)] : "";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        borderRadius: "var(--r-card)",
        // Paper, not slate. A slight warm fall-off keeps it from reading as a
        // dead white rectangle under the felt lighting.
        background: "linear-gradient(180deg, #fdfbf5 0%, #f1ecdf 100%)",
        color: ink,
        boxShadow: highlighted
          ? "0 0 0 1.5px var(--accent), 0 0 20px var(--accent-glow), var(--card-shadow)"
          : "var(--card-shadow), inset 0 0 0 1px rgba(20, 28, 33, 0.08)",
        userSelect: "none",
      }}
    >
      <CornerIndex rank={rank} suit={suit} s={s} />
      <CornerIndex rank={rank} suit={suit} s={s} flipped />
      {/* The centre pip carries the suit at a glance across the table. */}
      <div
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
      </div>
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
