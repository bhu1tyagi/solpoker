# Landing page — implementation plan

Source: Superdesign project `7478d144-1821-492f-b4b5-479fe8f06f39`, draft
`b017486a-c5d5-4f9c-ad78-1048e9803e38` — "Solana Poker | Updated Typography".

The draft API needs auth, so the markup came from the project's shared chat
transcript (`ReadDesignDraft`, 28,934 bytes) and the current visual from the
draft's latest screenshot. The only delta between the two is the one the node
description names: **headings moved from Clash Grotesk to Bebas Neue**, layout
unchanged. Everything structural below is read from the markup.

Build to `.claude/skills/pokerable-design/`. Where the draft and the skill
disagree, this plan says which wins and why.

---

## 1. Routing — DECIDED

`src/app/page.tsx` is **the lobby** today — 1,240 lines, wallet-gated, no
marketing surface exists. The draft's header lists "Lobby" as a nav destination,
which means the landing page is not the lobby.

| Route | Content |
|---|---|
| `/` | Landing page. Static, no wallet required, indexable. |
| `/lobby` | Today's `page.tsx`, moved verbatim. |

`/` renders the landing page for everyone, connected or not. The header's
primary CTA routes to `/lobby`, which keeps its own readiness gate — so the gate
logic in `ONBOARDING.md` is untouched and nothing about wallet state has to be
known at the root.

Rejected: auto-redirecting connected wallets from `/` to `/lobby`. It makes the
marketing page unreachable for existing players and breaks the back button.
A returning player pays one extra click, which is the cheaper trade.

---

## 2. Fonts

Current: `next/font/google` for Space Grotesk / Inter / JetBrains Mono, exposed
as `--font-display` / `--font-body` / `--font-mono` and consumed throughout
`globals.css`. The variable indirection means a swap is a `layout.tsx` change
and nothing else.

The new stack splits across two sources:

| Face | Role | Source | How |
|---|---|---|---|
| **Bebas Neue** | h1–h3 | Google Fonts | `next/font/google` — drop-in |
| **Satoshi** | body | Fontshare | `next/font/local`, self-hosted woff2 |
| **Clash Grotesk** | optional subhead | Fontshare | `next/font/local` |
| JetBrains Mono | chain data | Google Fonts | unchanged |

Satoshi and Clash Grotesk are **not on Google Fonts**. The draft loads them from
`api.fontshare.com`, which we should not ship — it is a third-party request on
the critical path and it defeats `next/font`'s preloading and CLS protection.
Download the woff2 files into `src/fonts/` and load with `next/font/local`.
Fontshare's licence permits self-hosting for commercial use.

Bebas Neue is uppercase-only with a single weight (400). Two consequences worth
knowing before it lands:

- **It has no bold.** `font-bold` on a Bebas heading silently synthesises or
  does nothing. The `TYPE` scale's `weight: 700` on display styles becomes
  meaningless — display weights should go to 400 and the visual weight comes
  from size and tracking instead.
- **It has no lowercase.** Any heading with sentence-case copy will render
  uppercase regardless. That is fine for the hero but wrong for, say, a modal
  title. Scope Bebas to `h1, h2` and leave `h3` on Satoshi/Clash.

---

## 3. Token additions

Per non-negotiable #1, none of the draft's raw values may be typed into a
component. Add to `src/design/tokens.ts`, then `npm run tokens`:

```ts
COLOR:  bgDeep '#0A0A0B'  bgFelt '#071a12'
        glassFill 'rgba(255,255,255,0.03)'
        glassBorder 'rgba(255,255,255,0.08)'
        glassSolid '#101013'
FONT:   display (Bebas Neue), body (Satoshi)
ELEVATION: glass, glassFloating, glowHover, glowCta
MOTION: press 130, uiFast 180, uiBase 240, uiSlow 420, stagger 60,
        float 6000, badgePulse 2000, shimmer 500,
        easeInOut, easeDrawer, cursor; ease → [0.23,1,0.32,1]; drop easeIn
```

`build-tokens.ts` needs a matching change to emit the new curves — it currently
hardcodes `--m-ease` and `--m-ease-in` on lines 50–51.

Two carry-overs that are not negotiable regardless of the restyle: purple stays
off body text (`#B07CFF` under 24px), and the gradient CTA's black label stays
at weight 700+ (~4.8:1, no margin).

---

## 4. Copy and claims — corrections required

The draft's copy makes several claims this product cannot make. These are not
style preferences; two of them are the kind of thing that ends a real-money
product. Every row is a blocker.

| Draft says | Problem | Replace with |
|---|---|---|
| "the first **provably fair poker** platform" | Non-negotiable #4 bans this exact phrase | "Provably fair shuffle. Hole cards sealed in a hardware enclave." |
| "**zero rake** for founders" | False — `docs/TRUST_MODEL.md:112` documents a real rake on flopped pots | "5% rake on flopped pots, capped. Never on a hand that folds pre-flop." |
| "LIVE NOW: $50,000 SOL MAIN EVENT" | No such event exists | Cut, or a real scheduled game |
| "**4,281 players** currently at the tables" | Invented liveness, rule #9 | Real count from `useTables`, or last-24h with timestamp |
| "Deposit **SOL** · Low fees" | Chips are USDC, rule #8 | "Add USDC — chips are USDC. A little SOL covers network fees." |
| "From micro-stakes to **whale whales**" | Typo, and jackpot register | "Micro at $0.10/$0.20 up to High at $5/$10" |
| Ledger / Chainlink partner logos | Implies partnerships that don't exist | Cut the row, or relabel "Built with" and list only what's true (Solana, MagicBlock) |
| "© 2024 SOLANA POKER FOUNDATION" | No foundation; wrong year | "© 2026 Pokerable" |
| Footer: Whitepaper, Security Audit, API Docs, Mobile App, Rake Structure | Four of five don't exist | Ship only real links; see §6 |
| Brand "SOLANA POKER" | Product is **Pokerable** (`layout.tsx:41`) | **Pokerable** — decided, see below |

**Naming — DECIDED: Pokerable.** Every screen in the Superdesign project is
branded SOLANA POKER; the codebase, metadata, and design skill all say
Pokerable, and that name wins. It is ownable and trademarkable, where "Solana
Poker" is generic enough to fight for search results with every other Solana
poker project.

Consequences for this build:

- Wordmark is `POKERABLE`, single colour. The draft's two-tone
  `SOLANA<green>POKER</green>` treatment does not survive the rename — a
  one-word mark has no natural split point, so the gradient lives in the logo
  tile beside it instead.
- Tab title and footer already say Pokerable; no metadata change needed.
- The Superdesign drafts still say SOLANA POKER. They should be re-generated to
  match on the next canvas iteration, or they will keep re-introducing the old
  name every time a screen is ported.

---

## 5. Header

New `src/components/chrome/SiteHeader.tsx`. Keep `TopBar.tsx` for in-app chrome
— it carries balance, stack, and cash-out, none of which belong on a marketing
page, and merging the two would mean a component that is half wallet state.

```
fixed inset-x-0 top-0 z-[--z-hud] h-[72px]
bg-[--c-glass-solid]/80 backdrop-blur-md border-b border-[--c-glass-border]
```

- **Left** — gradient logo tile (40px, `--r-md`) + wordmark. Reuse
  `primitives/Logo.tsx`; the mark already exists, only the tile is new.
- **Centre** — Lobby · Tournaments · High Stakes · Leaderboard.
  `text-white/60`, hover `text-white`, `--m-ui-fast`. Hidden below `md`.
  **Ship only routes that exist.** Today that is Lobby and Leaderboard;
  Tournaments and High Stakes are unbuilt, so they are out until they aren't.
- **Right** — Support (quiet) + **Connect wallet** (gradient, `--glow-cta`,
  shimmer on hover). The draft says "Login", which is wrong for a
  non-custodial product — nothing is being logged into.
- **Mobile** — the draft's floating glass bottom nav is app chrome, not
  marketing. On the landing page use a standard sheet from the right.
- Header is fixed and blurs, so it is one of the few surfaces permitted
  `backdrop-filter` per `SURFACES.md`. It must not nest glass inside itself.
- Skip-to-content link as the first focusable element.

---

## 6. Footer

New `src/components/chrome/SiteFooter.tsx`. Four columns above a bottom bar,
collapsing to stacked accordions under `md`.

| Column | Contents |
|---|---|
| Brand | Logo, one-line description, social icons (X, Discord, GitHub) |
| Platform | Game lobby, Leaderboard, Rake structure |
| Trust | Trust model (`/trust` — **exists today**), Hand history, Provably fair shuffle |
| Newsletter | Email field + submit |

The draft's Resources column lists Whitepaper, Security Audit, API Docs and
Mobile App. Three of those do not exist and the fourth is not written. A footer
link to a 404 is worse than an absent link, so the column becomes **Trust** and
points at `/trust`, which is real and is the best page this product has.

Bottom bar: `© 2026 Pokerable` + Privacy · Terms · Risk disclosure. **Risk
disclosure is the one legal link that must be real before launch** — this is a
real-money product and that page currently does not exist.

The newsletter field needs a real endpoint or it should not ship. An input that
silently discards an address is worse than no input.

---

## 7. Sections

Read from the markup, in order, with what each needs:

1. **Background orbs** — three blurred radial divs, purple/green, `opacity-20`.
   Pure CSS. Must sit behind a `pointer-events-none` wrapper.
2. **Hero** — two columns. Left: live badge, h1 "THE DECK IS / ON-CHAIN."
   (second line gradient-filled, permitted at h1 scale), subhead, two CTAs,
   player-count row. Right: the CSS-3D artifact stack.
3. **Hero artifacts** — chips and fanned cards built from `mdi:cards-spade` /
   `mdi:cards-club` glyphs plus CSS gradients and `perspective`. No images, no
   WebGL — matches `MOTION.md`'s recommendation exactly. Reuse
   `primitives/Chip.tsx` and `PlayingCard.tsx`; both exist. Cards must stay
   light-faced. The `animate-float` 6s loop belongs here and only here.
4. **Features** — three glass cards: Instant settlements, Provably fair,
   Community driven. Card 2's body copy must be reworded per §4.
5. **Steps** — "Start playing in seconds", three numbered cards. Retitle step 2
   to USDC. This mirrors the onboarding rail, so use the same three labels as
   `ONBOARDING.md`: Link wallet → Network fees → Gaming capital.
6. **Trust row** — see §4; likely cut.
7. **Footer** — §6.

---

## 8. Icons

The draft uses Iconify via CDN (`iconify-icon` web component) — 20+ glyphs
across `lucide:`, `mdi:`, `logos:` and `game-icons:`. Do not ship the CDN
script: it is a render-blocking third-party request and the web component
hydrates after paint, so every icon pops in late.

`primitives/Icons.tsx` already has hand-rolled SVGs for the app. Extend it with
the ~10 the landing page actually needs (`zap`, `shield-check`, `users`,
`wallet`, `play-circle`, `chevron-right`, `plus-circle`, `arrow-right`, plus the
three socials). Inline SVG, no runtime, no layout shift.

---

## 9. Build order

1. ~~Confirm §1 routing and §4 naming.~~ **Both decided** — landing at `/`,
   lobby to `/lobby`; brand is Pokerable.
2. Move `page.tsx` → `app/lobby/page.tsx`; update internal links; verify
   `npm run design` and `npm run test:ui` still pass.
3. Self-host Satoshi; add Bebas Neue; rewire `layout.tsx`; adjust display
   weights to 400 (§2).
4. Token additions + `build-tokens.ts` curve emit + `npm run tokens`.
5. Glass/glow/gradient utility classes in `globals.css`, from tokens only.
6. `SiteHeader` + `SiteFooter`, with the real-routes-only rule.
7. Landing sections 1–7, static and wallet-free.
8. Wire the player count to `useTables`; last-24h + timestamp fallback.
9. Quality pass against the `SURFACES.md` component checklist — 390px, focus
   rings, reduced motion (float/pulse/shimmer fully stopped, not shortened),
   contrast measured against `glassSolid` not the blur.

Steps 2–8 are mechanical once 1 is answered. Step 9 is where this either looks
designed or looks like a template, so it is not the step to compress.

---

## 10. Risks

- **`page.tsx` is 1,240 lines** and moving it is the highest-risk step. It is a
  pure path move with no edits, but every `href="/"` in the app needs checking.
- **Bebas has no bold and no lowercase** (§2). Discovered late, this reads as a
  rendering bug rather than a font choice.
- **`backdrop-filter` cost.** Header, footer and feature cards all blur in the
  draft. Per `SURFACES.md` only fixed chrome should blur; the feature cards use
  fill + hairline.
- **Marketing polish outrunning the trust model.** The finish makes the product
  look more established than it is, which is exactly why §4's corrections are
  blockers and not cleanup.
