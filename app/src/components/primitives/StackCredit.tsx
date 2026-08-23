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

export function BlockMark({ size = 13 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      <path d="M12 2.6 L20.4 7.3 V16.7 L12 21.4 L3.6 16.7 V7.3 Z" />
      <path d="M3.6 7.3 L12 12 L20.4 7.3 M12 12 V21.4" />
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
