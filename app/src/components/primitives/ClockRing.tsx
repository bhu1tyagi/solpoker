"use client";

import { useEffect, useState } from "react";
import { ChipRing } from "./ChipRing";

/**
 * The action clock: the chip ring wrapping the seat that is to act, depleting
 * counter-clockwise as their time runs out.
 *
 * This is the product's signature doing its most important job. The most-
 * watched element on any poker table is the clock, and here it is literally
 * the mark — eight chip edge-spots winking out one at a time.
 *
 * It is information, not decoration, so it keeps animating even when the
 * player has asked for reduced motion. It just stops pulsing.
 *
 * Past the deadline anyone may call force_timeout, so the last seconds turn
 * amber and the ring keeps a written count beside it: colour alone never
 * carries a state in this interface, and "about to be acted for" is exactly
 * the state a player must not miss.
 */
export function ClockRing({
  deadline,
  totalSecs,
  size = 76,
  thickness = 3,
  children,
}: {
  /** Unix seconds. */
  deadline: number;
  /** The table's full clock, so the ring starts full. */
  totalSecs: number;
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 100);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, deadline - now);
  const fraction = totalSecs > 0 ? Math.min(1, remaining / totalSecs) : 0;
  const urgent = remaining <= 5;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div style={{ position: "absolute", inset: 0 }}>
        <ChipRing
          size={size}
          thickness={thickness}
          fraction={fraction}
          color={urgent ? "var(--c-warn)" : "var(--c-green)"}
          title={`${Math.ceil(remaining)} seconds to act`}
        />
      </div>
      <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
        {children}
      </div>
    </div>
  );
}
