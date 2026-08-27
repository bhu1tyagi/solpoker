/**
 * Emits the generated CSS custom property block from tokens.ts.
 *
 *   npm run tokens
 *
 * Run it in CI so a hand-edit of the generated block fails the build instead
 * of silently drifting from the TS source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  COLOR, FONT, TYPE, SPACE, RADIUS, ELEVATION, MOTION, BREAKPOINTS, LAYOUT, Z,
} from '../src/design/tokens';

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const lines: string[] = [
  '/* GENERATED FROM src/design/tokens.ts — DO NOT EDIT BY HAND. */',
  '/* Run `npm run tokens` after changing the source.               */',
  ':root {',
];

const block = (label: string, prefix: string, obj: Record<string, unknown>) => {
  lines.push(`\n  /* ${label} */`);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' || typeof v === 'number') {
      lines.push(`  --${prefix}-${kebab(k)}: ${v};`);
    }
  }
};

block('color', 'c', COLOR);
block('font', 'font', FONT);
block('space', 'sp', SPACE);
block('radius', 'r', RADIUS);
block('elevation', 'e', ELEVATION);
block('z-index', 'z', Z);

lines.push('\n  /* type scale */');
for (const [k, v] of Object.entries(TYPE)) {
  lines.push(`  --t-${kebab(k)}-size: ${v.size};`);
  lines.push(`  --t-${kebab(k)}-line: ${v.line};`);
  lines.push(`  --t-${kebab(k)}-weight: ${v.weight};`);
  lines.push(`  --t-${kebab(k)}-tracking: ${v.tracking};`);
}

lines.push('\n  /* motion — durations in ms, see tokens.ts on why these are fixed */');
for (const [k, v] of Object.entries(MOTION)) {
  if (typeof v === 'number') lines.push(`  --m-${kebab(k)}: ${v}ms;`);
}
lines.push(`  --m-ease: cubic-bezier(${MOTION.ease.join(', ')});`);
lines.push(`  --m-ease-in-out: cubic-bezier(${MOTION.easeInOut.join(', ')});`);
lines.push(`  --m-ease-drawer: cubic-bezier(${MOTION.easeDrawer.join(', ')});`);

lines.push('\n  /* breakpoints — mirrored in use-viewport from the same source */');
for (const [k, v] of Object.entries(BREAKPOINTS)) lines.push(`  --bp-${k}: ${v}px;`);

lines.push('\n  /* layout */');
lines.push(`  --table-max-w: ${LAYOUT.tableMaxW};`);
lines.push(`  --page-max-w: ${LAYOUT.pageMaxW};`);
lines.push(`  --touch-target: ${LAYOUT.touchTarget}px;`);

lines.push('}');

// Every motion token collapses to near-zero under reduced motion. State still
// changes; it just stops moving. Opacity crossfades are kept because losing
// them removes the only cue that anything happened.
lines.push(`
@media (prefers-reduced-motion: reduce) {
  :root {
${Object.entries(MOTION)
  .filter(([, v]) => typeof v === 'number')
  .map(([k]) => `    --m-${kebab(k)}: 1ms;`)
  .join('\n')}
  }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}`);

writeFileSync('src/app/tokens.css', lines.join('\n') + '\n');
console.log('wrote src/app/tokens.css');

/*
 * The drift guard.
 *
 * Rule 3 of the design system says breakpoints come from BREAKPOINTS in both
 * CSS and JS. JS can import the constant; a CSS `@media` cannot read a custom
 * property, so `--bp-phone` above is readable by components but invisible to
 * the media queries that actually move the table. That gap is the exact hazard
 * that once put a portrait table inside a desktop room.
 *
 * So every width in globals.css is checked against the constant here, and a
 * stray number fails the build rather than shipping. Heights and orientation
 * are not breakpoints and are not checked; widths that are deliberately not
 * breakpoints go in ALLOWED_WIDTHS with a reason.
 */
const ALLOWED_WIDTHS = new Set<number>([]);

const allowed = new Set<number>(ALLOWED_WIDTHS);
for (const v of Object.values(BREAKPOINTS)) {
  allowed.add(v);      // min-width: the breakpoint itself
  allowed.add(v - 1);  // max-width: one below it
}

const globals = readFileSync('src/app/globals.css', 'utf8');
const offenders = [...globals.matchAll(/\((?:min|max)-width:\s*(\d+)px\)/g)]
  .map((m) => Number(m[1]))
  .filter((n) => !allowed.has(n));

if (offenders.length > 0) {
  console.error(
    `globals.css uses width(s) ${[...new Set(offenders)].join(', ')}px, which are not in ` +
      `BREAKPOINTS (${Object.entries(BREAKPOINTS)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ')}). Use a breakpoint, or add the number to ALLOWED_WIDTHS ` +
      `in scripts/build-tokens.ts with a reason.`,
  );
  process.exit(1);
}
console.log('breakpoints in globals.css agree with tokens.ts');
