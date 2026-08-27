"use client";

/**
 * The icon set.
 *
 * These are Lucide outlines (ISC licensed) rather than shapes drawn by hand, so
 * they carry the proportions and stroke weight of a set people already
 * recognise. They are inlined instead of fetched because the pages have to work
 * with no network, and they take their colour from the text around them.
 */

type Props = { size?: number };

const frame = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  style: { display: "block" as const, flexShrink: 0 },
});

/** Clock: the action timer. */
export function ClockIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/** Spade: the suit, standing for a poker table. */
/*
 * Chips, for a table.
 *
 * Three other shapes were drawn and rejected at 16px, which is the size these
 * are actually used at. A racetrack with seat pips was semantically exact and
 * closed into a pill. A single chip with full edge spots becomes a gear, and
 * would have collided with the mark, whose dashed ring already means three
 * specific things. A side-on stack is legible but is the universally
 * recognised database glyph.
 *
 * A banded stack with one chip standing on edge in front is the shape people
 * already read as poker chips, and it survives 16px: the stack's two bands
 * stay separate, and the standing chip keeps its inner ring.
 */
export function TableIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      {/* The stack, seen from the side: one rim and two banded layers. */}
      <ellipse cx="16.5" cy="6.5" rx="4.8" ry="2.1" />
      <path d="M11.7 6.5v3c0 1.2 2.1 2.1 4.8 2.1s4.8-.9 4.8-2.1v-3M11.7 9.5v3c0 1.2 2.1 2.1 4.8 2.1s4.8-.9 4.8-2.1v-3" />
      {/* The chip standing on edge in front, face toward the reader. */}
      <circle cx="8" cy="15.5" r="5.6" />
      <circle cx="8" cy="15.5" r="2" />
    </svg>
  );
}

export function TrophyIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

export function PlayersIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function PlusIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** Upload: taking value back out. */
export function CashOutIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

export function HistoryIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

export function InfoIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function ExitIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function RefreshIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

/** A spade with a plus: open a new table. */
/** One chip and a plus: opening a table rather than joining one. */
export function NewTableIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="2.5" />
      <path d="M19 15v6M16 18h6" />
    </svg>
  );
}

export function SoundIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M11 4.7 6.6 8.2H3v7.6h3.6L11 19.3V4.7Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

export function MutedIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M11 4.7 6.6 8.2H3v7.6h3.6L11 19.3V4.7Z" />
      <path d="M22 9.5 16 15.5M16 9.5l6 6" />
    </svg>
  );
}

/** A wallet, for the connect control. */
/**
 * A dollar coin, for the deposit currency. Deliberately our own mark and not
 * Circle's: this stands for "the stablecoin you deposit", and borrowing a
 * company's logo to say that would claim an endorsement nobody gave.
 */
export function UsdcMark({ size = 20 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* USDC's own mark. A trademark is drawn in its own colours or it
          is not that trademark, so this one is deliberately outside the
          palette — the same exemption the MagicBlock lockup gets. */}
      <circle cx="12" cy="12" r="10.5" fill="#2775ca" />
      <path d="M12 6.1v11.8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M14.75 9.2c0-1.1-1.23-1.85-2.75-1.85S9.25 8.1 9.25 9.3c0 1.1.9 1.62 2.75 2 1.97.42 2.85 1 2.85 2.15 0 1.25-1.27 2-2.85 2s-2.85-.8-2.85-1.95"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WalletIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
      <path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Landing page.                                                       */
/*                                                                     */
/* The Superdesign draft pulls these from the Iconify CDN as a web     */
/* component. That is a render-blocking third-party request whose      */
/* glyphs hydrate after paint, so every icon pops in late. Same shapes, */
/* inlined, no runtime, no layout shift.                               */
/* ------------------------------------------------------------------ */

/** Zap: instant settlement. */
export function ZapIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  );
}

/** Shield with a check: the shuffle proof. */
export function ShieldCheckIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

/** Users: the room. */
export function UsersIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/** Play in a circle: watch the demo. */
export function PlayCircleIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <circle cx="12" cy="12" r="10" />
      <path d="m10 8 6 4-6 4V8Z" />
    </svg>
  );
}

/** Arrow right: onward. */
export function ArrowRightIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

/** Chevron right: a quieter onward, inside a link. */
export function ChevronRightIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/*
 * The three socials. Brand glyphs are solid shapes rather than outlines, so
 * they take `fill` and ignore the shared stroke frame.
 */
const brandFrame = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
  style: { display: "block" as const, flexShrink: 0 },
});

export function XIcon({ size = 20 }: Props) {
  return (
    <svg {...brandFrame(size)}>
      <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.3 22H3.2l7.3-8.3L2.5 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.3 3.7H5.5L17.8 20Z" />
    </svg>
  );
}

export function DiscordIcon({ size = 20 }: Props) {
  return (
    <svg {...brandFrame(size)}>
      <path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.2.4a15.7 15.7 0 0 1 3.7 1.2 12.6 12.6 0 0 0-9.2 0A15.7 15.7 0 0 1 13.1 4l-.2-.4a17 17 0 0 0-4.2 1.4C6 9.4 5.2 13.3 5.6 17.1A17 17 0 0 0 10.8 20l.9-1.3a11 11 0 0 1-1.8-.9l.5-.3a12 12 0 0 0 10.3 0l.5.3a11 11 0 0 1-1.8.9l.9 1.3a17 17 0 0 0 5.2-2.9c.4-4.4-.8-8.3-2.9-11.7ZM9.7 14.8c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1c1 0 1.9 1 1.9 2.1s-.9 2.1-1.9 2.1Zm4.6 0c-1 0-1.9-.9-1.9-2.1s.8-2.1 1.9-2.1c1 0 1.9 1 1.9 2.1s-.9 2.1-1.9 2.1Z" />
    </svg>
  );
}

export function GithubIcon({ size = 20 }: Props) {
  return (
    <svg {...brandFrame(size)}>
      <path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.4 9.4 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7 1 .7 2v2.9c0 .3.2.6.7.5A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

/** Copy: put the address on the clipboard. */
export function CopyIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Check: a completed step, a successful copy. */
export function CheckIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
