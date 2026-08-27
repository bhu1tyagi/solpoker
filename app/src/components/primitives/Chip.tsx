"use client";

import { motion } from "motion/react";
import { AnimatedNumber } from "./AnimatedNumber";

/**
 * The chip mark and the physical piles.
 *
 * The mark is a poker chip seen face on, and it is deliberately a *filled*
 * chip rather than the dashed open ring. The dashed ring is the product's
 * signature and it has exactly three jobs — turn clock, waiting state, privacy
 * indicator — so a fourth, decorative use beside every amount would stop it
 * meaning anything. This is the unit symbol; that is the state indicator.
 *
 * It takes currentColor by default, so it sits inside a label the way a
 * currency symbol does rather than importing a colour of its own.
 */
export function ChipGlyph({
  size = 16,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  // Drawn rather than fetched, because the page has to work with no network.
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0, display: "block" }}
    >
      <circle cx="12" cy="12" r="9.25" fill={color} opacity="0.18" />
      <circle cx="12" cy="12" r="9.25" stroke={color} strokeWidth="1.75" />
      <circle cx="12" cy="12" r="4.25" stroke={color} strokeWidth="1.75" />
      {/* Eight edge spots, as paint rather than gaps: this is a solid chip. */}
      <g stroke={color} strokeWidth="1.75" strokeLinecap="round">
        <path d="M12 2.75v2.6M12 18.65v2.6M2.75 12h2.6M18.65 12h2.6" />
        <path d="M5.46 5.46l1.84 1.84M16.7 16.7l1.84 1.84M18.54 5.46L16.7 7.3M7.3 16.7l-1.84 1.84" />
      </g>
    </svg>
  );
}

/**
 * Chip denominations, in casino convention.
 *
 * The colours are already learned — white one, red five, green twenty-five,
 * black hundred, purple five hundred — so a player reads the size of a bet
 * from its colour before they read the number beside it. That is the whole
 * reason to draw physical chips at all rather than print a figure.
 */
const DENOMINATIONS = [
  { value: 500, token: "var(--c-chip500)" },
  { value: 100, token: "var(--c-chip100)" },
  { value: 25, token: "var(--c-chip25)" },
  { value: 5, token: "var(--c-chip5)" },
  { value: 1, token: "var(--c-chip1)" },
] as const;

/** No column grows past this; the figure beside the pile carries the exact amount. */
const MAX_PER_COLUMN = 6;

/**
 * Break an amount into physical chips, largest first.
 *
 * A greedy split is naturally self-limiting — five fives make a twenty-five,
 * so no middle column can exceed four — which means the pile's height tracks
 * the amount without any need to measure it against a reference stack. The
 * previous version scaled a single-colour pile against the table's biggest
 * stack, which made every pile the same colour and every comparison relative.
 */
function chipsFor(amount: number): { count: number; token: string }[] {
  const columns: { count: number; token: string }[] = [];
  let left = Math.max(0, Math.floor(amount));

  for (const { value, token } of DENOMINATIONS) {
    const count = Math.floor(left / value);
    if (count > 0) {
      columns.push({ count: Math.min(MAX_PER_COLUMN, count), token });
      left -= count * value;
    }
  }
  // A non-zero amount always shows at least one chip, even if it rounds to
  // nothing: an empty space where a bet should be reads as a bug.
  if (columns.length === 0 && amount > 0) {
    columns.push({ count: 1, token: "var(--c-chip1)" });
  }
  return columns;
}

/**
 * One chip, seen from slightly above: a flat disc, so it is an ellipse rather
 * than a bar. The lighter top face and the darker edge below it are what stop a
 * stack of these reading as a row of sliders.
 *
 * The edge carries spots. Every real chip has them — the pale dashes moulded
 * into the rim — and they are the single detail that separates a stack of chips
 * from a stack of coloured discs: they give the edge a texture that repeats up
 * the pile, so the eye reads depth instead of a gradient. Drawn as a repeating
 * gradient on the lower half rather than as elements, so a six-high column is
 * still one div per chip.
 *
 * Every colour is mixed from the one denomination token, so a chip can never
 * drift out of its own hue however the palette moves.
 */
function Coin({ size, token }: { size: number; token: string }) {
  const h = Math.max(4, Math.round(size * 0.42));
  // The spots shrink with the chip so they stay spots rather than stripes.
  const spot = Math.max(2, Math.round(size * 0.13));
  const gap = Math.max(2, Math.round(size * 0.11));
  const edge = `color-mix(in srgb, ${token} 45%, var(--c-felt))`;
  const spotColor = `color-mix(in srgb, ${token} 55%, white)`;
  return (
    <div
      style={{
        width: size,
        height: h,
        borderRadius: "50%",
        background: [
          // 1. The moulded spots, on the edge only. Clipped to the bottom half
          //    by its own size and position, so the face stays clean.
          `repeating-linear-gradient(90deg, ${spotColor} 0 ${spot}px, transparent ${spot}px ${spot + gap}px) no-repeat left ${Math.round(h * 0.58)}px / 100% ${Math.round(h * 0.26)}px`,
          // 2. A highlight arc across the top face, where the light lands.
          `radial-gradient(120% 180% at 34% 8%, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0) 52%) no-repeat`,
          // 3. Face, then the chip's own edge in shadow beneath it.
          `linear-gradient(180deg, ${token} 0%, ${token} 45%, color-mix(in srgb, ${token} 72%, var(--c-felt)) 46%, ${edge} 100%)`,
        ].join(", "),
        // A hairline of rim-light along the top edge, the way every raised
        // surface in this system catches light from above.
        boxShadow: "var(--e-raised)",
      }}
    />
  );
}

export function ChipStack({
  amount,
  size = 18,
  showAmount = true,
  compact = false,
  pill = false,
}: {
  amount: number;
  size?: number;
  showAmount?: boolean;
  compact?: boolean;
  /**
   * Set the figure in a dark pill rather than as bare text.
   *
   * Bets sit on the cloth, where plain white numerals have nothing behind them
   * and go illegible over a chip pile or the felt mark. The pill is the same
   * one the pot uses, so a bet and the pot it is going into are visibly the
   * same kind of object.
   */
  pill?: boolean;
}) {
  if (amount <= 0) return null;
  const columns = chipsFor(amount);

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
        {columns.map(({ count, token }, c) => {
          const step = Math.max(3, Math.round(size * 0.3));
          return (
            <div
              key={token}
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
                  transition={{ delay: (c * MAX_PER_COLUMN + i) * 0.015 }}
                  style={{ position: "absolute", bottom: i * step, left: 0 }}
                >
                  <Coin size={size} token={token} />
                </motion.div>
              ))}
            </div>
          );
        })}
      </div>
      {showAmount && (
        <span
          className="num"
          style={{
            fontFamily: pill ? "var(--font-mono)" : undefined,
            fontSize: compact ? "var(--t-label-size)" : "var(--t-body-sm-size)",
            fontWeight: 700,
            color: "var(--c-ink)",
            ...(pill
              ? {
                  padding: compact ? "1px 6px" : "2px 8px",
                  borderRadius: "var(--r-pill)",
                  background: "rgba(0, 0, 0, 0.55)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  lineHeight: 1.35,
                }
              : null),
          }}
        >
          <AnimatedNumber value={amount} />
        </span>
      )}
    </div>
  );
}
