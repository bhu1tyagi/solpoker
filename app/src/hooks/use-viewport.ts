"use client";

import { useSyncExternalStore } from "react";

/**
 * A media query as React state.
 *
 * The queries here must match the ones in globals.css word for word, because
 * the CSS moves the HUD and the hook moves the seats; if they ever disagreed,
 * a phone would get a portrait table inside a desktop room.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    // The server cannot know the screen, so it renders the desktop room and
    // the first client frame corrects it.
    () => false,
  );
}

export type TableLayout = "desktop" | "portrait" | "landscape";

/**
 * Which room the table page should build.
 *
 * A phone held upright gets the tall table with seats down its sides. A phone
 * on its side keeps the wide table, shrunk, with compact seats. Everything
 * else is the desktop room.
 */
export function useTableLayout(): TableLayout {
  const portrait = useMediaQuery("(max-width: 719px) and (orientation: portrait)");
  const short = useMediaQuery("(max-height: 520px)");
  if (portrait) return "portrait";
  if (short) return "landscape";
  return "desktop";
}
