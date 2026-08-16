"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { spring, z } from "@/styles/theme";

/** A panel. The default container for anything that is not the felt. */
export function Panel({
  children,
  padded = true,
  style,
  onClick,
  hoverable = false,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
  hoverable?: boolean;
}) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={hoverable ? { y: -2, background: "var(--surface-2)" } : undefined}
      transition={spring.snappy}
      style={{
        background: "var(--grad-surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-panel)",
        boxShadow: "var(--shadow-1)",
        padding: padded ? 20 : 0,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

/** A labelled value. Numbers get tabular figures so they do not shift. */
export function Stat({
  label,
  value,
  tone,
  size = "md",
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = { sm: "var(--t-base)", md: "var(--t-md)", lg: "var(--t-lg)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: "var(--t-xs)",
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
        }}
      >
        {label}
      </span>
      <span
        className="tnum"
        style={{
          fontSize: sizes[size],
          color: tone ?? "var(--text)",
          fontFamily: "var(--font-display)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 8, 6, 0.72)",
            backdropFilter: "blur(3px)",
            display: "grid",
            placeItems: "center",
            zIndex: z.modal,
            // Keep clear of notches and home bars; dvh keeps the box inside
            // the screen a phone actually shows once its bars settle.
            padding:
              "max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px))",
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={spring.gentle}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: width,
              maxHeight: "min(85dvh, 720px)",
              overflowY: "auto",
              overscrollBehavior: "contain",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-modal)",
              boxShadow: "var(--shadow-3)",
              padding: 24,
            }}
          >
            <h2 style={{ fontSize: "var(--t-md)", marginBottom: 16 }}>{title}</h2>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Loading placeholder that shimmers rather than blinking. */
export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number }) {
  return (
    <motion.div
      animate={{ opacity: [0.35, 0.6, 0.35] }}
      transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
      style={{
        width,
        height,
        borderRadius: 5,
        background: "var(--surface-2)",
      }}
    />
  );
}
