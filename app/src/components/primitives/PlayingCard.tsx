"use client";

import { motion, useReducedMotion } from "motion/react";
import { NO_CARD } from "@/lib/engine/cards";
import { cardArt, useArtReady } from "@/lib/deck-art";
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
 * How tall a card of each size is, for anything that has to hold its place
 * while the card itself is absent — a seat reserving room for a hand it has
 * not been dealt yet, so the table stops moving between hands.
 */
export const CARD_HEIGHT: Record<Size, number> = {
  sm: SIZES.sm.h,
  md: SIZES.md.h,
  lg: SIZES.lg.h,
};

/**
 * The faces are the real deck, whole.
 *
 * Byron Knoll's public-domain vector deck, one file per card in public/cards/,
 * shown exactly as drawn — the indices, the pip layouts, the double-headed
 * courts, all the deck's own. This replaced a hand-set face (our type for
 * indices, our pips, court art grafted into the middle) whose seams showed:
 * the grafted courts carried their own pips beside our indices and every
 * corner said the suit twice. A deck drawn as one thing reads as one thing,
 * and a century of card players already trusts this one.
 *
 * Re-rendered from the deck's own SVGs at twice the size it used to ship at,
 * and as WebP rather than PNG. The felt is drawn on a canvas and scaled to the
 * room, so on a wide screen every card is being enlarged — at 222px the art
 * ran out of pixels doing it and the indices went soft. Twice the resolution
 * survives the scale, and the whole deck still weighs less than the smaller
 * PNGs did.
 *
 * The one face that stays ours is the back, which carries the house logo —
 * a real casino brands the back and leaves the face to the printer.
 */

/**
 * White left showing around the art, as a fraction of the card.
 *
 * The deck's art runs to the very edge of its canvas, and the face it sits on
 * is a rounded rectangle that clips — so the corner index, the one mark a
 * player reads a card by, was being shaved off by the radius. Real cards are
 * printed with a margin for exactly this reason.
 */
const ART_INSET = "5%";

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
  /*
   * A face that has not arrived yet is a card that has not been turned over
   * yet. The river used to flip onto a blank white rectangle while its art was
   * still loading; now the card simply stays face down and turns when there is
   * something to turn to, which with the deck pre-warmed is almost always the
   * same frame.
   */
  const artReady = useArtReady(card, known);
  const showFace = known && !faceDown && artReady;

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
          src={cardArt(card)}
          alt=""
          draggable={false}
          decoding="async"
          style={{
            position: "absolute",
            // Inside the radius, not under it: the corner index survives.
            inset: ART_INSET,
            width: `calc(100% - 2 * ${ART_INSET})`,
            height: `calc(100% - 2 * ${ART_INSET})`,
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
 * The back: dark zinc stock inside a heavier zinc border, carrying the house
 * mark. The one surface of the deck that is this product's rather than the
 * printer's.
 *
 * The mark keeps its colour here. It used to be greyed and brightened, which
 * was right for the flat chip that came before — a card back is upholstery
 * and a bright logo on it competes with the faces. This mark is an
 * illustration whose whole legibility at 40px is its purple-and-cyan rim
 * light, and greyscaling it left a dark smudge. Opacity alone does the
 * dimming, so what survives is the silhouette plus a hint of the neon.
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
        draggable={false}
        style={{
          width: "62%",
          opacity: 0.45,
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
