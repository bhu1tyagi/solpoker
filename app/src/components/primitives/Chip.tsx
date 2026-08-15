"use client";

import { motion } from "motion/react";
import { AnimatedNumber } from "./AnimatedNumber";

/**
 * Chips, drawn as stacked discs with an amount beside them.
 *
 * Denominations are cosmetic. The real amount is a single number on chain, and
 * the stack height is just a quick read of how big a bet is.
 */

const DENOMS = [
  { at: 1000, color: "#3d4a86", edge: "#5f6fb5" },
  { at: 500, color: "#5a3d7a", edge: "#8262ad" },
  { at: 100, color: "#1f5c55", edge: "#37847a" },
  { at: 25, color: "#7a5a32", edge: "#a67f4b" },
  { at: 5, color: "#7a3d44", edge: "#a65a63" },
  { at: 1, color: "#44505a", edge: "#66757f" },
];

function stackFor(amount: number) {
  // Up to five discs, biggest denomination the amount justifies.
  const d = DENOMS.find((x) => amount >= x.at) ?? DENOMS[DENOMS.length - 1];
  const count = Math.min(5, Math.max(1, Math.round(Math.log10(amount / d.at + 1) * 3) + 1));
  return { d, count };
}

export function ChipStack({
  amount,
  size = 18,
  showAmount = true,
  compact = false,
}: {
  amount: number;
  size?: number;
  showAmount?: boolean;
  compact?: boolean;
}) {
  if (amount <= 0) return null;
  const { d, count } = stackFor(amount);
  const lift = Math.max(2, size * 0.16);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size + lift * (count - 1),
        }}
      >
        {Array.from({ length: count }, (_, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            style={{
              position: "absolute",
              bottom: i * lift,
              width: size,
              height: size * 0.78,
              borderRadius: "50%",
              background: d.color,
              border: `1.5px solid ${d.edge}`,
              boxShadow: "0 1px 2px rgba(0,0,0,0.5)",
            }}
          />
        ))}
      </div>
      {showAmount && (
        <span
          style={{
            fontSize: compact ? "var(--t-xs)" : "var(--t-sm)",
            fontWeight: 600,
            color: "var(--text)",
            textShadow: "0 1px 3px rgba(0,0,0,0.7)",
          }}
        >
          <AnimatedNumber value={amount} />
        </span>
      )}
    </div>
  );
}
