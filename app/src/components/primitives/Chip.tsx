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
export function chipsFor(
  amount: number,
): { count: number; token: string; value: number }[] {
  const columns: { count: number; token: string; value: number }[] = [];
  let left = Math.max(0, Math.floor(amount));

  for (const { value, token } of DENOMINATIONS) {
    const count = Math.floor(left / value);
    if (count > 0) {
      columns.push({ count: Math.min(MAX_PER_COLUMN, count), token, value });
      left -= count * value;
    }
  }
  // A non-zero amount always shows at least one chip, even if it rounds to
  // nothing: an empty space where a bet should be reads as a bug.
  if (columns.length === 0 && amount > 0) {
    columns.push({ count: 1, token: "var(--c-chip1)", value: 1 });
  }
  return columns;
}

/**
 * One chip, drawn the way a chip actually looks from a seat: a face seen at a
 * shallow angle, a visible clay edge below it, moulded spots crossing the rim.
 *
 * SVG rather than gradients, because the gradients were always an
 * approximation and read as ovals. Here every part of the real object is its
 * own element: the darker body, the spot stripes crossing rim and edge
 * together the way moulded spots do, the face, the inlay ring, and the
 * denomination printed in the inlay — which is what lets a player read a
 * stack's value from the chips themselves, not just the number beside them.
 *
 * Every colour is mixed from the one denomination token, so a chip can never
 * drift out of its own hue however the palette moves. The white chip inverts
 * its accents — pale spots and pale ink would vanish on a pale face — which
 * is also what real one-dollar chips do.
 */
export function Coin({
  size,
  token,
  value,
}: {
  size: number;
  token: string;
  /** Denomination printed in the inlay. Omit on buried chips: only the top of a column can be read anyway. */
  value?: number;
}) {
  const light = token === "var(--c-chip1)";
  const face = token;
  const body = `color-mix(in srgb, ${token} 55%, black)`;
  const spot = light ? "#b83a3a" : "rgba(255, 255, 255, 0.92)";
  const inlay = light
    ? "color-mix(in srgb, white 88%, black)"
    : `color-mix(in srgb, ${token} 68%, black)`;
  const ink = light ? "rgba(30, 30, 34, 0.85)" : "rgba(255, 255, 255, 0.92)";

  // Face at (50, 26), body 12 units deep: 100 x 63 altogether.
  const h = Math.round(size * 0.63);
  return (
    <svg
      aria-hidden
      width={size}
      height={h}
      viewBox="0 0 100 63"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* The body: the bottom of the cylinder, its lower arc in shadow. */}
      <ellipse cx="50" cy="37" rx="47" ry="24" fill={body} />
      {/* Moulded spots on the visible edge, riding the bottom arc. */}
      <path
        d="M 3 37 A 47 24 0 0 0 97 37"
        fill="none"
        stroke={spot}
        strokeWidth="12"
        strokeDasharray="11.5 13.1"
        strokeDashoffset="-6"
        opacity="0.9"
      />
      {/* A hard shadow line right under the face, seating it on the body. */}
      <ellipse cx="50" cy="27.5" rx="47" ry="24" fill="rgba(0,0,0,0.35)" />
      {/* The face. */}
      <ellipse cx="50" cy="26" rx="47" ry="24" fill={face} />
      {/* Spots crossing the face rim, aligned with the edge stripes. */}
      <ellipse
        cx="50"
        cy="26"
        rx="42.5"
        ry="20"
        fill="none"
        stroke={spot}
        strokeWidth="8.5"
        strokeDasharray="10.5 12"
        strokeDashoffset="-5.2"
      />
      {/* The inlay: the printed centre disc every clay chip carries. */}
      <ellipse cx="50" cy="26" rx="30" ry="13.5" fill={inlay} />
      <ellipse
        cx="50"
        cy="26"
        rx="30"
        ry="13.5"
        fill="none"
        stroke={light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.28)"}
        strokeWidth="1.6"
      />
      {/* Light landing on the near rim of the face. */}
      <path
        d="M 8 20 A 47 24 0 0 1 92 20"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="2.5"
        opacity="0.7"
      />
      {value !== undefined && (
        <text
          x="50"
          y="26"
          textAnchor="middle"
          dominantBaseline="central"
          fill={ink}
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 800,
            fontSize: value >= 100 ? 15 : 17,
            letterSpacing: "0.02em",
          }}
        >
          {value}
        </text>
      )}
    </svg>
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
          which is what makes a pile look like a pile. The top chip of every
          column carries its printed denomination — the buried ones only show
          their edges, the same as on a real table. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3 }}>
        {columns.map(({ count, token, value }, c) => {
          const step = Math.max(3, Math.round(size * 0.26));
          return (
            <div
              key={token}
              style={{
                position: "relative",
                width: size,
                height: step * (count - 1) + Math.round(size * 0.63),
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
                  <Coin
                    size={size}
                    token={token}
                    value={i === count - 1 && size >= 14 ? value : undefined}
                  />
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
