"use client";

/**
 * The icon set.
 *
 * Drawn here rather than pulled from a package, because the pages have to work
 * with no network and every icon has to sit on the same 24 unit grid with the
 * same stroke weight. They all take their colour from the text around them.
 */

type Props = { size?: number; className?: string };

const svg = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  "aria-hidden": true,
  style: { display: "block" as const, flexShrink: 0 },
});

const stroke = {
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * A poker table from above: the rail and the felt inside it.
 *
 * Drawn flat rather than on a pedestal, because a pedestal version sits beside
 * the trophy in the tab bar and the two become the same silhouette.
 */
export function TableIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <ellipse cx="12" cy="12" rx="9.5" ry="6.5" {...stroke} />
      <ellipse cx="12" cy="12" rx="5.5" ry="3" {...stroke} strokeWidth={1.6} />
    </svg>
  );
}

/** Two people: how many are sitting. */
export function PlayersIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <circle cx="9" cy="8" r="3.4" {...stroke} />
      <path d="M3 19.5c0-3 2.7-5 6-5s6 2 6 5" {...stroke} />
      <path d="M16.5 5.2a3.4 3.4 0 0 1 0 5.6M18 14.9c2 .7 3.4 2.4 3.4 4.6" {...stroke} />
    </svg>
  );
}

/** Plus, for buying in. */
export function PlusIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <path d="M12 5v14M5 12h14" {...stroke} strokeWidth={2.4} />
    </svg>
  );
}

/** An arrow leaving a tray: cashing out. */
export function CashOutIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <path d="M12 15V4M8.5 7.5L12 4l3.5 3.5" {...stroke} />
      <path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" {...stroke} />
    </svg>
  );
}

/** A clock wound backwards: history. */
export function HistoryIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <path d="M3.5 9.5A9 9 0 1 1 3 12" {...stroke} />
      <path d="M3 4.5v5h5" {...stroke} />
      <path d="M12 7.5V12l3 2" {...stroke} />
    </svg>
  );
}

/** A question in a circle: how this works. */
export function InfoIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <circle cx="12" cy="12" r="9" {...stroke} />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4" {...stroke} />
      <path d="M12 17h.01" {...stroke} strokeWidth={2.6} />
    </svg>
  );
}

/** A door with an arrow: leaving. */
export function ExitIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <path d="M14 4h5v16h-5" {...stroke} />
      <path d="M11 8l-4 4 4 4M7 12h10" {...stroke} />
    </svg>
  );
}

/** Circular arrows: reload the list. */
export function RefreshIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" {...stroke} />
      <path d="M20 4v4.5h-4.5" {...stroke} />
    </svg>
  );
}

/** A cup on a plinth: the leaderboard. */
export function TrophyIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" {...stroke} />
      <path d="M7 6H4.5v1.5A3.5 3.5 0 0 0 8 11M17 6h2.5v1.5A3.5 3.5 0 0 1 16 11" {...stroke} />
      <path d="M12 14v3.5M8.5 20h7" {...stroke} />
    </svg>
  );
}

/** A table with a plus: start a new one. */
export function NewTableIcon({ size = 20 }: Props) {
  return (
    <svg {...svg(size)}>
      <ellipse cx="10.5" cy="13" rx="8" ry="5.5" {...stroke} />
      <path d="M18.5 3v5.5M15.75 5.75h5.5" {...stroke} strokeWidth={2.2} />
    </svg>
  );
}
