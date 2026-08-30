"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { MOTION } from "@/design/tokens";

/**
 * A number that counts to its new value instead of snapping.
 *
 * Stacks and pots change by amounts that matter, and a jump reads as a glitch
 * where a tick reads as chips moving. At showdown the count-up is the part
 * players actually feel.
 *
 * The default duration is MOTION.chipCommit, so a stack finishes counting as
 * the chips that changed it finish travelling. Tabular figures — carried by
 * `.num` — keep the width steady so nothing shifts around it while it runs.
 */
export function AnimatedNumber({
  value,
  duration = MOTION.chipCommit,
  className,
  style,
}: {
  value: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const b = value;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Ease out, so it settles rather than stopping dead.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(a + (b - a) * eased);
      /*
       * Where a re-target would pick up from: the digit actually on screen.
       *
       * This used to be written in the cleanup as `from.current = value`, which
       * is the target of the run being cancelled rather than the number the
       * player is looking at. A pot that changed twice inside one count-up
       * therefore restarted from a figure that had never been displayed, and
       * the number visibly jumped before counting again.
       */
      from.current = current;
      setShown(current);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, duration, reduce]);

  return (
    <span className={`num ${className ?? ""}`} style={style}>
      {shown.toLocaleString()}
    </span>
  );
}
