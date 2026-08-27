#!/usr/bin/env node
/**
 * The design system's quality floor, checked in a real browser.
 *
 * A clean build says nothing about whether the rules in the design document
 * actually hold at runtime. Every check here corresponds to a line in §8 that
 * is cheap to break and expensive to notice:
 *
 *   - money and clocks carry tabular figures, or the table twitches as digits
 *     change width mid-animation
 *   - the three faces resolved, rather than silently falling back to system-ui
 *   - keyboard focus is visible
 *   - reduced motion collapses the motion tokens
 *   - 390px is a supported width, not a degraded one
 *   - nothing tappable is under --touch-target on a touch screen
 *
 * Start the dev server first, then:
 *   node scripts/design-check.mjs [port]
 */
import { chromium } from "playwright";

const port = process.argv[2] ?? "3111";
const base = `http://localhost:${port}`;

const failures = [];
const fail = (m) => { failures.push(m); console.log(`FAIL  ${m}`); };
const pass = (m) => console.log(`ok    ${m}`);

const browser = await chromium.launch();

// ---------------------------------------------------------------- typography
{
  const page = await browser.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });

  const fonts = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      display: cs.getPropertyValue("--font-display").trim(),
      body: cs.getPropertyValue("--font-body").trim(),
      mono: cs.getPropertyValue("--font-mono").trim(),
    };
  });
  for (const [name, stack] of Object.entries(fonts)) {
    // next/font builds a metric-matched fallback beside the real face and
    // exposes the pair as a variable. Seeing that fallback in the stack is the
    // proof the rebind landed on the loaded font rather than on the token's
    // bare family name, which would reflow the page when the webfont arrives.
    if (!stack) {
      fail(`--font-${name} is empty`);
    } else if (!/Fallback/.test(stack)) {
      fail(`--font-${name} has no metric-matched fallback: "${stack}"`);
    } else {
      pass(`--font-${name} resolves (${stack.split(",")[0]} + fallback)`);
    }
  }

  // Every number that changes while the player watches must be tabular.
  // Checked in the LOBBY, not on the landing page: since the marketing hero
  // stopped rendering chip amounts, the root page legitimately has no
  // changing numbers, and probing it reported "unverified" against a page
  // with nothing to verify. The lobby always carries money.
  await page.goto(`${base}/lobby`, { waitUntil: "networkidle" });
  const nums = await page.$$eval(".num", (els) =>
    els.slice(0, 40).map((el) => ({
      text: el.textContent.trim().slice(0, 16),
      variant: getComputedStyle(el).fontVariantNumeric,
      feature: getComputedStyle(el).fontFeatureSettings,
      family: getComputedStyle(el).fontFamily,
    })),
  );
  if (nums.length === 0) {
    fail("no .num elements found — tabular figures unverified");
  } else {
    const bad = nums.filter(
      (n) => !n.variant.includes("tabular-nums") && !/tnum/.test(n.feature),
    );
    if (bad.length) fail(`${bad.length}/${nums.length} .num without tabular figures`);
    else pass(`${nums.length} money/counter elements carry tabular figures`);
  }

  // Focus must be visible on every interactive element.
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
  });
  if (!focus) fail("Tab did not move focus to an interactive element");
  else if (focus.style === "none" || parseFloat(focus.width) < 2) {
    fail(`focus ring on <${focus.tag}> is ${focus.style} ${focus.width}`);
  } else {
    pass(`focus ring visible on <${focus.tag}> (${focus.width} ${focus.style})`);
  }
  await page.close();
}

// ------------------------------------------------------------ reduced motion
{
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/table/1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[aria-label^='Seat ']");
  const m = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ["chip-commit", "card-deal", "pot-push", "board-reveal"].map((k) => [
      k, cs.getPropertyValue(`--m-${k}`).trim(),
    ]);
  });
  const notCollapsed = m.filter(([, v]) => v !== "1ms");
  if (notCollapsed.length) {
    fail(`reduced motion left ${notCollapsed.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  } else {
    pass("reduced motion collapses every motion token to 1ms");
  }
  await ctx.close();
}

// ------------------------------------------------------- 390px + touch target
{
  /*
   * 390px is a supported width, not a degraded one, so it is pinned here
   * rather than taken from a device preset. A preset name that does not exist
   * spreads to nothing and the whole section quietly runs at desktop width —
   * which is exactly what happened the first time this was written.
   */
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  for (const path of ["/", "/table/1"]) {
    // The table page keeps chain subscriptions open, so networkidle never
    // fires there; wait for the room to actually paint instead.
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(path === "/" ? "h1" : "[aria-label^='Seat ']");

    /*
     * Wait for the emulated viewport to actually settle before measuring.
     *
     * Chromium applies mobile emulation asynchronously. On the FIRST
     * navigation in a fresh context, DOMContentLoaded can arrive while
     * window.innerWidth is still 413 — Chromium's default mobile fallback —
     * even though the page has already laid out correctly at 390. Measuring
     * there reports a phantom overflow of exactly 413 - 390 = 23px, and the
     * emulation assertion below fires on the same race. The second navigation
     * in the same context never sees it, which is why /table/1 always passed
     * and / did not.
     *
     * This measured a real page as broken for as long as it has existed.
     */
    await page
      .waitForFunction(() => window.innerWidth === 390, null, { timeout: 5000 })
      .catch(() => {}); // fall through to the explicit assertion below

    // Nothing may scroll the page sideways at a supported width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 1) fail(`${path} overflows horizontally by ${overflow}px at 390px`);
    else pass(`${path} has no horizontal overflow at 390px`);

    // The emulation has to have actually taken, or every check below is a
    // desktop measurement wearing a phone's name.
    const env = await page.evaluate(() => ({
      w: window.innerWidth,
      coarse: matchMedia("(pointer: coarse)").matches,
    }));
    if (env.w !== 390 || !env.coarse) {
      fail(`phone emulation did not apply (width ${env.w}, coarse ${env.coarse})`);
    }

    /*
     * --touch-target is the floor for anything tappable.
     *
     * Links sitting inside a run of text are exempt, which is WCAG 2.5.8's own
     * carve-out: the "built on Solana · MagicBlock" credit is a sentence, and
     * padding its links to 44px would push them apart into a list of buttons.
     * The exemption is for prose links only — a link that is its own control
     * still has to meet the target.
     */
    const small = await page.$$eval("button, [role='button'], a[href]", (els) =>
      els
        /*
         * Playwright's selectors pierce open shadow roots, and in dev Next
         * mounts its own toolbar into one (NEXTJS-PORTAL). That button is 32px
         * and is not ours — it does not exist in a production build. Our whole
         * interface is light DOM, so scoping to it is both correct and the
         * narrowest possible exclusion.
         */
        .filter((el) => el.getRootNode() === el.ownerDocument)
        .filter((el) => !el.closest(".stack-chip") && !el.classList.contains("stack-chip"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.height < 44;
        })
        .map((el) => `${el.tagName}.${el.className || "-"}:${Math.round(el.getBoundingClientRect().height)}px`)
        .slice(0, 8),
    );
    if (small.length) fail(`${path} has tap targets under 44px: ${small.join(", ")}`);
    else pass(`${path} keeps every tap target at or above 44px`);
  }
  await ctx.close();
}

await browser.close();

console.log();
if (failures.length) {
  console.log(`${failures.length} design-system check(s) failed`);
  process.exit(1);
}
console.log("design system holds at runtime");
