"use client";

import { AnimatePresence, motion } from "motion/react";
import { useUiStore } from "@/stores/ui-store";
import { spring } from "@/styles/theme";

/**
 * A tone is a small mark and a tint, not a coloured slab.
 *
 * The previous version put a 2px bar down the left edge of a translucent
 * panel, which read as a browser notification that had wandered in. These sit
 * on the room's own opaque surface with a soft ring in the tone's colour, so
 * good and bad are distinguishable at a glance without either shouting.
 */
const TONES = {
  info: { color: "var(--info)", glyph: "i" },
  good: { color: "var(--win)", glyph: "✓" },
  bad: { color: "var(--lose)", glyph: "!" },
};

export function ToastViewport() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);

  // The class places it: bottom centre on a desktop, top centre on a phone,
  // where the bottom edge belongs to the action bar.
  return (
    <div className="toast-viewport">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const tone = TONES[t.tone];
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={spring.gentle}
              onClick={() => dismiss(t.id)}
              role="status"
              style={{
                pointerEvents: "auto",
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                // Opaque, like the modals: a message about money should not
                // have a poker table showing through it.
                background:
                  "linear-gradient(180deg, #2a3640 0%, var(--surface-solid) 100%)",
                border: "1px solid var(--line-strong)",
                borderRadius: 14,
                boxShadow: "var(--shadow-2), var(--highlight-soft)",
                padding: "11px 15px 11px 12px",
                fontSize: "var(--t-sm)",
                lineHeight: 1.45,
                color: "var(--text)",
                maxWidth: "min(420px, calc(100vw - 24px))",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  marginTop: 1,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: tone.color,
                  border: `1px solid ${tone.color}`,
                  opacity: 0.9,
                }}
              >
                {tone.glyph}
              </span>
              <span style={{ minWidth: 0 }}>{t.message}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
