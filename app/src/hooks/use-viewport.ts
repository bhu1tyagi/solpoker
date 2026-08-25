"use client";

import { useSyncExternalStore } from "react";
import { BREAKPOINTS } from "@/design/tokens";

/**
 * A media query as React state.
 *
 * The widths here come from BREAKPOINTS, the same constant the media queries in
 * globals.css are checked against by `npm run tokens`. That is the entire point
 * of the constant: the CSS moves the HUD and this hook moves the seats, and
 * when the two disagreed a phone got a portrait table inside a desktop room.
 * Do not retype a number in either place.
 */
function useMediaQuery(query: string): boolean {
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
 * A phone held upright gets the tall table with seats down its long edges. A
 * phone on its side keeps the wide table, shrunk, with compact seats — the
 * constraint there is height, not width, which is why that one query is a
 * height and is not a breakpoint. Everything else is the desktop room.
 */
const PORTRAIT = `(max-width: ${BREAKPOINTS.phone - 1}px) and (orientation: portrait)`;
const SHORT = "(max-height: 520px)";

export function useTableLayout(): TableLayout {
  const portrait = useMediaQuery(PORTRAIT);
  const short = useMediaQuery(SHORT);
  if (portrait) return "portrait";
  if (short) return "landscape";
  return "desktop";
}
