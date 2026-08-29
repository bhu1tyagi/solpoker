"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { BREAKPOINTS } from "@/design/tokens";

/**
 * useLayoutEffect, except on the server, where it does not exist and React
 * says so in the console. Measuring has to happen before paint or the table is
 * drawn once at the wrong size; on the server there is nothing to measure.
 */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * How wide an element actually ended up, in CSS pixels.
 *
 * The felt's width is a CSS expression over two container axes and a cap, so
 * nothing in JS can predict it — but the table has to be drawn at a known size
 * and scaled to fit, and the scale is that width divided by the canvas. Hence
 * a measurement rather than a calculation.
 *
 * `null` until it has been measured, so a caller can hold the table back for
 * the one frame before layout rather than flashing it at the wrong size. The
 * measurement runs in useLayoutEffect, so that frame is never painted.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useBeforePaint(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.getBoundingClientRect().width || null);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

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
