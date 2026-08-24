"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * A little riffle of card backs, looping.
 *
 * Shown whenever the table is doing something the player cannot see: salts
 * being exchanged, randomness being drawn inside the enclave, the deal being
 * prepared. Chain work has no progress bar, but a table that visibly shuffles
 * reads as busy rather than broken, which is the entire difference between
 * waiting and worrying.
 */
export function ShuffleLoop({ label }: { label?: string }) {
  const reduce = useReducedMotion();

  const card = (i: number) => {
    const spread = (i - 1) * 26;
    return (
      <motion.div
        key={i}
        initial={false}
        animate={
          reduce
            ? { opacity: [0.6, 1, 0.6] }
            : {
                x: [0, spread, spread, 0, 0],
                y: [0, -14, -14, 0, 0],
                rotate: [0, spread * 0.45, spread * 0.45, 0, 0],
                zIndex: [i, 3 + i, 3 + i, i, i],
              }
        }
        transition={{
          duration: reduce ? 1.8 : 2.2,
          times: reduce ? undefined : [0, 0.28, 0.45, 0.7, 1],
          repeat: Infinity,
          ease: "easeInOut",
          delay: i * 0.12,
        }}
        style={{
          position: "absolute",
          width: 40,
          height: 56,
          borderRadius: 7,
          // These named two tokens that have never existed, so the shuffling
          // cards rendered as transparent rectangles with no border. The real
          // card-back pair is `--card-back-hi` / `--card-back-lo`.
          background: `linear-gradient(180deg, var(--card-back-hi), var(--card-back-lo))`,
          border: "1px solid var(--line)",
          boxShadow: "var(--shadow-1)",
          backgroundImage:
            "repeating-linear-gradient(45deg, var(--line) 0 1px, transparent 1px 7px)",
        }}
      />
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div style={{ position: "relative", width: 40, height: 56 }}>
        {[0, 1, 2].map(card)}
        {/* A soft pool of light under the deck, breathing. */}
        <motion.div
          animate={{ opacity: [0.25, 0.5, 0.25] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            left: -28,
            right: -28,
            bottom: -12,
            height: 22,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at center, var(--accent-glow), transparent 70%)",
            filter: "blur(4px)",
          }}
        />
      </div>
      {label && (
        <motion.span
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          style={{
            fontSize: "var(--t-xs)",
            color: "var(--text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}
