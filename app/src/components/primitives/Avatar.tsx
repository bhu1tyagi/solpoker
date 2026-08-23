"use client";

/**
 * A generated character for each public key.
 *
 * Players need to tell each other apart at a glance. Suit glyphs read as
 * icons, not identities; this draws a small face instead — head, eyes,
 * mouth, with colour and features taken from the key — so every wallet gets
 * a recognisable little character. Drawn inline because the CSP forbids
 * fetching an image, and deterministic so a seat keeps its face forever.
 * 8 grounds x 4 heads x 5 eyes x 5 mouths = 800 distinct characters.
 */

const GROUNDS: [string, string][] = [
  ["#7b3ff2", "#12b981"],
  ["#5b4dff", "#2e9be6"],
  ["#c2410c", "#e8b44a"],
  ["#be3455", "#7c2d5e"],
  ["#0f766e", "#2dd4a8"],
  ["#4338ca", "#8b5cf6"],
  ["#9d174d", "#e85d75"],
  ["#3f6212", "#84cc16"],
];

/** Head tones, warm to deep, all carrying dark features well. */
const SKINS = ["#f5d7b8", "#e8b98a", "#c9895c", "#9c6644"];

const INK = "#2b2118";

function hashOf(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Eye variants, drawn around (35,42) and (65,42). */
function eyes(kind: number): React.ReactNode {
  switch (kind) {
    case 0: // round
      return (<>
        <circle cx="35" cy="42" r="4.6" fill={INK} />
        <circle cx="65" cy="42" r="4.6" fill={INK} />
      </>);
    case 1: // happy arcs
      return (<>
        <path d="M29 43 Q35 36 41 43" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M59 43 Q65 36 71 43" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />
      </>);
    case 2: // sleepy lines
      return (<>
        <path d="M29 42 H41" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <path d="M59 42 H71" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      </>);
    case 3: // wink
      return (<>
        <circle cx="35" cy="42" r="4.6" fill={INK} />
        <path d="M59 42 H71" stroke={INK} strokeWidth="4" strokeLinecap="round" />
      </>);
    default: // wide with shine
      return (<>
        <circle cx="35" cy="42" r="5.6" fill={INK} />
        <circle cx="65" cy="42" r="5.6" fill={INK} />
        <circle cx="36.8" cy="40.2" r="1.7" fill="#fff" />
        <circle cx="66.8" cy="40.2" r="1.7" fill="#fff" />
      </>);
  }
}

/** Mouth variants, drawn around (50,62). */
function mouth(kind: number): React.ReactNode {
  switch (kind) {
    case 0: // smile
      return <path d="M40 60 Q50 70 60 60" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />;
    case 1: // grin
      return <path d="M39 59 Q50 72 61 59 Q50 63 39 59 Z" fill={INK} />;
    case 2: // neutral
      return <path d="M42 63 H58" stroke={INK} strokeWidth="4" strokeLinecap="round" />;
    case 3: // small o
      return <circle cx="50" cy="63" r="4.4" fill={INK} />;
    default: // smirk
      return <path d="M42 63 Q52 68 60 60" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" />;
  }
}

export function Avatar({
  pubkey,
  size = 40,
  ring,
  square = false,
}: {
  pubkey: string;
  size?: number;
  ring?: string;
  /** Fill a square tile, the way the seat plates use it. */
  square?: boolean;
}) {
  const h = hashOf(pubkey);
  const [c1, c2] = GROUNDS[h % GROUNDS.length];
  const skin = SKINS[(h >> 3) % SKINS.length];
  const eyeKind = (h >> 7) % 5;
  const mouthKind = (h >> 11) % 5;
  const angle = 120 + ((h >> 15) % 5) * 24;
  const blush = ((h >> 19) & 3) === 0;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: square ? "var(--r-panel)" : "30%",
        overflow: "hidden",
        position: "relative",
        background: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
        boxShadow: ring
          ? `0 0 0 2px ${ring}`
          : "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -6px 12px rgba(7,12,15,0.25)",
        flexShrink: 0,
      }}
    >
      <svg aria-hidden width="100%" height="100%" viewBox="0 0 100 100" style={{ display: "block" }}>
        {/* Head, cropped by the tile at the chin like a portrait. */}
        <circle cx="50" cy="56" r="34" fill={skin} />
        {eyes(eyeKind)}
        {mouth(mouthKind)}
        {blush && (<>
          <circle cx="27" cy="54" r="5" fill="rgba(235,110,110,0.45)" />
          <circle cx="73" cy="54" r="5" fill="rgba(235,110,110,0.45)" />
        </>)}
      </svg>
    </div>
  );
}

/** Short form of a public key, for labels. */
export const shortKey = (k: string) => `${k.slice(0, 4)}..${k.slice(-4)}`;
