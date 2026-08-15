"use client";

/**
 * A geometric avatar derived from a public key.
 *
 * Players need to tell each other apart at a glance, and a truncated base58
 * string does not do that. The same key always gives the same shape and colors,
 * so a seat stays recognisable across hands.
 */

const HUES = [38, 152, 200, 280, 12, 96, 320, 250];

function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function Avatar({
  pubkey,
  size = 40,
  ring,
}: {
  pubkey: string;
  size?: number;
  ring?: string;
}) {
  const h = hashOf(pubkey);
  const hue = HUES[h % HUES.length];
  const hue2 = HUES[(h >> 3) % HUES.length];
  const cells = 4;
  const cell = size / cells;

  // A symmetric bit pattern, the way identicons do it.
  const bits: boolean[] = [];
  for (let i = 0; i < cells * Math.ceil(cells / 2); i++) {
    bits.push(((h >> i % 30) & 1) === 1);
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "30%",
        overflow: "hidden",
        position: "relative",
        background: `linear-gradient(140deg, hsl(${hue} 34% 24%), hsl(${hue2} 30% 15%))`,
        boxShadow: ring ? `0 0 0 2px ${ring}` : "inset 0 0 0 1px rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}
    >
      {Array.from({ length: cells }, (_, y) =>
        Array.from({ length: cells }, (_, x) => {
          const mirroredX = x < cells / 2 ? x : cells - 1 - x;
          const on = bits[y * Math.ceil(cells / 2) + mirroredX];
          if (!on) return null;
          return (
            <div
              key={`${x}-${y}`}
              style={{
                position: "absolute",
                left: x * cell,
                top: y * cell,
                width: cell,
                height: cell,
                background: `hsl(${hue} 46% 58% / 0.55)`,
              }}
            />
          );
        }),
      )}
    </div>
  );
}

/** Short form of a public key, for labels. */
export const shortKey = (k: string) => `${k.slice(0, 4)}..${k.slice(-4)}`;
