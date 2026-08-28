/**
 * The JS half of the design system: motion, geometry, and anything a component
 * needs as a number rather than a CSS variable.
 *
 * Motion is not defined here. It is derived from MOTION in src/design/tokens.ts,
 * which is the single source of truth shared with the generated CSS custom
 * properties — so a duration cannot mean one thing in a transition and another
 * in a stylesheet. What this file adds is the seat geometry below, which is
 * table knowledge rather than a design token.
 *
 * One spring vocabulary for the whole app. Reaching for a bespoke transition is
 * usually a sign the component wants a different one of these, not a new one.
 */

import { LAYOUT, MOTION, Z } from "@/design/tokens";

/** ms → s, because motion/react counts in seconds and the tokens are in ms. */
const secs = (ms: number) => ms / 1000;

const ease = MOTION.ease as unknown as [number, number, number, number];

export const spring = {
  /** Controls, seat rings, anything that answers a press. Quick and decisive. */
  snappy: MOTION.spring,
  /** Panels, modals, route changes. Settles without bouncing. */
  gentle: MOTION.chipSpring,
  /**
   * Chips travelling from a stack to the pot.
   *
   * This is the one animation that is sized against measured latency rather
   * than feel: the client renders optimistically the instant a verb is pressed,
   * and chain confirmation is meant to land *inside* this movement. See the
   * note on MOTION.chipCommit — shortening it exposes the wait it exists to
   * cover, which makes the table feel broken rather than snappy.
   */
  chip: MOTION.chipSpring,
  /**
   * Cards leaving the dealer. A tween rather than a spring: the deal reads as
   * dealing because of the 70ms stagger between cards, not because any one card
   * overshoots.
   */
  deal: { duration: secs(MOTION.cardDeal), ease },
} as const;

/** Durations, in seconds. Names and values both come from MOTION. */
export const duration = {
  instant: secs(MOTION.instant),
  fast: secs(MOTION.fast),
  /** The default crossfade. Most things that are not listed below use this. */
  standard: secs(MOTION.base),
  slow: secs(MOTION.slow),
  chipCommit: secs(MOTION.chipCommit),
  cardDeal: secs(MOTION.cardDeal),
  /** Showdown: the pot sliding to the winner while their stack counts up. */
  potPush: secs(MOTION.potPush),
  /** A street fading and dropping in. */
  boardReveal: secs(MOTION.boardReveal),
  /** The to-act breathing loop. */
  seatPulse: secs(MOTION.seatPulse),
};

/** Stagger gaps, in seconds. */
export const stagger = {
  /** The deal, and the flop's three cards, which use the same beat. */
  deal: secs(MOTION.cardStagger),
  board: secs(MOTION.cardStagger),
  list: 0.04,
};

/**
 * Seat positions around the felt, as percentages of the table box.
 *
 * The table is a long stadium, so the seats sit where chairs go at a real
 * one: two along each long rail, one at each end. Placed by hand rather than
 * by the old ellipse formula, because chairs at a stadium sit along its
 * straights, not on an ellipse — the formula bunched them toward the corners
 * the moment the table stretched to 21:9.
 *
 * Seat 0 is on the bottom rail because the local player is rotated into it,
 * so the person you are always sits nearest the action bar, and the rest run
 * clockwise: bottom-left, left end, top-left, top-right, right end,
 * bottom-right. Each straddles the rim the way players sit at a real table.
 */
export const SEAT_POSITIONS: { x: number; y: number }[] = [
  // The classic 6-max ring, hero at the bottom centre: the rotation that puts
  // you at seat 0 puts you dead centre above the action bar, facing the
  // opponent across the table, the way every poker room seats its hero.
  { x: 50, y: 91 },
  { x: 13, y: 72 },
  { x: 26, y: 11 },
  { x: 50, y: 8 },
  { x: 74, y: 11 },
  { x: 87, y: 72 },
];

/**
 * Where a seat's bet chips sit: the clear band between the seats and the
 * board, each spot pulled toward the middle from its own chair.
 */
export const BET_POSITIONS: { x: number; y: number }[] = [
  { x: 50, y: 71 },
  { x: 28, y: 60 },
  { x: 38, y: 29 },
  // Nudged off the centre line: dead centre above the board is where the pot
  // pile stands, and the top seat's bet was landing in its lap.
  { x: 60, y: 28 },
  { x: 70, y: 32 },
  { x: 72, y: 60 },
];

export const POT_POSITION = { x: 50, y: 56 };

/**
 * The same table stood on end, for a phone held upright.
 *
 * These are placed by hand rather than by the ellipse formula, because on a
 * narrow screen the constraint is the screen edge, not the rim: side seats sit
 * exactly as far in as a compact plate needs to stay whole, you sit at the
 * bottom above your controls, and one seat takes the top. The order still runs
 * clockwise from the bottom, so the rotation that puts you at the bottom works
 * unchanged.
 */
export const SEAT_POSITIONS_PORTRAIT: { x: number; y: number }[] = [
  { x: 50, y: 84 },
  { x: 21, y: 68 },
  { x: 21, y: 25 },
  { x: 50, y: 8 },
  { x: 79, y: 25 },
  { x: 79, y: 68 },
];

/**
 * Bets sit in the clear band between the seats' cards and the board: below it
 * for the bottom half, above it for the top. Each pair is pulled toward the
 * middle so a wide stack-plus-label never reaches back over its own seat.
 */
export const BET_POSITIONS_PORTRAIT: { x: number; y: number }[] = [
  { x: 50, y: 64 },
  { x: 42, y: 56 },
  { x: 40, y: 30 },
  { x: 50, y: 26 },
  { x: 60, y: 30 },
  { x: 58, y: 56 },
];

export const POT_POSITION_PORTRAIT = { x: 50, y: 55 };

/**
 * Everything about the table's shape that depends on which way it stands.
 * TableFelt picks one of these; nothing else needs to know there are two.
 *
 * Both ratios come from LAYOUT: 21:9 landscape up to --table-max-w, and the
 * same table stood on end at 10:16 below the phone breakpoint. The portrait
 * variant exists rather than a scale transform because a shrunken landscape
 * table on a phone is unusable — and it keeps its own gentler ratio, because
 * a phone screen has no room for a 9:21 tower.
 */
const WIDE_W = parseInt(LAYOUT.tableMaxW, 10);
const PORTRAIT_W = 430;

export const TABLE_GEOMETRY = {
  wide: {
    aspect: `${LAYOUT.tableRatio}`,
    maxWidth: WIDE_W,
    ellipseInset: "13% 11%",
    boardTop: "44%",
    seats: SEAT_POSITIONS,
    bets: BET_POSITIONS,
    pot: POT_POSITION,
  },
  portrait: {
    aspect: `${LAYOUT.tableRatioPortrait}`,
    maxWidth: PORTRAIT_W,
    ellipseInset: "9% 6%",
    boardTop: "44%",
    seats: SEAT_POSITIONS_PORTRAIT,
    bets: BET_POSITIONS_PORTRAIT,
    pot: POT_POSITION_PORTRAIT,
  },
} as const;

/** Stacking order, from the same source as the --z-* custom properties. */
export const z = Z;
