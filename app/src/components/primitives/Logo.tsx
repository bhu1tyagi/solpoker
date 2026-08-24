/**
 * The Pokerable mark.
 *
 * A poker chip in Solana's colours with the spade at its centre, standing on
 * its own — no tile. The chip's eight edge spots are real gaps in the ring
 * rather than dark paint, which is what lets the mark sit on any ground: the
 * background shows through the spots the way the felt shows through a real
 * chip's edge. Rendered at 16, 20, 32, 64 and 160 before shipping; one bold
 * shape is what survives every size.
 *
 * Kept in one file because `app/icon.svg` draws the same geometry. If this
 * changes, change that too, or the tab and the header stop agreeing.
 */

/** The spade, drawn in a 100x100 box with the stem integrated. */
export const SPADE_PATH =
  "M50 12 C 38 28, 17 39, 17 55 C 17 66, 25 74, 35 74 C 41 74, 46 71, 48 67 " +
  "C 47 76, 44 83, 37 89 L 63 89 C 56 83, 53 76, 52 67 C 54 71, 59 74, 65 74 " +
  "C 75 74, 83 66, 83 55 C 83 39, 62 28, 50 12 Z";

/**
 * The chip as a letterform: the 'o' of the wordmark. Same geometry as the
 * mark, redrawn with the ring fattened to Dela Gothic's stroke weight so it
 * reads as a letter among letters rather than an icon that wandered in. Both
 * numbers are tuned to that face specifically, which is why the wordmark keeps
 * it even though the rest of the type system moved on. The hidden 'o' beside
 * it keeps the word whole for screen readers, searches and the page checks:
 * the visible text alone would spell "Pkerable".
 */
export function ChipO({ size = "0.62em" }: { size?: string }) {
  const id = "pokerable-chip-o";
  return (
    <>
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
        }}
      >
        o
      </span>
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox="0 0 100 100"
        style={{
          display: "inline-block",
          verticalAlign: "baseline",
          marginBottom: "-0.015em",
        }}
      >
        <defs>
          <linearGradient id={`${id}-suit`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#9945FF" />
            <stop offset="1" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="41"
          fill="none"
          stroke={`url(#${id}-suit)`}
          strokeWidth="15"
          strokeDasharray="19.7 12.5"
          strokeDashoffset="9.85"
        />
        <g transform="translate(50 51) scale(0.44) translate(-50 -50)">
          <path d={SPADE_PATH} fill={`url(#${id}-suit)`} />
        </g>
      </svg>
    </>
  );
}

export function Logo({
  size = 22,
  title,
}: {
  /**
   * A number of pixels, or any CSS length. Pass `"1em"` next to text that
   * scales: a fixed pixel mark beside a `clamp()` wordmark is correct at one
   * width and wrong at every other, and reads oversized on a phone.
   */
  size?: number | string;
  /**
   * Only pass this where the mark stands alone. Beside the wordmark it is
   * decorative, and a title there makes a screen reader say the name twice.
   */
  title?: string;
}) {
  const gradientId = "pokerable-mark-tile";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        {/* The chain's colours: Solana's purple-to-green, run bottom-left to
            top-right at the same angle as its bars. */}
        <linearGradient id={`${gradientId}-suit`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      {/* The chip: eight fat segments with real gaps between them, plus a
          thin continuous inner ring that closes the circle. Solid-ring chips
          need a contrast colour behind their spots; gaps work everywhere. */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke={`url(#${gradientId}-suit)`}
        strokeWidth="10"
        strokeDasharray="20.3 12.7"
        strokeDashoffset="10.15"
      />
      <circle
        cx="50"
        cy="50"
        r="33"
        fill="none"
        stroke={`url(#${gradientId}-suit)`}
        strokeWidth="2.5"
        opacity="0.7"
      />
      {/* Nudged a unit low: a spade carries its weight in the lobes, so a
          mathematically centred one reads as sitting high in the frame. */}
      <g transform="translate(50 51) scale(0.5) translate(-50 -50)">
        <path d={SPADE_PATH} fill={`url(#${gradientId}-suit)`} />
      </g>
    </svg>
  );
}
