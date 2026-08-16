"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/styles/theme";

type Variant = "primary" | "ghost" | "danger" | "quiet";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, React.CSSProperties> = {
  primary: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    fontWeight: 600,
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
};

const SIZES: Record<Size, React.CSSProperties> = {
  sm: { height: 30, padding: "0 12px", fontSize: "var(--t-sm)" },
  md: { height: 38, padding: "0 18px", fontSize: "var(--t-base)" },
  lg: { height: 46, padding: "0 26px", fontSize: "var(--t-md)" },
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
