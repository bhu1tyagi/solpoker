"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The waiting state, told as dealing rather than as machinery.
 *
 * Every long operation at a table is a chain operation — accounts being handed
 * to the rollup, permissions written inside an enclave, a deck being locked to
 * nobody — and the overlay used to say so in those words, over a turning ring.
 * That is honest and it is the wrong register: a player waiting for a hand does
 * not want to be told about delegation, they want to see that cards are coming.
 *
 * So the deck deals. Four backs peel off a squared-up shoe and travel out into
 * the room on a short arc, fading as they land, over and over for as long as
 * the wait lasts. It says the same thing the ring said — the table is working,
 * not broken — in the language of the game the player came for.
 *
 * The label is still the caller's, and still the honest one: what is happening
 * now, plainly, and the page escalates it if the wait turns into a problem.
 */

/** Where the four dealt cards travel to, and how they are tilted on the way. */
const ARC = [
  { x: -46, y: 16, rotate: -22 },
  { x: -18, y: 30, rotate: -8 },
  { x: 18, y: 30, rotate: 8 },
  { x: 46, y: 16, rotate: 22 },
];

const CARD_W = 26;
const CARD_H = 36;
/** One card out every this often, so the four make a continuous round. */
const STAGGER_S = 0.35;
const FLIGHT_S = 1.4;

/**
 * A card back, small enough to read as a card and not as a rectangle.
 *
 * The real back's mark, at a size where it is a texture rather than a logo. It
 * matters more than it sounds: zinc stock on a dark panel is only a few points
 * of lightness apart, and without something inside it these read as grey
 * rectangles. The rim light and the drop shadow do the rest of the separating.
 */
function MiniBack({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        borderRadius: 4,
        background:
          "linear-gradient(160deg, color-mix(in srgb, var(--c-card-back) 80%, white) 0%, var(--c-card-back) 55%)",
        border: "1px solid var(--c-card-back-edge)",
        boxShadow:
          "inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 3px 8px rgba(0, 0, 0, 0.45)",
        display: "grid",
        placeItems: "center",
        ...style,
      }}
    >
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        style={{ width: "52%", opacity: 0.26, color: "var(--c-ink)" }}
      >
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="currentColor"
          strokeWidth="12"
          strokeDasharray="20.3 12.7"
          strokeDashoffset="10.15"
        />
      </svg>
    </div>
  );
}

export function DealerLoop({ label }: { label?: string }) {
  const reduce = useReducedMotion();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--sp-4)",
      }}
      role="status"
    >
      <div
        aria-hidden
        style={{
          position: "relative",
          width: 118,
          height: 62,
          display: "grid",
          placeItems: "center",
        }}
      >
        {/* The shoe: three backs squared up, the top one sitting proud.
            Under reduced motion nothing travels — the deck simply breathes,
            which keeps the "something is happening" cue without the movement. */}
        <motion.div
          style={{ position: "relative", width: CARD_W, height: CARD_H }}
          animate={reduce ? { opacity: [0.45, 1, 0.45] } : undefined}
          transition={
            reduce ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : undefined
          }
        >
          <MiniBack style={{ position: "absolute", left: 3, top: 3, opacity: 0.45 }} />
          <MiniBack style={{ position: "absolute", left: 1.5, top: 1.5, opacity: 0.7 }} />
          <MiniBack style={{ position: "absolute", left: 0, top: 0 }} />
        </motion.div>

        {/* Cards on their way out. */}
        {reduce
          ? null
          : ARC.map((to, i) => (
              <motion.div
                key={i}
                initial={{ x: 0, y: 0, rotate: 0, opacity: 0 }}
                animate={{
                  x: [0, to.x * 0.55, to.x],
                  y: [0, to.y * 0.4, to.y],
                  rotate: [0, to.rotate * 0.5, to.rotate],
                  opacity: [0, 1, 0],
                }}
                transition={{
                  duration: FLIGHT_S,
                  times: [0, 0.55, 1],
                  ease: "easeOut",
                  repeat: Infinity,
                  repeatDelay: ARC.length * STAGGER_S - FLIGHT_S + 0.2,
                  delay: i * STAGGER_S,
                }}
                style={{ position: "absolute" }}
              >
                <MiniBack />
              </motion.div>
            ))}
      </div>

      {label && (
        <motion.span
          className="label"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            color: "var(--c-ink-muted)",
            letterSpacing: "0.12em",
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}
