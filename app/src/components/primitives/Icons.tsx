"use client";

import { useId } from "react";

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
 * A slab stack with one chip standing in front is the shape people already
 * read as poker chips. It is drawn at two levels of detail, chosen by size.
 *
 * The chip occludes the stack with a MASK, not an opaque fill. A fill has to
 * name a colour, and the moment this icon sat on a green button that colour
 * was wrong and the chip turned into a black blob. A hole is correct on
 * every surface.
 *
 * The rim dashes are the chip's edge spots. They sit close to the mark's
 * dashed ring, which is reserved for the turn clock, the loader and the
 * privacy indicator; the slab stack behind is what keeps the two apart.
 */
/* A finer line for the detailed cut: three concentric rings at the set's
   shared 2px weight close into a blob. */
const chipFrame = (size: number) => ({ ...frame(size), strokeWidth: 1.7 });

export function TableIcon({ size = 20 }: Props) {
  // Unique per instance: several render on one page, and a shared mask id
  // would have them all resolve against whichever mounted first.
  const id = useId();

  // Eight edge spots, cut into the rim itself rather than drawn as a separate
  // ring inside it.
  //
  // This is the detail that says "poker chip", so it is the last thing that
  // can be allowed to drop out — and an inner ring is exactly what does drop
  // out. Nearly every use of this icon is 15 to 22px, where the chip is only
  // eight or nine pixels across; three concentric strokes inside that close
  // into a smudge no matter how they are tuned. Notching the rim costs no
  // second ring, survives at any size, and is what a real chip's edge does.
  // Eight is also what the Pokerable mark uses, so the two agree.
  //
  // Butt caps, explicitly. The set rounds its line ends, and round caps grow
  // each dash by half a stroke at both ends — at 16px that is the whole gap,
  // and the spots seal into a plain circle.
  const spots = {
    strokeDasharray: "3 1.95",
    strokeDashoffset: "1.5",
    strokeLinecap: "butt" as const,
  };
  // The chip, at the same place and size whatever the cut.
  const chip = { cx: 7.6, cy: 14.4 };
  const detailed = size >= 28;

  return (
    <svg {...chipFrame(size)}>
      <defs>
        <mask id={id}>
          <rect x="0" y="0" width="24" height="24" fill="white" />
          {/* A shade wider than the chip, so the slab ends stop clear of its
              rim instead of kissing it. */}
          <circle {...chip} r="7.6" fill="black" />
        </mask>
      </defs>
      {/* Slabs nudged left or right of the one below. A perfectly aligned
          pile reads as a stack of paper; real chips never land squarely on
          each other. The fifth is the one piece of detail that IS size-aware:
          five slabs leave two thirds of a pixel between them at 16px. */}
      <g mask={`url(#${id})`}>
        {detailed ? (
          <>
            <rect x="11" y="2.2" width="10.5" height="2.3" rx="1.15" />
            <rect x="12.4" y="5.5" width="9" height="2.3" rx="1.15" />
            <rect x="10.6" y="8.8" width="10.6" height="2.3" rx="1.15" />
            <rect x="12.6" y="12.1" width="8.8" height="2.3" rx="1.15" />
            <rect x="11.2" y="15.4" width="10" height="2.3" rx="1.15" />
          </>
        ) : (
          <>
            <rect x="11" y="3" width="10.5" height="2.6" rx="1.3" />
            <rect x="12.5" y="7.4" width="9" height="2.6" rx="1.3" />
            <rect x="10.8" y="11.8" width="10.7" height="2.6" rx="1.3" />
            <rect x="12.3" y="16.2" width="9.2" height="2.6" rx="1.3" />
          </>
        )}
      </g>
      <circle {...chip} r="6.3" {...spots} />
      {/* Big enough to be a chip's centre pad rather than a punched hole,
          and far enough inside the rim to stay clear of it at 15px. */}
      <circle {...chip} r="2.65" />
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
/**
 * Opening a table uses the same chips, with no plus.
 *
 * Kept as its own export rather than collapsing the two call sites onto
 * TableIcon, so the places that mean "make one" stay distinguishable from
 * the places that mean "here is one" if they ever need to diverge again.
 */
export const NewTableIcon = TableIcon;

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
    <svg
      width={size}
      height={size}
      viewBox="0 0 2000 2000"
      fill="none"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/*
        Circle's own USDC mark, verbatim, at its native viewBox. A trademark
        is drawn in its own colours or it is not that trademark, so this sits
        outside the palette on purpose, the same exemption the MagicBlock
        lockup gets.

        What this replaced was drawn from memory and had no arcs at all,
        which are most of what makes the mark recognisable at a glance.
      */}
      <path
        d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z"
        fill="#2775ca"
      />
      <path
        d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z"
        fill="#fff"
      />
      <path
        d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z"
        fill="#fff"
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
