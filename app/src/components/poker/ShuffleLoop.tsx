"use client";

import { motion, useReducedMotion } from "motion/react";
import { ChipRing } from "@/components/primitives/ChipRing";

/**
 * The waiting state: the chip ring, turning.
 *
 * Shown whenever the table is doing something the player cannot see — salts
 * being exchanged, randomness being drawn inside the enclave, the deal being
 * prepared. Chain work has no progress bar, but a table that is visibly
 * working reads as busy rather than broken, which is the whole difference
 * between waiting and worrying.
 *
 * This used to be a little riffle of card backs. It is the mark's ring now,
 * because the ring is what this product uses to say "waiting" and there are no
 * generic spinners anywhere in it. The label above it is the caller's: the
 * table page swaps "Shuffling" for a plain sentence about the delay once the
 * wait passes 35 seconds, rather than reassuring the player that a stuck table
 * is fine.
 */
export function ShuffleLoop({ label }: { label?: string }) {
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
      {reduce ? (
        // State still changes under reduced motion, it just stops travelling.
        // The crossfade stays, because losing it removes the only remaining
        // cue that anything is happening at all.
        <motion.div
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          <ChipRing size={52} thickness={4} />
        </motion.div>
      ) : (
        <ChipRing size={52} thickness={4} spinning />
      )}

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
