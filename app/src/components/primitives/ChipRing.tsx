"use client";

import { motion, useReducedMotion } from "motion/react";
import { MOTION } from "@/design/tokens";

/**
 * The signature: a dashed ring whose dashes are a poker chip's edge spots.
 *
 * This is the same geometry as the mark in Logo.tsx — eight spots, the same
 * duty cycle — and it has exactly three jobs in the whole product:
 *
 *   1. The turn clock. It wraps the seat that is to act and depletes
 *      counter-clockwise as their time runs out. The most-watched element on
 *      any poker table is literally the logo.
 *   2. The loading state. The same ring, rotating, wherever the table is
 *      waiting on chain. There are no generic spinners in this product.
 *   3. The privacy indicator. Solid beside your hole cards when the seat's TEE
 *      permission is confirmed, hollow when it is not.
 *
 * Do not use it decoratively anywhere else. It means something in all three
 * cases and it stops meaning anything if it becomes a border style.
 */

/** Eight spots at a 0.615 duty cycle, matching the mark exactly. */
const SPOTS = 8;
const DUTY = 0.615;

/*
 * pathLength normalises the circle to 1 unit, so the dash rhythm is a pure
 * fraction and stays identical at every size — no recomputing against 2πr.
 */
const DASH = `${DUTY / SPOTS} ${(1 - DUTY) / SPOTS}`;

export function ChipRing({
  size = 76,
  thickness = 3,
  /**
   * How much of the ring is lit, 0..1. Omit for a complete ring.
   * The remainder is drawn as an unlit track so the chip's shape survives.
   */
  fraction = 1,
  color = "var(--c-green)",
  trackColor = "var(--c-rule-strong)",
  /** Rotate forever. The loading state, and only the loading state. */
  spinning = false,
  /** Fill the disc inside the ring — the secured privacy indicator. */
  filled = false,
  children,
  title,
}: {
  size?: number;
  thickness?: number;
  fraction?: number;
  color?: string;
  trackColor?: string;
  spinning?: boolean;
  filled?: boolean;
  children?: React.ReactNode;
  title?: string;
}) {
  const reduce = useReducedMotion();
  const c = 50;
  // Keep the stroke inside the viewBox whatever the thickness.
  const strokeW = (thickness / size) * 100;
  const r = c - strokeW / 2;
  const clamped = Math.max(0, Math.min(1, fraction));
  const maskId = `chip-ring-mask-${Math.round(clamped * 1e6)}-${size}`;

  const ring = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        {/*
         * The mask is "how much is left": a solid arc starting at twelve
         * o'clock. Masking the dashed ring with it means whole chip spots wink
         * out as time runs down, rather than an arc smoothly shrinking — which
         * is what makes the clock read as the mark rather than as a progress
         * bar wearing its costume.
         */}
        <mask id={maskId}>
          <circle
            cx={c}
            cy={c}
            r={r}
            /* Mask luminance, not a colour: white means "show this". */
            stroke="#fff"
            strokeWidth={strokeW}
            pathLength={1}
            strokeDasharray={`${clamped} ${1 - clamped}`}
            /* -90deg starts the sweep at twelve; scaleX(-1) mirrors it so the
               ring depletes counter-clockwise. */
            style={{
              transformBox: "fill-box",
              transformOrigin: "center",
              transform: "rotate(-90deg) scaleX(-1)",
            }}
          />
        </mask>
      </defs>

      {filled && (
        <circle cx={c} cy={c} r={r - strokeW} fill={color} opacity={0.16} />
      )}

      {/* The unlit track: the chip's own edge, always present. */}
      <circle
        cx={c}
        cy={c}
        r={r}
        stroke={trackColor}
        strokeWidth={strokeW}
        pathLength={1}
        strokeDasharray={DASH}
        strokeLinecap="butt"
      />

      {/* The lit portion, same rhythm, revealed through the mask. */}
      {clamped > 0 && (
        <circle
          cx={c}
          cy={c}
          r={r}
          stroke={color}
          strokeWidth={strokeW}
          pathLength={1}
          strokeDasharray={DASH}
          strokeLinecap="butt"
          mask={`url(#${maskId})`}
        />
      )}
    </svg>
  );

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {spinning && !reduce ? (
        <motion.div
          style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: MOTION.seatPulse / 1000, ease: "linear" }}
        >
          {ring}
        </motion.div>
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          {ring}
        </div>
      )}
      {children != null && (
        <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The loading state. The ring, turning, wherever the table is waiting on chain.
 *
 * Under reduced motion it stops turning and breathes instead, because a
 * completely static ring is indistinguishable from a table that has stalled.
 */
export function ChipSpinner({
  size = 20,
  thickness = 2,
  color = "var(--c-green)",
  label,
}: {
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span
      role="status"
      aria-label={label ?? "Waiting"}
      style={{ display: "inline-grid", placeItems: "center", lineHeight: 0 }}
    >
      {reduce ? (
        <motion.span
          style={{ display: "block", lineHeight: 0 }}
          animate={{ opacity: [0.45, 1, 0.45] }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
        >
          <ChipRing size={size} thickness={thickness} color={color} />
        </motion.span>
      ) : (
        <ChipRing size={size} thickness={thickness} color={color} spinning />
      )}
    </span>
  );
}

/**
 * The privacy indicator: solid when this seat's TEE permission is confirmed,
 * hollow when it is not.
 *
 * This is the one piece of chrome that earns its place by stating the
 * product's whole claim, so its wording is held to the same line the trust
 * page takes: TEE-protected hole cards, and nothing stronger.
 */
export function PrivacyRing({
  secured,
  size = 14,
}: {
  secured: boolean;
  size?: number;
}) {
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      title={secured ? "Cards secured" : "This seat is not secured"}
    >
      <ChipRing
        size={size}
        thickness={2}
        color={secured ? "var(--c-green)" : "var(--c-ink-faint)"}
        trackColor={secured ? "var(--c-green-deep)" : "var(--c-rule-strong)"}
        filled={secured}
        title={secured ? "Cards secured" : "This seat is not secured"}
      />
    </span>
  );
}
