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
      whileHover={hoverable ? { y: -2, background: "var(--c-felt-edge)" } : undefined}
      transition={spring.snappy}
      style={{
        // Depth is rim-light, not shadow: a drop shadow is nearly invisible on
        // #0B0E14, so a raised surface is a lighter fill plus a 1px highlight
        // along its top edge, the way a real object catches light from above.
        background: "var(--c-felt-raised)",
        border: "1px solid var(--c-rule)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--e-raised)",
        padding: padded ? "var(--sp-5)" : 0,
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
            background: "color-mix(in srgb, var(--c-felt) 82%, transparent)",
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
              // Opaque, deliberately. This was once a 24%-alpha surface, so a
              // dialog opened over the felt had a poker table showing through
              // the middle of it — every number competing with a card back
              // behind it. A dialog is a thing on top of the room, not a
              // window into it.
              //
              // --e-lifted is one of the two places a real drop shadow is
              // allowed: this is genuinely floating over the table.
              background: "var(--c-felt-raised)",
              border: "1px solid var(--c-rule-strong)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--e-lifted)",
              padding: "var(--sp-6)",
            }}
          >
            {/* No gradient bar across the top. The purple-to-green sweep is
                the mark's, and a dialog chrome that borrows it turns an
                identity into a paint bucket. A plain rule does the same job of
                separating the title from the body. */}
            <div
              aria-hidden
              style={{
                height: 1,
                margin: "calc(var(--sp-6) * -1) calc(var(--sp-6) * -1) var(--sp-5)",
                background: "var(--c-rule)",
              }}
            />
            <h2
              style={{
                fontSize: "var(--t-display-md-size)",
                lineHeight: "var(--t-display-md-line)",
                letterSpacing: "var(--t-display-md-tracking)",
                color: "var(--c-ink)",
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
        borderRadius: "var(--r-sm)",
        background: "var(--c-felt-edge)",
      }}
    />
  );
}
