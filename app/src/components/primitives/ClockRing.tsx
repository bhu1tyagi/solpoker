"use client";

import { useEffect, useState } from "react";

/**
 * The action clock, drawn as a ring that drains clockwise.
 *
 * This is information, not decoration, so it keeps animating even when the
 * player has asked for reduced motion. It just stops pulsing.
 *
 * Past the deadline anyone may call force_timeout, so the last seconds turn red
 * to say the seat is about to be acted for.
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
  const color = urgent ? "var(--lose)" : "var(--accent)";
  const degrees = fraction * 360;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        position: "relative",
        display: "grid",
        placeItems: "center",
        // A conic gradient is the cheapest honest way to draw a draining ring.
        background: `conic-gradient(${color} ${degrees}deg, rgba(255,255,255,0.06) ${degrees}deg)`,
        padding: thickness,
        boxShadow: urgent ? "0 0 18px rgba(201,127,127,0.3)" : "0 0 18px var(--accent-glow)",
        transition: "box-shadow 0.2s ease",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: thickness,
          borderRadius: "50%",
          background: "var(--surface)",
        }}
      />
      <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
        {children}
      </div>
    </div>
  );
}

/** Seconds left, for a compact readout next to the ring. */
export function useCountdown(deadline: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil(deadline - now));
}
