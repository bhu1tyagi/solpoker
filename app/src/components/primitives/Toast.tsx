"use client";

import { AnimatePresence, motion } from "motion/react";
import { useUiStore } from "@/stores/ui-store";
import { spring, z } from "@/styles/theme";

const TONE_COLOR = {
  info: "var(--info)",
  good: "var(--win)",
  bad: "var(--lose)",
};

export function ToastViewport() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: z.toast,
        pointerEvents: "none",
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={spring.gentle}
            onClick={() => dismiss(t.id)}
            style={{
              pointerEvents: "auto",
              cursor: "pointer",
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderLeft: `2px solid ${TONE_COLOR[t.tone]}`,
              borderRadius: "var(--r-control)",
              boxShadow: "var(--shadow-2)",
              padding: "9px 14px",
              fontSize: "var(--t-sm)",
              color: "var(--text)",
              maxWidth: 460,
            }}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
