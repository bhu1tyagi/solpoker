"use client";

import { motion } from "motion/react";
import { AnimatedNumber } from "./AnimatedNumber";

/**
 * Chips, drawn as columns of stacked coins with an amount beside them.
 *
 * The stack height is a log scale read of how big an amount is, nothing more.
 * The real amount is a single number on chain.
 */

/** The chip mark: a spade in a mint disc. The currency symbol of the room. */
export function ChipGlyph({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--grad-accent)",
        color: "var(--on-accent)",
        fontSize: size * 0.62,
        lineHeight: 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      ♠
    </span>
  );
}

/** How many coins an amount earns, split into columns of at most six. */
function coinsFor(amount: number) {
  const total = Math.min(18, Math.max(1, Math.floor(Math.log2(amount + 1) * 1.4)));
  const columns: number[] = [];
  let left = total;
  while (left > 0) {
    columns.push(Math.min(6, left));
    left -= 6;
  }
  return columns;
}

function Coin({ size }: { size: number }) {
  const h = Math.max(3, size * 0.26);
  return (
    <div
      style={{
        width: size,
        height: h,
        borderRadius: h / 2,
        background:
          "linear-gradient(180deg, rgba(125, 242, 208, 0.85), rgba(47, 169, 140, 0.85))",
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.45), 0 1px 1px rgba(0,0,0,0.4)",
      }}
    />
  );
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
  const columns = coinsFor(amount);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 7,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
        {columns.map((count, c) => (
          <div
            key={c}
            style={{ display: "flex", flexDirection: "column-reverse", gap: 1 }}
          >
            {Array.from({ length: count }, (_, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (c * 6 + i) * 0.015 }}
              >
                <Coin size={size} />
              </motion.div>
            ))}
          </div>
        ))}
      </div>
      {showAmount && (
        <span
          className="tnum"
          style={{
            fontSize: compact ? "var(--t-xs)" : "var(--t-sm)",
            fontWeight: 700,
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
