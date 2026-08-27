"use client";

import { useRef } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { SPADE_PATH } from "@/components/primitives/Logo";
import { MOTION } from "@/design/tokens";

/**
 * The hero's physical objects: the rendered chip, two cards, a pot shadow.
 *
 * The chip is the actual brand art in /public/logo-512.png, a photoreal 3D
 * render, used as itself rather than approximated in CSS. The cards are built
 * here with material treatment (paper gradient, edge highlights, gloss pass,
 * contact shadows) because the table's PlayingCard is a flat UI component that
 * reads as an interface element at this scale, not as an object.
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

function SpadeGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      <path d={SPADE_PATH} fill="var(--c-suit-spade)" />
    </svg>
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

          {/* Card back, deepest object. */}
          <div className="hero-card3d hero-card3d--back">
            <div className="hero-card3d-frame" />
          </div>

          {/* Ace of spades. */}
          <div className="hero-card3d hero-card3d--front">
            <span className="hero-card3d-index">
              A
              <SpadeGlyph size={20} />
            </span>
            <span className="hero-card3d-pip">
              <SpadeGlyph size={104} />
            </span>
            <span className="hero-card3d-index hero-card3d-index--flip">
              A
              <SpadeGlyph size={20} />
            </span>
          </div>

          {/* The chip: the brand render, used as itself. */}
          <img
            src="/logo-512.png"
            alt=""
            className="hero-chip hero-chip--main"
            width={512}
            height={512}
          />
          <img
            src="/logo-512.png"
            alt=""
            className="hero-chip hero-chip--side"
            width={512}
            height={512}
          />
        </motion.div>
      </div>
    </div>
  );
}
