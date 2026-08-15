"use client";

import { motion } from "motion/react";
import { duration } from "@/styles/theme";

/**
 * Route transition. A short rise and fade, nothing more.
 *
 * Next remounts this on every navigation, which is exactly the hook we want:
 * new page content animates in without needing route-aware bookkeeping.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.standard, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
