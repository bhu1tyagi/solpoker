/**
 * Pokerable design tokens — the single source of truth.
 *
 * Both the CSS custom properties in globals.css and the JS-positioned parts of
 * the table are generated from or read this file. Do not hand-edit tokens in
 * globals.css: run `npm run tokens` and let it rewrite the generated block.
 *
 * This exists because of a specific hazard in this codebase: media queries live
 * in globals.css and use-viewport mirrors the same breakpoints in JS, and the
 * two had to stay identical word for word or a phone got a portrait table
 * inside a desktop room. Breakpoints now come from BREAKPOINTS below in both
 * places, so they cannot drift.
 */

// ---------------------------------------------------------------- COLOR

export const COLOR = {
  // The ground. Near-black, never pure #000 — pure black gives no depth, strobes
  // on OLED during scroll, and kills the hairlines that define the glass edges.
  felt: '#0A0A0B',
  feltRaised: '#101013',
  feltEdge: '#17171A',

  // The table itself, and only the table. Deep poker green — the one place the
  // product stops being a dark UI and becomes a physical object. The cloth
  // pair is the radial the Superdesign "High Stakes Table" draft lights the
  // felt with (bright centre to dark rim); the rail is its 12px surround.
  bgFelt: '#071a12',
  feltCloth: '#0a2f1f',
  feltClothDeep: '#05140d',
  feltRail: '#1a1a1a',

  // Glass. The default panel is the SOLID fill with the translucent wash and the
  // blur layered over it. The solid is not decoration: backdrop-filter composites
  // whatever happens to be behind the panel, so a card scrolling over the orbs
  // would silently lose text contrast. Contrast is measured against glassSolid.
  glassSolid: '#101013',
  glassFill: 'rgba(255,255,255,0.03)',
  glassBorder: 'rgba(255,255,255,0.08)',

  // Hairlines. On near-black, borders do the work shadows do on light UI.
  rule: '#232B3D',
  ruleStrong: '#2F3A52',

  // Text. Contrast measured against --felt.
  ink: '#FFFFFF',        // 20.4:1
  inkMuted: '#A8B2C6',   //  9.0:1  default secondary text
  inkFaint: '#9CA3AF',   //  7.3:1  timestamps, units, disabled labels
  // Nothing dimmer than inkFaint carries meaning. If it needs to be dimmer,
  // it does not need to be on screen.

  // Brand. Straight from the Solana gradient already in the mark.
  purple: '#9945FF',     //  4.28:1 — FILLS, BORDERS, LARGE TEXT ONLY
  purpleText: '#B07CFF', //  6.60:1 — any purple text under 24px uses this
  green: '#14F195',      // 12.92:1 — safe at any size
  greenDeep: '#0FBF77',

  // Semantic. Deliberately not green-vs-red alone: ~8% of men cannot separate
  // those. Every state below is also carried by shape, position, or a label.
  win: '#14F195',
  loss: '#FF5C5C',       //  6.38:1
  warn: '#FFB020',       // 10.56:1
  info: '#4DA3FF',

  // Playing card faces. Cards are LIGHT objects on a dark table, like real
  // cards. A dark card on dark felt reads as a hole, not a card. Pure white
  // and the zinc back come from the Superdesign draft the table now follows.
  cardFace: '#FFFFFF',
  cardFaceEdge: '#E4E4E7',
  cardBack: '#27272A',
  cardBackEdge: '#3F3F46',
  // The draft's card red: rose-600, measured 4.9:1 on white.
  cardRed: '#E11D48',
  cardBlack: '#09090B',

  // Four-colour deck — the accessible ALTERNATE for a settings toggle. The
  // default deck is the draft's classic red/black above; suit is never
  // carried by colour alone (the symbol prints beside every rank), and these
  // four remain for players who want the colours to differ too.
  suitSpade: '#15202B',   // 14.87:1
  suitHeart: '#C2143C',   //  5.47:1
  suitDiamond: '#1667C2', //  5.05:1
  suitClub: '#137A4A',    //  4.84:1

  // Two-colour deck, for players who switch it off in settings.
  suitTwoColorRed: '#C2143C',
  suitTwoColorBlack: '#15202B',

  // The empty chair. Upholstery, not interface: a leather back a shade above
  // the room and a darker cushion sunk inside it, so an open seat reads as
  // furniture waiting at the rail rather than as a control.
  chairBack: '#34343E',
  chairCushion: '#222229',

  // Chip denominations. Casino convention, so the colours are already learned.
  chip1: '#F5F3EE',
  chip5: '#D6455B',
  chip25: '#2E9E5B',
  chip100: '#1F2733',
  chip500: '#7B4BC9',
} as const;

/**
 * Player identity art — NOT part of the interface palette.
 *
 * These are the grounds and skin tones the generated seat characters are drawn
 * from. They live here because nothing may hardcode a colour in a component,
 * but they are deliberately kept out of the COLOR block above and out of the
 * generated CSS: they are per-player data, the way a profile photo is, and the
 * "no fifth accent colour" law governs interface signalling, not identity.
 *
 * Nothing in the interface may reach for one of these to mean something.
 */
export const AVATAR = {
  // 8 grounds x 4 heads x 5 eyes x 5 mouths = 800 distinct characters.
  grounds: [
    ['#7b3ff2', '#12b981'],
    ['#5b4dff', '#2e9be6'],
    ['#c2410c', '#e8b44a'],
    ['#be3455', '#7c2d5e'],
    ['#0f766e', '#2dd4a8'],
    ['#4338ca', '#8b5cf6'],
    ['#9d174d', '#e85d75'],
    ['#3f6212', '#84cc16'],
  ] as [string, string][],
  /** Head tones, warm to deep, all carrying dark features well. */
  skins: ['#f5d7b8', '#e8b98a', '#c9895c', '#9c6644'],
  /** The features. One ink for eyes and mouths across every character. */
  ink: '#2b2118',
  blush: 'rgba(235,110,110,0.45)',
  shine: '#ffffff',
} as const;

// ---------------------------------------------------------------- TYPE

export const FONT = {
  // Display: Archivo, run WIDE — globals.css sets font-stretch 125% on h1/h2,
  // using the variable font's width axis. The brand direction wants headings
  // that spend more space horizontally than vertically, which is the opposite
  // of a condensed face. Unlike the Bebas Neue experiment this replaced, it
  // has real weights and a lowercase, so nothing downstream has to work
  // around a missing bold.
  display: "'Archivo', system-ui, sans-serif",
  // Body: Satoshi. Everything from h3 down.
  body: "'Satoshi', system-ui, sans-serif",
  // Money. Deliberately pinned to Satoshi rather than following the display
  // face. The display face is a branding decision and may change again; money
  // needs `tnum` or every stack, pot and bet re-measures itself as it ticks.
  // Satoshi's GSUB carries `tnum` — verified with fontTools against the
  // shipped woff2 files in src/fonts, not assumed from a specimen — so the
  // one face the numbers depend on is the one we host ourselves.
  num: "'Satoshi', system-ui, sans-serif",
  // Mono: chain data only. Addresses, seeds, hashes, tx signatures.
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', monospace",
} as const;

/**
 * Every number that changes while the player is watching — stack, pot, bet,
 * timer — must use TABULAR figures, or the digits shift width mid-animation
 * and the whole table appears to twitch. This is not cosmetic.
 */
export const NUMERIC = "font-variant-numeric: 'tabular-nums'; font-feature-settings: 'tnum' 1;";

// Sizes are tuned for a WIDE face: an expanded font eats horizontal room fast,
// so the display sizes sit lower than they would for a condensed one and the
// tracking is slightly negative to pull the widened letters back together.
export const TYPE = {
  displayXl: { size: '3.75rem', line: '1.04', weight: 800, tracking: '-0.015em' },
  displayLg: { size: '2.5rem',  line: '1.08', weight: 800, tracking: '-0.01em' },
  displayMd: { size: '1.75rem', line: '1.15', weight: 700, tracking: '-0.01em' },
  money:     { size: '1.25rem', line: '1.1',  weight: 700, tracking: '-0.01em' },
  bodyLg:    { size: '1.0625rem', line: '1.55', weight: 400, tracking: '0' },
  body:      { size: '0.9375rem', line: '1.55', weight: 400, tracking: '0' },
  bodySm:    { size: '0.8125rem', line: '1.5',  weight: 400, tracking: '0' },
  label:     { size: '0.75rem', line: '1.3', weight: 600, tracking: '0.06em' },
  chainData: { size: '0.8125rem', line: '1.45', weight: 400, tracking: '0' },
} as const;

// ---------------------------------------------------------------- SPACE

// 4px base. Table geometry uses the scale like everything else; a seat that
// sits on a half-step is a seat someone nudged by eye.
export const SPACE = {
  '0': '0', '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px',
  '6': '24px', '8': '32px', '10': '40px', '12': '48px', '16': '64px', '20': '80px',
} as const;

export const RADIUS = {
  sm: '6px',
  md: '10px',
  lg: '14px',
  card: '6px',    // playing cards — the Superdesign draft's own corner
  chip: '999px',
  pill: '999px',
} as const;

// ---------------------------------------------------------------- DEPTH

/**
 * Drop shadows are nearly invisible on #0B0E14. Depth here comes from a
 * lighter surface plus a 1px rim-light on the top edge, the way a physical
 * object catches light from above. Shadow is used only to lift something the
 * player is actively dragging or that is genuinely floating over the table.
 */
export const ELEVATION = {
  flat:    'none',
  raised:  'inset 0 1px 0 rgba(255,255,255,0.06)',
  overlay: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 12px 32px rgba(0,0,0,0.55)',
  lifted:  'inset 0 1px 0 rgba(255,255,255,0.10), 0 20px 48px rgba(0,0,0,0.65)',

  // Glow. The hover and liveness language, and the fastest thing in this system
  // to overuse: only green, and only one glowing element per region. A glow is
  // NOT a focus ring — it vanishes in forced-colours mode and does not read as
  // keyboard state, so focus is always the solid green ring as well.
  glowHover: '0 0 30px rgba(20,241,149,0.20)',
  glowCta:   '0 0 40px rgba(20,241,149,0.30)',
  // The seat that is to act. The only glow permitted on the table surface.
  toAct:     '0 0 0 2px rgba(20,241,149,0.55), 0 0 24px rgba(20,241,149,0.25)',
} as const;

// ---------------------------------------------------------------- MOTION

/**
 * DURATIONS ARE LOAD-BEARING, not taste.
 *
 * Measured action round trip is min 257ms / median 348ms / max 865ms, and the
 * client renders optimistically the instant the button is pressed so that
 * confirmation lands INSIDE the chip animation. chipCommit is therefore sized
 * against the median, not chosen because it looked nice. Shortening it exposes
 * the latency it was built to cover.
 */
export const MOTION = {
  instant: 80,
  fast: 140,
  base: 220,
  slow: 340,
  chipCommit: 420,   // covers median confirmation latency — do not shorten
  cardDeal: 260,     // per card, staggered
  cardStagger: 70,
  potPush: 520,      // showdown, pot sliding to the winner
  boardReveal: 380,
  seatPulse: 1600,   // to-act breathing loop

  // UI-scale durations. Everything a player sees often stays under 300ms.
  press: 130,
  uiFast: 180,
  uiBase: 240,
  uiSlow: 420,
  stagger: 60,       // keep within the 30-80ms band; longer reads as slow

  // Ambient loops. These belong on first-run and marketing surfaces only — a
  // hero element drifting on a 6s loop is atmosphere; a lobby card drifting
  // under a cursor a grinder is trying to click is an obstacle. Never float
  // anything a player aims at. All three are STOPPED under reduced motion, not
  // shortened: a 1ms infinite loop is a strobe.
  float: 6000,
  badgePulse: 2000,
  shimmer: 500,      // the sweep across a primary CTA on hover

  // Strong curves. CSS's built-ins are too weak to read as designed.
  ease:      [0.23, 1, 0.32, 1],       // default, entering and exiting
  easeInOut: [0.77, 0, 0.175, 1],      // on-screen morphs only
  easeDrawer:[0.32, 0.72, 0, 1],       // sheets and drawers
  // Deliberately no easeIn. At equal duration it feels slower, because it
  // delays movement in exactly the moment the player is watching for it.
  spring:    { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 },
  chipSpring:{ type: 'spring', stiffness: 260, damping: 26, mass: 1 },
  cursor:    { stiffness: 250, damping: 28, mass: 1, restDelta: 0.001 },
} as const;

// ---------------------------------------------------------------- LAYOUT

/**
 * Defined once, consumed by both globals.css and use-viewport. Changing a
 * number here changes both. That is the entire point of this block.
 */
export const BREAKPOINTS = {
  phone: 480,     // portrait table, stood on end
  tablet: 768,
  laptop: 1024,   // landscape table, full six seats
  desktop: 1280,
} as const;

export const mq = {
  phone: `(max-width: ${BREAKPOINTS.phone - 1}px)`,
  tablet: `(min-width: ${BREAKPOINTS.phone}px) and (max-width: ${BREAKPOINTS.laptop - 1}px)`,
  laptop: `(min-width: ${BREAKPOINTS.laptop}px)`,
  desktop: `(min-width: ${BREAKPOINTS.desktop}px)`,
  reducedMotion: '(prefers-reduced-motion: reduce)',
} as const;

export const LAYOUT = {
  tableMaxW: '1120px',
  // Marketing pages run wider than the table. 1120px was tuned for a poker
  // room; on a landing page it left a third of a desktop viewport empty on
  // each side and the content read as a column floating in a void.
  pageMaxW: '1400px',
  tableRatio: 2,            // landscape — long like the draft's 21:9, but with
                            // enough height that the middle of the cloth is a
                            // playing surface rather than a strip
  tableRatioPortrait: 10 / 16,
  seatSize: { phone: 68, laptop: 96 },
  cardSize: { phone: { w: 34, h: 48 }, laptop: { w: 46, h: 64 } },
  hudGap: SPACE['4'],
  touchTarget: 44,          // minimum, every interactive element, all viewports
} as const;

// ---------------------------------------------------------------- Z

export const Z = {
  felt: 0, seat: 10, cards: 20, chips: 30, hud: 40,
  actionBar: 50, toast: 60, modal: 70, tooltip: 80,
} as const;
