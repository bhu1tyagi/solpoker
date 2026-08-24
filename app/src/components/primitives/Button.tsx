"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/styles/theme";

/**
 * Every button in the room, in one place.
 *
 * There were four parallel button styles before this: this one, a private
 * variant map inside the action bar that was a verbatim copy with a different
 * height, a `LabelButton` in the lobby, and the wallet adapter's own. They
 * disagreed on height (30 through 52), on radius (`--r-control` against
 * `--r-panel`), and on which of them owned the gradient. The extra variants
 * below exist so the other three can be deleted rather than re-invented.
 */
type Variant = "primary" | "ghost" | "danger" | "quiet" | "sol";
type Size = "sm" | "md" | "lg" | "xl";

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--gold)",
    color: "var(--on-gold)",
    fontWeight: 700,
    boxShadow: "0 6px 18px -8px var(--gold-glow), var(--highlight-inner)",
  },
  ghost: {
    background: "var(--control)",
    color: "var(--text)",
  },
  danger: {
    background: "var(--lose)",
    color: "var(--on-danger)",
    fontWeight: 600,
  },
  quiet: {
    background: "transparent",
    color: "var(--text-dim)",
  },
  // The chain's own colours, for the one or two places that are about Solana
  // rather than about money.
  sol: {
    background: "var(--sol-grad-flat)",
    color: "var(--on-sol)",
    fontWeight: 700,
  },
};

const SIZES: Record<Size, React.CSSProperties> = {
  sm: { height: 30, padding: "0 12px", fontSize: "var(--t-sm)" },
  md: { height: 38, padding: "0 18px", fontSize: "var(--t-base)" },
  lg: { height: 46, padding: "0 26px", fontSize: "var(--t-md)" },
  // Thumb-sized, for the action bar: the one row where a mis-tap costs chips.
  xl: { height: 52, padding: "0 26px", fontSize: "var(--t-md)" },
};

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  title?: string;
  style?: React.CSSProperties;
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  title,
  style,
}: Props) {
  const reduce = useReducedMotion();
  const off = disabled || loading;

  return (
    <motion.button
      onClick={off ? undefined : onClick}
      disabled={off}
      title={title}
      // The press must answer immediately, before anything reaches the chain.
      whileTap={off || reduce ? undefined : { scale: 0.97 }}
      whileHover={off || reduce ? undefined : { y: -1 }}
      transition={spring.snappy}
      style={{
        ...SIZES[size],
        ...VARIANTS[variant],
        width: fullWidth ? "100%" : undefined,
        borderRadius: "var(--r-control)",
        border: VARIANTS[variant].border ?? "1px solid transparent",
        cursor: off ? "not-allowed" : "pointer",
        opacity: off ? 0.45 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        whiteSpace: "nowrap",
        transition: "opacity 0.12s ease, background 0.12s ease",
        ...style,
      }}
    >
      {loading && <Spinner />}
      {children}
    </motion.button>
  );
}

function Spinner() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        display: "inline-block",
      }}
    />
  );
}
