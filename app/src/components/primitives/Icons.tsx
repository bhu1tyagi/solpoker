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
export function TableIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M5 9c-1.5 1.5-3 3.2-3 5.5A5.5 5.5 0 0 0 7.5 20c1.8 0 3-.5 4.5-2 1.5 1.5 2.7 2 4.5 2a5.5 5.5 0 0 0 5.5-5.5c0-2.3-1.5-4-3-5.5l-7-7-7 7Z" />
      <path d="M12 18v4" />
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
export function NewTableIcon({ size = 20 }: Props) {
  return (
    <svg {...frame(size)}>
      <path d="M4.5 10.5c-1.2 1.2-2.5 2.6-2.5 4.5A4.5 4.5 0 0 0 6.5 19.5c1.5 0 2.5-.4 3.7-1.6 1.2 1.2 2.2 1.6 3.7 1.6" />
      <path d="M10.2 17.9V21" />
      <path d="M4.5 10.5 10.2 4.8l4 4" />
      <path d="M18.5 3v6M15.5 6h6" />
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
