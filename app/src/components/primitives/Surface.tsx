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
            background: "var(--scrim)",
            backdropFilter: "blur(8px) saturate(0.7)",
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
              // Opaque, deliberately. This was `--surface`, which is 24%
              // alpha, so a dialog opened over the felt had a poker table
              // showing through the middle of it — every number competing with
              // a card back behind it. A dialog is a thing on top of the room,
              // not a window into it.
              background:
                "linear-gradient(180deg, #2a3640 0%, var(--surface-solid) 46%, #1e2831 100%)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--r-modal)",
              boxShadow: "var(--shadow-3), var(--highlight-soft)",
              padding: "var(--sp-6)",
            }}
          >
            {/* The chain's colours as a hairline across the top: the one
                signature every dialog shares. */}
            <div
              aria-hidden
              style={{
                height: 3,
                margin: "calc(var(--sp-6) * -1) calc(var(--sp-6) * -1) var(--sp-5)",
                background: "var(--sol-grad-flat)",
                borderRadius: "var(--r-modal) var(--r-modal) 0 0",
              }}
            />
            <h2
              className="sol-text"
              style={{
                fontSize: "var(--t-md)",
                letterSpacing: "-0.01em",
                marginBottom: "var(--sp-5)",
              }}
            >
              {title}
            </h2>
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
