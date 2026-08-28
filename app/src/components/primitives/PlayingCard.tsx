"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD, RANK_CHARS, rankOf, suitOf } from "@/lib/engine/cards";
import { spring } from "@/styles/theme";

type Size = "sm" | "md" | "lg";

/**
 * Card sizes. The 70x98 lg card is the Superdesign draft's own; the aspect is
 * a whisker off the source art's 222x323, which `object-fit: contain` absorbs
 * invisibly against the white stock.
 */
const SIZES: Record<Size, { w: number; h: number }> = {
  sm: { w: 40, h: 57 },
  md: { w: 56, h: 80 },
  lg: { w: 70, h: 98 },
};

/**
 * The faces are the real deck, whole.
 *
 * Byron Knoll's public-domain vector deck, one PNG per card in public/cards/,
 * shown exactly as drawn — the indices, the pip layouts, the double-headed
 * courts, all the deck's own. This replaced a hand-set face (our type for
 * indices, our pips, court art grafted into the middle) whose seams showed:
 * the grafted courts carried their own pips beside our indices and every
 * corner said the suit twice. A deck drawn as one thing reads as one thing,
 * and a century of card players already trusts this one.
 *
 * The one face that stays ours is the back, which carries the house logo —
 * a real casino brands the back and leaves the face to the printer.
 */
const SUIT_FILE = ["c", "d", "h", "s"];

const cardFile = (card: number) =>
  `/cards/${RANK_CHARS[rankOf(card)].toLowerCase()}${SUIT_FILE[suitOf(card)]}.png`;

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
        <Face card={card} highlighted={highlighted} />
        <Back />
      </motion.div>
    </motion.div>
  );
}

function Face({ card, highlighted }: { card?: number; highlighted: boolean }) {
  const known = card !== undefined && card !== NO_CARD && card < 52;
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
         * card off the cloth. The white is also the letterbox for the art's
         * slightly different aspect, which is why it stays even though the
         * art fills the card.
         */
        background: "var(--c-card-face)",
        boxShadow: highlighted
          ? "0 0 0 2px var(--c-green), 0 4px 10px rgba(0, 0, 0, 0.3)"
          : "0 4px 10px rgba(0, 0, 0, 0.3)",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {known && (
        <img
          src={cardFile(card)}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            pointerEvents: "none",
            userSelect: "none",
          }}
        />
      )}
    </div>
  );
}

/**
 * The back: dark zinc stock inside a heavier zinc border, carrying the actual
 * house logo greyed and lifted to read on it. The one surface of the deck
 * that is this product's rather than the printer's.
 */
function Back() {
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
