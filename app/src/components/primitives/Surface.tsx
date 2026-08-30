"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "@/components/primitives/Icons";
import { spring } from "@/styles/theme";

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

/**
 * The one dialog in the product.
 *
 * The head stays put and the body scrolls under it, which is what a dialog
 * carrying a list needs and costs a dialog carrying three controls nothing.
 * Escape closes it, the scrim closes it, and the page behind it stops
 * scrolling while it is up — a dialog that leaves the room moving underneath
 * reads as an overlay rather than as the thing you are now doing.
 */
export function Modal({
  open,
  onClose,
  title,
  hint,
  children,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** A quiet fact beside the title. Not a subtitle — one short line. */
  hint?: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  const headingId = useId();
  const box = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  // The page behind it must not scroll under it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            className="modal-box"
            style={{ maxWidth: width }}
            initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
            transition={spring.gentle}
            onClick={(e) => e.stopPropagation()}
          >
            {/* No gradient bar across the top. The purple-to-green sweep is
                the mark's, and a dialog chrome that borrows it turns an
                identity into a paint bucket. A plain rule does the same job of
                separating the title from the body. */}
            <header className="modal-head">
              <h2 id={headingId}>{title}</h2>
              {hint && <span className="modal-hint">{hint}</span>}
              <button
                type="button"
                className="modal-close"
                onClick={onClose}
                aria-label="Close"
              >
                <CloseIcon size={18} />
              </button>
            </header>
            <div className="modal-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Loading placeholder that shimmers rather than blinking. */
/**
 * The loading atom.
 *
 * CSS rather than a motion loop, and that is a correctness fix rather than a
 * refactor: the previous version animated opacity with `repeat: Infinity`,
 * which keeps pulsing under `prefers-reduced-motion` because a JS animation
 * has no idea the reader asked for stillness. The design rules say float and
 * pulse loops stop entirely, so the sweep lives in a stylesheet where the
 * media query can actually switch it off.
 *
 * Rarely used alone. A bare grey box is not a skeleton, it is a hole with a
 * shimmer on it — see Skeletons.tsx for the shapes that mirror real layouts.
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = "var(--r-sm)",
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
}) {
  return <div className="skel" style={{ width, height, borderRadius: radius }} />;
}
