/**
 * Credit where the game actually runs: Solana settles it, MagicBlock's
 * ephemeral rollups play it.
 *
 * Both marks are drawn inline because the CSP forbids fetching anything, and
 * that constraint is a feature: the room works with no network beyond the two
 * chains it talks to. The Solana mark is the three slanted bars with the
 * official gradient. MagicBlock gets a neutral wireframe block beside its
 * name rather than a hand-copied logo, because a misdrawn trademark is worse
 * than an honest glyph.
 */

const SOLANA_GRADIENT = "pokerable-solana-gradient";

export function SolanaMark({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size * 0.87}
      viewBox="0 0 100 88"
      fill="none"
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={SOLANA_GRADIENT} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${SOLANA_GRADIENT})`}
        d="M20 0 H100 L80 20.5 H0 Z M0 33.5 H80 L100 54 H20 Z M20 67.5 H100 L80 88 H0 Z"
      />
    </svg>
  );
}

/**
 * MagicBlock's own mark, supplied by the team. Their original is white; it is
 * drawn in currentColor here so it follows the credit row's text colour and
 * its hover, and stays legible on any ground the row sits on.
 */
export function BlockMark({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size * 1.69}
      height={size}
      viewBox="-150 -74 270 160"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        fill="currentColor"
        d="M113.37637329101562,-33.22443771362305 C107.31800079345703,-68.53284454345703 13.4288911819458,-65.48045349121094 -42.53285217285156,-57.61576461791992 C-80.48788452148438,-49.250335693359375 -144.578369140625,-20.65522575378418 -65.37899780273438,5.259235382080078 C-63.893001556396484,13.123235702514648 -69.54900360107422,45.26300048828125 -59.683998107910156,49.49399948120117 C-52.516998291015625,51.86000061035156 -13.607999801635742,81.1510009765625 -5.826000213623047,75.63899993896484 C76.24800109863281,37.17300033569336 62.08747863769531,64.42695617675781 69.36210632324219,-7.21024227142334 C103.56103515625,-13.84117317199707 114.99246215820312,-22.904813766479492 113.37637329101562,-33.22443771362305z"
      />
    </svg>
  );
}

/**
 * The one-line stack credit. Quiet by design: it sits under the tagline as a
 * fact about the product, not an advertisement in it.
 */
export function StackCredit() {
  const chip: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-dim)",
    textDecoration: "none",
    fontSize: "var(--t-xs)",
    fontWeight: 600,
    letterSpacing: "0.02em",
    transition: "color 0.12s ease",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        marginTop: 10,
      }}
    >
      <span
        className="label"
        style={{ fontSize: 10, letterSpacing: "0.09em", color: "var(--text-faint)" }}
      >
        built on
      </span>
      <a
        className="stack-chip"
        style={chip}
        href="https://solana.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        <SolanaMark />
        Solana
      </a>
      <span aria-hidden style={{ color: "var(--text-faint)" }}>
        ·
      </span>
      <a
        className="stack-chip"
        style={chip}
        href="https://www.magicblock.xyz"
        target="_blank"
        rel="noopener noreferrer"
      >
        <BlockMark />
        MagicBlock
        <span style={{ fontWeight: 400, color: "var(--text-faint)" }}>
          ephemeral rollups
        </span>
      </a>
    </div>
  );
}
