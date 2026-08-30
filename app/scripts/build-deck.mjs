#!/usr/bin/env node
/**
 * Render the deck's faces from their vector originals.
 *
 * The art is Byron Knoll's public-domain vector deck
 * (code.google.com/p/vector-playing-cards), mirrored as SVG by
 * hayeah/playing-cards-assets. The repo used to carry it as 222px PNGs, which
 * is fine at rest and not fine on a felt: the table is drawn on a fixed canvas
 * and scaled to whatever width the room gives it, so on a wide screen every
 * card is being enlarged and the indices went soft doing it.
 *
 * This renders the same art at twice that size and writes WebP, which is
 * sharper AND smaller than what it replaces. Rerun it if the faces ever need
 * regenerating; nothing in the app depends on it at build time.
 *
 *   node scripts/build-deck.mjs [outDir] [svgCacheDir]
 *
 * Defaults write straight into public/cards, keeping the SVGs in /tmp so a
 * second run costs no network.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SRC = "https://raw.githubusercontent.com/hayeah/playing-cards-assets/master/svg-cards";
const RANKS = {
  "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
  T: "10", J: "jack", Q: "queen", K: "king", A: "ace",
};
const SUITS = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };

const OUT = process.argv[2] ?? "public/cards";
const CACHE = process.argv[3] ?? "/tmp/solpoker-deck-svg";
/** 2x the 222px master the deck used to ship as. */
const WIDTH = 444;
/** Renders the 167x243pt canvas at WIDTH before the resize does anything. */
const DENSITY = 288;

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });

/*
 * The card's printed border, dropped.
 *
 * It is drawn as paths tracing the 167x243 canvas — one white-filled and
 * stroked on every card, plus a second heavier stroke on the courts. Both are
 * recognisable by their `d` opening on the outline's own corner, and both go:
 * the face's own white stock and rounded corner are this deck's edge, and a
 * printed border inside them reads as a card drawn twice.
 */
const stripBorder = (svg) =>
  svg.replace(/<path\b(?:(?!\/>)[\s\S])*?d="[Mm]\s*166\.8[\s\S]*?\/>/g, "");

let total = 0;
for (const [rank, rankName] of Object.entries(RANKS)) {
  for (const [suit, suitName] of Object.entries(SUITS)) {
    const name = `${rankName}_of_${suitName}.svg`;
    const cached = `${CACHE}/${name}`;
    let svg;
    try {
      svg = await readFile(cached, "utf8");
    } catch {
      const res = await fetch(`${SRC}/${name}`);
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      svg = await res.text();
      await writeFile(cached, svg);
    }
    const stripped = stripBorder(svg);
    // A silent no-op here would ship 52 cards with borders on them.
    if (stripped === svg) throw new Error(`${name}: border path not found`);
    const file = `${OUT}/${rank.toLowerCase()}${suit}.webp`;
    const info = await sharp(Buffer.from(stripped), { density: DENSITY })
      .resize({ width: WIDTH })
      .webp({ quality: 82, effort: 6 })
      .toFile(file);
    total += info.size;
    console.log(`${file}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)}KB`);
  }
}
console.log(`\n52 cards, ${(total / 1024).toFixed(0)}KB total`);
