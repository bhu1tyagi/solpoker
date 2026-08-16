"use client";

import { motion } from "motion/react";
import { AnimatedNumber } from "./AnimatedNumber";

/**
 * The chip mark and the physical piles.
 *
 * The mark is the spec's two-stroke coin: an upright bar crossed by a wider
 * one, drawn in the same cyan every chip figure is written in. It sits beside
 * a number the way a currency symbol does.
 */
export function ChipGlyph({ size = 16, color = "var(--accent)" }: { size?: number; color?: string }) {
  // An actual poker chip: a rim with eight edge spots and an inner ring. Drawn
  // rather than fetched, because the page has to work with no network.
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0, display: "block" }}
    >
      <circle cx="12" cy="12" r="9.25" stroke={color} strokeWidth="1.75" />
      <circle cx="12" cy="12" r="4.25" stroke={color} strokeWidth="1.75" />
      <g stroke={color} strokeWidth="1.75" strokeLinecap="round">
        <path d="M12 2.75v2.6M12 18.65v2.6M2.75 12h2.6M18.65 12h2.6" />
        <path d="M5.46 5.46l1.84 1.84M16.7 16.7l1.84 1.84M18.54 5.46L16.7 7.3M7.3 16.7l-1.84 1.84" />
      </g>
    </svg>
  );
}

/**
 * How many coins an amount earns, split into columns.
 *
 * The count is proportional to a reference amount, normally the largest stack
 * on the table, so the stacks read against each other the way real ones do: the
 * chip leader's pile is visibly taller, and two even stacks look even. Without a
 * reference every amount is measured against itself and every pile looks the
 * same, which is worse than showing nothing.
 */
const MAX_COINS = 20;
const PER_COLUMN = 5;

function coinsFor(amount: number, reference: number) {
  const ratio = reference > 0 ? amount / reference : 1;
  const total = Math.min(MAX_COINS, Math.max(1, Math.round(ratio * MAX_COINS)));
  const columns: number[] = [];
  let left = total;
  while (left > 0) {
    columns.push(Math.min(PER_COLUMN, left));
    left -= PER_COLUMN;
  }
  return columns;
}

/**
 * One chip, seen from slightly above: a flat disc, so it is an ellipse rather
 * than a bar. The lighter top face and the darker edge below it are what stop a
 * stack of these reading as a row of sliders.
 */
function Coin({ size, tone }: { size: number; tone: number }) {
  const h = Math.max(4, Math.round(size * 0.42));
  // Alternate two shades down the stack, the way real chips band.
  const face = tone % 2 === 0 ? "var(--accent)" : "#7ec9d0";
  return (
    <div
      style={{
        width: size,
        height: h,
        borderRadius: "50%",
        background: `linear-gradient(180deg, ${face} 0%, ${face} 45%, var(--accent-deep) 46%, #2b7f86 100%)`,
        boxShadow: "0 1px 1px rgba(7,12,15,0.55)",
      }}
    />
  );
}

export function ChipStack({
  amount,
  size = 18,
  showAmount = true,
  compact = false,
  reference,
}: {
  amount: number;
  size?: number;
  showAmount?: boolean;
  compact?: boolean;
  /** Amount that earns a full-height pile. Defaults to this stack itself. */
  reference?: number;
}) {
  if (amount <= 0) return null;
  const columns = coinsFor(amount, reference ?? amount);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 7,
        pointerEvents: "none",
      }}
    >
      {/* Chips overlap as they stack, so only the front edge of each one shows,
          which is what makes a pile look like a pile. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
        {columns.map((count, c) => {
          const step = Math.max(3, Math.round(size * 0.3));
          return (
            <div
              key={c}
              style={{
                position: "relative",
                width: size,
                height: step * (count - 1) + Math.round(size * 0.42),
              }}
            >
              {Array.from({ length: count }, (_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (c * PER_COLUMN + i) * 0.015 }}
                  style={{ position: "absolute", bottom: i * step, left: 0 }}
                >
                  <Coin size={size} tone={i} />
                </motion.div>
              ))}
            </div>
          );
        })}
      </div>
      {showAmount && (
        <span
          className="tnum"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: compact ? "var(--t-xs)" : "var(--t-sm)",
            color: "var(--accent)",
            textShadow: "0 1px 3px rgba(7,12,15,0.7)",
          }}
        >
          <AnimatedNumber value={amount} />
        </span>
      )}
    </div>
  );
}
