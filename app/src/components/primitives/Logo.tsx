/**
 * The Pokerable mark.
 *
 * A poker chip in Solana's colours with the spade at its centre, on a slate
 * tile lit from the top left like every
 * other surface in the room. Three candidates were drawn and rendered at 16, 20,
 * 32, 64 and 160 before this one was picked, which is the only way to choose a
 * mark honestly: the version with two hole cards fanned behind it is prettier at
 * 160 and turns to mush by 20, and a bevel down the top edge disappears below 64
 * while reading glossy above it. What survives every size is one bold shape.
 *
 * The tile is not decoration. A bare cyan spade sits on whatever the browser
 * paints behind a tab, which on a light theme is cyan on near-white, and the
 * tile is what guarantees the contrast in both.
 *
 * Corners are near-square on purpose: the design system's softest radius is 8px
 * on a modal, and a pill-round icon would belong to a different product.
 *
 * Kept in one file because `app/icon.svg` draws the same geometry. If this
 * changes, change that too, or the tab and the header stop agreeing.
 */

/** The spade, drawn in a 100x100 box with the stem integrated. */
export const SPADE_PATH =
  "M50 12 C 38 28, 17 39, 17 55 C 17 66, 25 74, 35 74 C 41 74, 46 71, 48 67 " +
  "C 47 76, 44 83, 37 89 L 63 89 C 56 83, 53 76, 52 67 C 54 71, 59 74, 65 74 " +
  "C 75 74, 83 66, 83 55 C 83 39, 62 28, 50 12 Z";

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
        {/* The same top-left light source as --bg-grad and every panel. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#43535e" />
          <stop offset="1" stopColor="#161f25" />
        </linearGradient>
        {/* The spade wears the chain's colours: Solana's purple-to-green,
            run bottom-left to top-right at the same angle as its bars. */}
        <linearGradient id={`${gradientId}-suit`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="96"
        height="96"
        rx="10"
        fill={`url(#${gradientId})`}
        stroke="#61737f"
        strokeWidth="2"
      />
      {/* The chip: a gradient ring with eight edge spots knocked out in the
          tile's own dark, which is what makes a circle read as a poker chip
          rather than a coin. */}
      <circle
        cx="50"
        cy="50"
        r="39"
        fill="none"
        stroke={`url(#${gradientId}-suit)`}
        strokeWidth="9"
      />
      <circle
        cx="50"
        cy="50"
        r="39"
        fill="none"
        stroke="#1d262d"
        strokeWidth="9"
        strokeDasharray="15.3 15.3"
        strokeDashoffset="7.65"
      />
      {/* Nudged a unit low: a spade carries its weight in the lobes, so a
          mathematically centred one reads as sitting high in the frame. */}
      <g transform="translate(50 51) scale(0.56) translate(-50 -50)">
        <path d={SPADE_PATH} fill={`url(#${gradientId}-suit)`} />
      </g>
    </svg>
  );
}
