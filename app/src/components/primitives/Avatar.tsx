"use client";

import { AVATAR } from "@/design/tokens";

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

const GROUNDS = AVATAR.grounds;
const SKINS = AVATAR.skins;

/**
 * Pick from a list by hash, without any way to land outside it.
 *
 * The previous arithmetic could produce a negative index, and every consequence
 * of that was silent: an undefined colour is a black fill, an undefined variant
 * is whatever `switch` falls through to. Nothing throws, so nothing gets
 * noticed until half the seats are wearing the same blank face.
 */
const pick = <T,>(list: readonly T[], h: number, shift: number): T =>
  list[(h >>> shift) % list.length];

const INK = AVATAR.ink;

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
        <circle cx="36.8" cy="40.2" r="1.7" fill={AVATAR.shine} />
        <circle cx="66.8" cy="40.2" r="1.7" fill={AVATAR.shine} />
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
  // `>>>`, not `>>`, and it matters. `hashOf` returns an unsigned 32-bit value,
  // so roughly half of all keys exceed 2^31 — and the signed shift reinterprets
  // those as negative. A negative remainder in JavaScript stays negative, so
  // `SKINS[-1]` was `undefined`, and an SVG `fill` of `undefined` is black.
  // That is why half the table had featureless dark faces while the gradient
  // behind them, indexed without a shift, was always fine.
  const h = hashOf(pubkey);
  const [c1, c2] = pick(GROUNDS, h, 0);
  const skin = pick(SKINS, h, 3);
  const eyeKind = (h >>> 7) % 5;
  const mouthKind = (h >>> 11) % 5;
  const angle = 120 + ((h >>> 15) % 5) * 24;
  const blush = ((h >>> 19) & 3) === 0;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: square ? "var(--r-md)" : "30%",
        overflow: "hidden",
        position: "relative",
        background: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
        boxShadow: ring ? `0 0 0 2px ${ring}` : "var(--e-raised)",
        flexShrink: 0,
      }}
    >
      <svg aria-hidden width="100%" height="100%" viewBox="0 0 100 100" style={{ display: "block" }}>
        {/* Head, cropped by the tile at the chin like a portrait. */}
        <circle cx="50" cy="56" r="34" fill={skin} />
        {eyes(eyeKind)}
        {mouth(mouthKind)}
        {blush && (<>
          <circle cx="27" cy="54" r="5" fill={AVATAR.blush} />
          <circle cx="73" cy="54" r="5" fill={AVATAR.blush} />
        </>)}
      </svg>
    </div>
  );
}

/** Short form of a public key, for labels. */
export const shortKey = (k: string) => `${k.slice(0, 4)}..${k.slice(-4)}`;
