"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { AnimatedNumber } from "@/components/primitives/AnimatedNumber";

// The wallet button reaches for window on mount, so it cannot render on the server.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div style={{ width: 152, height: 38 }} /> },
);

export function TopBar({ chips }: { chips?: number }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 24px",
        borderBottom: "none",
        backgroundImage:
          "linear-gradient(180deg, rgba(11, 15, 22, 0.92), rgba(11, 15, 22, 0.55))",
        boxShadow: "0 1px 0 var(--line)",
        position: "sticky",
        top: 0,
        backdropFilter: "blur(10px)",
        zIndex: 30,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <Link
          href="/"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--t-md)",
            color: "var(--text)",
            textDecoration: "none",
            letterSpacing: "-0.01em",
          }}
        >
          Sol<span style={{ color: "var(--accent)" }}>Poker</span>
        </Link>
        <Link
          href="/trust"
          style={{
            fontSize: "var(--t-sm)",
            color: "var(--text-dim)",
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
              alignItems: "baseline",
              gap: 7,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: 999,
              padding: "6px 14px",
            }}
          >
            <span
              className="tnum"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--t-base)",
                color: "var(--accent)",
              }}
            >
              <AnimatedNumber value={chips} />
            </span>
            <span style={{ fontSize: "var(--t-xs)", color: "var(--text-faint)" }}>
              chips
            </span>
          </div>
        )}
        <WalletMultiButton />
      </div>
    </header>
  );
}
