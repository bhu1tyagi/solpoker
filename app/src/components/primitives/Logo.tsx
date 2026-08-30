/**
 * The Pokerable brand art.
 *
 * The identity is illustrated, not drawn in CSS: a neon-lit raccoon in a
 * tuxedo, and a script wordmark beside it. Both ship as pre-lit PNGs with
 * their own glow baked in, so nothing here re-lights them — a filter or a
 * gradient laid over this art fights the rendering rather than adding to it.
 *
 * Two assets, two jobs:
 *   /logo-*.png   the mark alone (square, transparent), for anywhere the
 *                 name is already spoken by neighbouring text — the tab, the
 *                 home screen, the card back, the felt.
 *   /wordmark.png the horizontal lockup, mark and script together, for
 *                 anywhere the brand has to introduce itself.
 *
 * The tab and home-screen icons are the same art at app/icon.png and
 * app/apple-icon.png, served by Next's file convention. If the mark changes,
 * regenerate those from the same source or the tab and the header stop
 * agreeing.
 */

/**
 * The spade, drawn in a 100x100 box with the stem integrated.
 *
 * A playing-card suit, not the brand mark — the hero's ace and the felt's
 * print are the only callers. It lives here because it was drawn alongside
 * the old chip mark, and moving it now would touch two files for nothing.
 */
export const SPADE_PATH =
  "M50 12 C 38 28, 17 39, 17 55 C 17 66, 25 74, 35 74 C 41 74, 46 71, 48 67 " +
  "C 47 76, 44 83, 37 89 L 63 89 C 56 83, 53 76, 52 67 C 54 71, 59 74, 65 74 " +
  "C 75 74, 83 66, 83 55 C 83 39, 62 28, 50 12 Z";

/**
 * The heart, in the same 100x100 box and drawn to the same mass as the spade
 * above — it spans x 15..85 against the spade's 17..83, so the two sit at the
 * same optical size when one card is turned over to reveal the other.
 */
export const HEART_PATH =
  "M50 88 C 31 72, 15 58, 15 40 C 15 27, 24 18, 34 18 C 42 18, 47 22, 50 28 " +
  "C 53 22, 58 18, 66 18 C 76 18, 85 27, 85 40 C 85 58, 69 72, 50 88 Z";

/**
 * The wordmark: the full lockup, mark and script together.
 *
 * Sized by HEIGHT, in ems or pixels, and the width follows from the art's own
 * aspect. Sizing by width instead would let a narrow header squash the script
 * into something unreadable at exactly the moment it has least room.
 *
 * The art is trimmed to its own ink, so a height here is the height of the
 * drawing rather than of a box with air around it. Before the trim, a
 * nominally correct 34px read as an undersized mark because a third of it was
 * transparent margin.
 *
 * `alt` carries the name, so no hidden text is needed beside it: the image is
 * the brand's only statement of it in the header and the footer.
 */
export function Wordmark({ size = "2.5rem" }: { size?: number | string }) {
  return (
    <img
      src="/wordmark.png"
      alt="Pokerable"
      className="wordmark"
      draggable={false}
      style={{ height: size }}
    />
  );
}
