"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { HEART_PATH, SPADE_PATH } from "@/components/primitives/Logo";
import { MOTION } from "@/design/tokens";

/**
 * The hero's physical objects: the brand art, two cards, a pot shadow.
 *
 * The art is the full lockup in /public/hero-mark.png — the raccoon with the
 * name drawn in his own smoke — used as itself rather than approximated in
 * CSS. ONE copy of it, deliberately: the old chip render appeared twice, a
 * main and a smaller one tossed beside the pot, which works for a prop and
 * not for a character. Two identical raccoons read as a rendering bug.
 *
 * He is the subject and is sized like one: large, centred, at the BACK of the
 * stage. The cards are small and sit low in front of him. That is the reverse
 * of what this scene did when the mark was a chip — a chip is a prop and can
 * stand in front of the cards, a character cannot be a garnish on them.
 *
 * The cards are built here with material treatment (paper gradient, edge
 * highlights, gloss pass, contact shadows) because the table's PlayingCard is
 * a flat UI component that reads as an interface element at this scale, not
 * as an object.
 *
 * The whole stage tilts toward the cursor: pointer position drives two motion
 * values through the cursor spring in tokens.ts, so the scene answers the hand
 * with weight instead of snapping. Layers sit at different translateZ depths
 * inside one preserve-3d stage, which is what turns the tilt into parallax.
 *
 * Three deliberate limits:
 *   - Mouse only. On touch, pointermove fires mid-scroll and the scene would
 *     wobble under the reader's thumb.
 *   - Reduced motion gets a static scene. The float loop is stopped in CSS,
 *     and the tilt handlers are never attached.
 *   - No WebGL. The render is already in the PNG; three.js would spend 160KB
 *     re-lighting a chip that ships pre-lit.
 */

const TILT_X = 9; // degrees at full deflection
const TILT_Y = 13;

/**
 * A suit glyph. `size` is the resting size; the centre pip is re-sized in CSS
 * as a percentage of the card so it tracks the card at every breakpoint.
 */
function Suit({ suit, size }: { suit: "spade" | "heart"; size: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <path
        d={suit === "spade" ? SPADE_PATH : HEART_PATH}
        fill={suit === "spade" ? "var(--c-suit-spade)" : "var(--c-suit-heart)"}
      />
    </svg>
  );
}

/** An ace face: two corner indices and the big centre pip. */
function Ace({ suit }: { suit: "spade" | "heart" }) {
  return (
    <>
      <span className="hero-card3d-index">
        A
        <Suit suit={suit} size={10} />
      </span>
      <span className="hero-card3d-pip">
        <Suit suit={suit} size={46} />
      </span>
      <span className="hero-card3d-index hero-card3d-index--flip">
        A
        <Suit suit={suit} size={10} />
      </span>
    </>
  );
}

export function HeroArtifacts() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, MOTION.cursor);
  const sy = useSpring(my, MOTION.cursor);
  const rotateX = useTransform(sy, [-0.5, 0.5], [TILT_X, -TILT_X]);
  const rotateY = useTransform(sx, [-0.5, 0.5], [-TILT_Y, TILT_Y]);

  const onMove = (e: React.PointerEvent) => {
    // Touch would wobble the scene mid-scroll; only a mouse gets the tilt.
    if (e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const onLeave = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <div className="hero-art" aria-hidden>
      <div className="hero-art-float animate-float">
        <motion.div
          ref={ref}
          className="hero-art-stage"
          onPointerMove={reduce ? undefined : onMove}
          onPointerLeave={reduce ? undefined : onLeave}
          style={
            reduce
              ? undefined
              : { rotateX, rotateY, transformStyle: "preserve-3d" }
          }
        >
          <div className="hero-art-glow" />
          <div className="hero-art-shadow" />

          {/*
            The mascot, big and at the back of the stage. The wrapper owns the
            geometry so the art and the light travelling through it cannot
            drift apart; both fill it.
          */}
          <div className="hero-mark-wrap">
            <img
              src="/hero-mark.png"
              alt=""
              className="hero-mark"
              width={1000}
              height={1164}
            />
            {/*
              The neon, moving. A band of purple-to-green sweeps upward through
              the art's own alpha, masked to the top half so it runs up the
              cigar smoke and the script and leaves his face alone. It is the
              drawing's own light travelling, not a second light thrown at it —
              which is why it blends rather than overlays.
            */}
            <span className="hero-mark-shimmer" aria-hidden />
          </div>

          {/*
            Two small cards, low and in front of him, like a hand held at the
            table's edge.

            Only the FACE-DOWN one is two-sided, and only it turns: hovering
            the pair peeks at the hole card, which is the gesture this product
            is actually about. The ace of spades already on show never moves —
            turning a card the reader can already see is a shuffle, not a
            reveal, and it made the pair read as decoration rather than as a
            hand. What comes up is an ace of HEARTS, so the peek pays off with
            pocket aces and never puts the same card on the table twice.
          */}
          <div className="hero-card3d hero-card3d--back">
            <div className="hero-card3d-flip">
              <div className="hero-card3d-side">
                <div className="hero-card3d-frame" />
              </div>
              <div className="hero-card3d-side hero-card3d-side--reverse hero-card3d-side--paper">
                <Ace suit="heart" />
              </div>
            </div>
          </div>

          <div className="hero-card3d hero-card3d--front">
            <div className="hero-card3d-side hero-card3d-side--paper">
              <Ace suit="spade" />
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
