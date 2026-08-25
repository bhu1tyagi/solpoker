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
  // The felt. Near-black with a blue cast, never pure #000 — pure black kills
  // the rim-light borders that carry depth on this surface.
  felt: '#0B0E14',
  feltRaised: '#141924',
  feltEdge: '#1A2030',

  // Hairlines. On near-black, borders do the work shadows do on light UI.
  rule: '#232B3D',
  ruleStrong: '#2F3A52',

  // Text. Contrast measured against --felt.
  ink: '#E8ECF4',        // 16.31:1
  inkMuted: '#A8B2C6',   //  9.06:1  default secondary text
  inkFaint: '#8A93A6',   //  6.26:1  timestamps, units, disabled labels
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
  // cards. A dark card on dark felt reads as a hole, not a card.
  cardFace: '#F5F3EE',
  cardFaceEdge: '#DCD8CE',
  cardBack: '#161C2A',

  // Four-colour deck. Standard online-poker convention and the accessible
  // default: red/black alone is the worst possible pairing for deuteranopia.
  // All four measured against --card-face.
  suitSpade: '#15202B',   // 14.87:1
  suitHeart: '#C2143C',   //  5.47:1
  suitDiamond: '#1667C2', //  5.05:1
  suitClub: '#137A4A',    //  4.84:1

  // Two-colour deck, for players who switch it off in settings.
  suitTwoColorRed: '#C2143C',
  suitTwoColorBlack: '#15202B',

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
  // Display: Space Grotesk. Slightly odd letterforms, reads as engineered
  // rather than corporate. Used only for the wordmark, headings, and money.
  display: "'Space Grotesk', system-ui, sans-serif",
  // Body: Inter. Neutral on purpose — the display face carries the personality.
  body: "'Inter', system-ui, sans-serif",
  // Mono: chain data only. Addresses, seeds, hashes, tx signatures.
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', monospace",
} as const;

/**
 * Every number that changes while the player is watching — stack, pot, bet,
 * timer — must use TABULAR figures, or the digits shift width mid-animation
 * and the whole table appears to twitch. This is not cosmetic.
 */
export const NUMERIC = "font-variant-numeric: 'tabular-nums'; font-feature-settings: 'tnum' 1;";

export const TYPE = {
  displayXl: { size: '3.5rem', line: '1.02', weight: 700, tracking: '-0.03em' },
  displayLg: { size: '2.5rem', line: '1.06', weight: 700, tracking: '-0.025em' },
  displayMd: { size: '1.75rem', line: '1.15', weight: 700, tracking: '-0.02em' },
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
  card: '8px',    // playing cards, tuned to look right at 64px tall
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
  // The one glow in the system. Reserved for the seat that is to act.
  toAct:   '0 0 0 2px rgba(20,241,149,0.55), 0 0 24px rgba(20,241,149,0.25)',
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

  ease:      [0.22, 0.61, 0.36, 1],    // default, decelerating
  easeIn:    [0.55, 0.06, 0.68, 0.19],
  spring:    { type: 'spring', stiffness: 380, damping: 32, mass: 0.8 },
  chipSpring:{ type: 'spring', stiffness: 260, damping: 26, mass: 1 },
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
  tableRatio: 16 / 10,      // landscape
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
