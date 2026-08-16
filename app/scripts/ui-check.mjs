#!/usr/bin/env node
/**
 * Load every page in a real browser and fail on any console error.
 *
 * A clean build and a clean typecheck say nothing about whether React actually
 * runs. This caught an infinite render loop that both of those were happy with,
 * which is the whole reason it exists.
 *
 * Start the dev server first, then:
 *   node scripts/ui-check.mjs [port]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const port = process.argv[2] ?? "3111";
const base = `http://localhost:${port}`;
const shotDir = "/tmp/solpoker-shots";
mkdirSync(shotDir, { recursive: true });

const PAGES = [
  {
    path: "/",
    expect: {
      connect: "button:has-text('Select Wallet'), button:has-text('Connect')",
      trustLink: "[aria-label='How this works']",
      heading: "h1:has-text('Poker Rooms')",
    },
  },
  {
    path: "/trust",
    expect: {
      heading: "h1:has-text('Trust model')",
      approvedPhrase: "text=provably fair shuffle",
      summary: "table",
    },
  },
  {
    // Any table id renders; an unknown one shows an empty table.
    path: "/table/1",
    expect: {
      felt: "main",
      seats: "[aria-label^='Seat ']",
      historyLink: "[aria-label='Hand history']",
    },
  },
  { path: "/history/1", expect: { heading: "h1:has-text('Hand history')" } },
];

/** Copy that must never appear, however the sentence around it is phrased. */
const BANNED = [/trustless/i, /provably fair hole cards/i, /provably fair poker/i];

const browser = await chromium.launch();
let failures = 0;

for (const page of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  tab.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await tab.goto(`${base}${page.path}`, { waitUntil: "networkidle", timeout: 60_000 });
  await tab.waitForTimeout(2500);

  const missing = [];
  for (const [name, sel] of Object.entries(page.expect)) {
    if ((await tab.locator(sel).count()) === 0) missing.push(name);
  }

  const text = await tab.innerText("body");
  const banned = BANNED.filter((re) => re.test(text)).map(String);

  const shot = `${shotDir}/${page.path.replace(/\//g, "_") || "_root"}.png`;
  await tab.screenshot({ path: shot });
  await ctx.close();

  const ok = errors.length === 0 && missing.length === 0 && banned.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${page.path}`);
  if (errors.length) console.log(`       console: ${errors.slice(0, 3).join(" | ")}`);
  if (missing.length) console.log(`       missing: ${missing.join(", ")}`);
  if (banned.length) console.log(`       banned copy: ${banned.join(", ")}`);
}

await browser.close();
console.log(failures === 0 ? "\nall pages clean" : `\n${failures} page(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
