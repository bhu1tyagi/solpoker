"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";
import { ChipGlyph } from "@/components/primitives/Chip";
import { Logo } from "@/components/primitives/Logo";

// The wallet button reaches for window on mount, so it cannot render on the server.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div style={{ width: 152, height: 38 }} /> },
);

export function TopBar({ chips }: { chips?: number }) {
  return (
    <header
      className="topbar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        borderBottom: "none",
        backgroundImage:
          "linear-gradient(180deg, color-mix(in srgb, var(--c-felt) 92%, transparent), color-mix(in srgb, var(--c-felt) 55%, transparent))",
        boxShadow: "0 1px 0 var(--c-rule)",
        position: "sticky",
        top: 0,
        backdropFilter: "blur(10px)",
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Link
          href="/"
          aria-label="Pokerable home"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            // The wordmark alone was a short, thin hit target. Padding takes it
            // to a comfortable tap without moving the text off the bar's line.
            padding: "6px 8px",
            margin: "-6px -8px",
            borderRadius: "var(--r-lg)",
            fontFamily: "var(--font-display)",
            fontSize: "var(--t-body-lg-size)",
            color: "var(--c-ink)",
            textDecoration: "none",
            letterSpacing: "-0.01em",
          }}
        >
          {/* Decorative: the wordmark beside it already says the name. */}
          <Logo size={22} />
          <span className="wordmark-solana">Pokerable</span>
        </Link>
        <Link
          href="/trust"
          style={{
            fontSize: "var(--t-body-sm-size)",
            color: "var(--c-ink-muted)",
            textDecoration: "none",
          }}
        >
          Trust model
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {chips !== undefined && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--c-felt-raised)",
              border: "1px solid var(--c-rule)",
              borderRadius: 999,
              padding: "6px 14px 6px 8px",
            }}
          >
            <ChipGlyph size={18} />
            <span
              className="num"
              style={{
                fontSize: "var(--t-body-size)",
                fontWeight: 700,
                color: "var(--c-ink)",
              }}
            >
              <AnimatedNumber value={chips} />
            </span>
            <span style={{ fontSize: "var(--t-label-size)", color: "var(--c-ink-faint)" }}>
              chips
            </span>
          </div>
        )}
        <WalletMultiButton />
      </div>
    </header>
  );
}
