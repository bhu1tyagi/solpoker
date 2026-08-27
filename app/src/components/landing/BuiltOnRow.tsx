import { MAGICBLOCK_LOCKUP } from "@/components/primitives/magicblock-lockup";

/**
 * The stack row: Solana, MagicBlock, Anchor, as marks with their jobs.
 *
 * Two of the three are genuine assets. The Solana logomark is the official
 * three-bar geometry; the MagicBlock lockup is taken verbatim from
 * magicblock.xyz and already ships in this repo for the table's stack credit.
 * Anchor has no canonical logomark to borrow, so it gets a plain anchor glyph
 * beside its name rather than an invented brand mark.
 *
 * Each mark carries a one-line role, because "built on X" is only meaningful
 * to someone who already knows what X does. The role line is always in the
 * DOM, not hover-revealed: information behind a hover is invisible on touch
 * and to keyboards. Hover adds emphasis, never content.
 *
 * Still not links. A link here would read as endorsement, and these are
 * dependencies, not partners.
 */

function SolanaMark({ height = 34 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 397.7 311.7"
      height={height}
      width={(397.7 / 311.7) * height}
      fill="currentColor"
      aria-hidden
    >
      <path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7z" />
      <path d="M64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8z" />
      <path d="M333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z" />
    </svg>
  );
}

function AnchorGlyph({ height = 34 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      height={height}
      width={height}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="5" r="3" />
      <path d="M12 8v13M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

export function BuiltOnRow() {
  return (
    <ul className="built-row">
      <li className="built-item">
        <span className="built-mark">
          <SolanaMark />
          <span className="built-name">Solana</span>
        </span>
        <span className="built-role">Settlement, custody, the vault</span>
      </li>
      <li className="built-sep" aria-hidden />
      <li className="built-item">
        <span className="built-mark">
          <span
            className="built-mb"
            dangerouslySetInnerHTML={{ __html: MAGICBLOCK_LOCKUP }}
          />
        </span>
        <span className="built-role">Ephemeral rollups and the enclave</span>
      </li>
      <li className="built-sep" aria-hidden />
      <li className="built-item">
        <span className="built-mark">
          <AnchorGlyph />
          <span className="built-name">Anchor</span>
        </span>
        <span className="built-role">The program framework</span>
      </li>
    </ul>
  );
}
