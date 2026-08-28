"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD, RANK_CHARS, SUIT_SYMBOLS, rankOf, suitOf } from "@/lib/engine/cards";
import { spring } from "@/styles/theme";

type Size = "sm" | "md" | "lg";

/**
 * Card geometry, from the Superdesign "High Stakes Table" draft: a corner
 * index — rank with a small suit beside it — mirrored in the far corner, and
 * one large pip in the middle. The corner is what reads in a fanned or partly
 * covered hand; the pip is what reads across the table. The lg card is the
 * draft's own 70×98.
 */
const SIZES: Record<
  Size,
  { w: number; h: number; rank: number; suit: number; pip: number; pad: number }
> = {
  sm: { w: 40, h: 57, rank: 12, suit: 10, pip: 23, pad: 3 },
  md: { w: 56, h: 80, rank: 15, suit: 12, pip: 31, pad: 4 },
  lg: { w: 70, h: 98, rank: 18, suit: 15, pip: 40, pad: 5 },
};

/**
 * The classic two-colour deck, in suit order: clubs, diamonds, hearts, spades.
 *
 * The default, because it is the deck the chosen table design is drawn with.
 * Suit is never carried by colour alone — the symbol is printed beside every
 * rank and in the centre pip — and the four-colour deck below stays available
 * for a settings toggle, where red/black is hard to separate.
 */
export const SUIT_COLORS = [
  "var(--c-card-black)",
  "var(--c-card-red)",
  "var(--c-card-red)",
  "var(--c-card-black)",
];

/** The four-colour deck, the accessible alternate for the settings toggle. */
export const SUIT_COLORS_FOUR = [
  "var(--c-suit-club)",
  "var(--c-suit-diamond)",
  "var(--c-suit-heart)",
  "var(--c-suit-spade)",
];

/**
 * The court, as the court has always looked.
 *
 * The real double-headed English-pattern figures, from Byron Knoll's
 * public-domain vector deck — the same art that has said "king" for a
 * century and a half. Each file in public/cards/ is the complete figure,
 * cropped once offline to the art's own measured bounds (166x266 out of the
 * 222x323 originals, the corner indices excluded), so it is shown whole:
 * nothing sliced, nothing scaled past its frame. The classic figure sits in
 * our stock, and the corners and indices stay this product's.
 */
const SUIT_FILE = ["c", "d", "h", "s"];

function CourtFace({
  rank,
  suit,
  h,
}: {
  rank: "J" | "Q" | "K";
  suit: number;
  h: number;
}) {
  return (
    <img
      aria-hidden
      src={`/cards/${rank.toLowerCase()}${SUIT_FILE[suit]}.png`}
      alt=""
      style={{
        height: Math.round(h * 0.62),
        width: "auto",
        display: "block",
        userSelect: "none",
        pointerEvents: "none",
      }}
    />
  );
}

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
  /** Four-colour deck, for players who switch it on in settings. */
  fourColor?: boolean;
  className?: string;
}

export function PlayingCard({
  card,
  faceDown = false,
  size = "md",
  dimmed = false,
  highlighted = false,
  fourColor = false,
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
        <Face card={card} s={s} highlighted={highlighted} fourColor={fourColor} />
        <Back s={s} />
      </motion.div>
    </motion.div>
  );
}

function Face({
  card,
  s,
  highlighted,
  fourColor,
}: {
  card?: number;
  s: (typeof SIZES)[Size];
  highlighted: boolean;
  fourColor: boolean;
}) {
  const known = card !== undefined && card !== NO_CARD && card < 52;
  const palette = fourColor ? SUIT_COLORS_FOUR : SUIT_COLORS;
  const color = known ? palette[suitOf(card)] : "var(--c-ink-faint)";
  const rank = known ? RANK_CHARS[rankOf(card)].replace("T", "10") : "";
  const suit = known ? SUIT_SYMBOLS[suitOf(card)] : "";

  // The index, as the draft prints it: rank with a small suit at its side, on
  // one line. "10" is the one two-character rank, so it drops a size to hold
  // roughly the same footprint.
  const index = (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        lineHeight: 1,
        gap: Math.max(1, Math.round(s.rank * 0.14)),
      }}
    >
      <span
        className="num"
        style={{
          fontSize: rank === "10" ? s.rank * 0.82 : s.rank,
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
         * A card is a light object on a dark table, exactly like a real one —
         * pure white per the draft, with its soft drop shadow standing the
         * card off the cloth.
         */
        background: "var(--c-card-face)",
        boxShadow: highlighted
          ? "0 0 0 2px var(--c-green), 0 4px 10px rgba(0, 0, 0, 0.3)"
          : "0 4px 10px rgba(0, 0, 0, 0.3)",
        color,
        userSelect: "none",
      }}
    >
      {known && (
        <>
          <span style={{ position: "absolute", top: s.pad, left: s.pad + 1 }}>{index}</span>
          {/* The mirror index: the same line turned through 180°, so the card
              reads the same whichever way it lands. */}
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
          {/* The centre: a court figure for J, Q and K, the big pip for
              everything else, seated dead centre as the draft sets it. */}
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              fontSize: s.pip,
              lineHeight: 1,
            }}
          >
            {known && (rank === "J" || rank === "Q" || rank === "K") ? (
              <CourtFace rank={rank} suit={suitOf(card)} h={s.h} />
            ) : (
              suit
            )}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The back, per the draft's locked card: dark zinc stock inside a heavier
 * zinc border, with the house mark sitting faintly in the middle — the same
 * treatment the draft gives its face-down river card.
 */
function Back({ s }: { s: (typeof SIZES)[Size] }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        transform: "rotateY(180deg)",
        borderRadius: "var(--r-card)",
        background: "var(--c-card-back)",
        border: "2px solid var(--c-card-back-edge)",
        boxShadow: "0 4px 10px rgba(0, 0, 0, 0.3)",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      {/* The actual logo, not a redrawing of it — the navbar's chip, greyed
          and lifted just enough to read on the dark stock. */}
      <img
        src="/logo-96.png"
        alt=""
        aria-hidden
        style={{
          width: "52%",
          filter: "grayscale(1) brightness(1.7)",
          opacity: 0.28,
          display: "block",
          pointerEvents: "none",
          userSelect: "none",
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
        // The draft's undealt slot: dark zinc stock in a heavier zinc border,
        // quieter than a face-down card because nothing is there yet.
        background: "color-mix(in srgb, var(--c-card-back) 70%, transparent)",
        border: "2px solid color-mix(in srgb, var(--c-card-back-edge) 60%, transparent)",
      }}
    />
  );
}
