"use client";

import { useEffect, useState } from "react";
import { RANK_CHARS, rankOf, suitOf } from "./engine/cards";

/**
 * The deck's faces, in the browser before they are needed.
 *
 * A card used to be an <img> that started loading the moment it was dealt, and
 * on the river that is the worst possible moment: the flip plays over a face
 * that has not arrived, so the table shows a blank white rectangle where the
 * card is. It cleared a beat later, which is exactly long enough to look
 * broken, and on a phone it lasted longer than the hand's next action.
 *
 * Two things fix it. The whole deck is fetched at low priority the first time
 * any card is drawn, so by the time a hand is dealt the faces are already in
 * the browser's cache; and a card whose face is not decoded yet stays face
 * DOWN and flips when it is. A card back is a true thing to show — the card
 * genuinely has not been turned over yet — where a blank white face is not.
 */

const SUIT_FILE = ["c", "d", "h", "s"];

/** Where a card byte's face lives. */
export const cardArt = (card: number) =>
  `/cards/${RANK_CHARS[rankOf(card)].toLowerCase()}${SUIT_FILE[suitOf(card)]}.webp`;

/** Faces known to be decoded and paintable this instant. */
const ready = new Set<string>();
/** Everyone waiting on a face that is still coming. */
const waiting = new Map<string, Set<() => void>>();

function settle(src: string) {
  ready.add(src);
  const listeners = waiting.get(src);
  waiting.delete(src);
  listeners?.forEach((fn) => fn());
}

/**
 * Fetch one face and remember that it landed.
 *
 * Failures settle too. A face that cannot be fetched must not hold its card
 * face down forever — the <img> is rendered either way and shows whatever the
 * browser can, which is the same behaviour this had before any of it existed.
 */
function load(src: string) {
  if (ready.has(src) || waiting.has(src)) return;
  waiting.set(src, new Set());
  const img = new Image();
  // The deck is bulk cargo. It must never compete with the cards actually on
  // the felt, or with the page that is still painting around them.
  img.fetchPriority = "low";
  img.decoding = "async";
  img.onload = () => settle(src);
  img.onerror = () => settle(src);
  img.src = src;
}

let warmed = false;

/**
 * Pull the whole deck down, once per visit.
 *
 * Fifty-two faces is about 1.4MB, and which one comes off the deck next is a
 * shuffle nobody can predict — so there is no useful subset to fetch. It runs
 * behind everything else and never repeats: the browser cache serves the rest
 * of the session, and the flip gate below covers the first hand if a face is
 * still in the air.
 */
export function warmDeck() {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  for (let c = 0; c < 52; c++) load(cardArt(c));
}

/**
 * Whether this card's face can be painted, and the warm-up as a side effect.
 *
 * Returns false only for the moments before a face has decoded. Every card on
 * screen asks, so the first card drawn anywhere starts the deck loading.
 */
export function useArtReady(card: number | undefined, known: boolean): boolean {
  const src = known && card !== undefined ? cardArt(card) : null;
  const [, bump] = useState(0);

  useEffect(() => {
    warmDeck();
    if (!src || ready.has(src)) return;
    load(src);
    const listeners = waiting.get(src);
    if (!listeners) {
      // It settled between the check and here.
      bump((n) => n + 1);
      return;
    }
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [src]);

  return src === null || ready.has(src);
}
