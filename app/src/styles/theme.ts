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
 * Where a seat's bet chips sit.
 *
 * THE RULE: a bet never lands on a card. Every spot below is in the clear
 * band between one seat's own hole cards and the middle of the table, and it
 * is checked against three things — that seat's cards, the pot pile, and the
 * board — not just eyeballed against the chair it belongs to.
 *
 * That rule was being broken by the seat it matters most for. The hero's bet
 * sat at y 71, and the hero's own hand starts at y 71: the chips and the
 * amount printed square across the top of both hole cards, hiding the rank of
 * the second one on every street the hero bet. The band the bet needs is
 * between the status line under the board and the top of the hand, and at the
 * old 2.2 table ratio that band was 46px — narrower than the chip pill. The
 * ratio change is what opened it up; these numbers are what sit in it.
 *
 * The bands, as fractions of the table box, at the geometry below:
 *   board column   pot 28.5-33  ·  board 35-53  ·  status 58-61
 *   bottom seats   cards from 75 (hero), 59-72 (sides)
 *   top seats      cards to 23
 *
 * The top of the table is genuinely tight — three chairs, their hands hanging
 * down to 23, and the pot from 28 — so the three top bets flank the pile at
 * its own height rather than pretending there is a lane above it. That is
 * what a real table looks like anyway. Where something has to give, it gives
 * against a face-DOWN card: an opponent's back has no rank to hide, and the
 * cards this rule exists to protect are the hero's hand and the board.
 */
export const BET_POSITIONS: { x: number; y: number }[] = [
  // Hero, straight up into the clear band: bottom centre is the one chair
  // whose "pulled toward the middle" is a straight line, and the bet reads as
  // pushed forward rather than dropped on the hand.
  { x: 50, y: 68 },
  { x: 26, y: 62 },
  { x: 34, y: 31 },
  // The top-centre seat pushes straight down toward the pile it is joining,
  // and stops short of it: stacked on the same centre line, its figure and the
  // pot's read as one number cut in half unless there is real air between.
  { x: 50, y: 24 },
  { x: 66, y: 31 },
  { x: 74, y: 62 },
];

/**
 * The pot pile itself, for the chips that fly into and out of it.
 *
 * This is not a free choice: it has to be where the pot is actually drawn, at
 * the top of the board column. It used to say 56, which is the status line —
 * so a called bet slid to a spot on the cloth with nothing in it, and the
 * showdown's chips set off for the winner from the same empty spot.
 */
export const POT_POSITION = { x: 50, y: 31 };

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
 *
 * Upright, the side chairs are the tight ones. Their cards reach in to x 32
 * and x 68, so their bets sit inside that lane rather than beside the chair —
 * at x 42 the amount was printing over the seat's own hand, and at y 56 the
 * pair of them sat across the status line under the board.
 */
export const BET_POSITIONS_PORTRAIT: { x: number; y: number }[] = [
  { x: 50, y: 66 },
  { x: 40, y: 58 },
  { x: 40, y: 29 },
  { x: 50, y: 21 },
  { x: 60, y: 29 },
  { x: 60, y: 58 },
];

/** Where the upright table draws its pot. Same rule as POT_POSITION. */
export const POT_POSITION_PORTRAIT = { x: 50, y: 35 };

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
const PORTRAIT_W = parseInt(LAYOUT.tablePortraitMaxW, 10);

/**
 * THE CANVAS: the width at which a table's furniture is drawn true size.
 *
 * Everything on the felt — seats, cards, chips, the labels on them — is a
 * fixed pixel size, and the felt itself is fluid. Those two facts were in
 * direct contradiction: at 1120px the table was drawn as designed, and at
 * 790px on a tablet the same 70px board cards and 60px avatars were dropped
 * onto a felt 30% smaller, so the seats' hands overlapped the board and the
 * bets landed on the community cards. It was not a phone bug — every width
 * between the phone breakpoint and 1120px was drawing a table too big for its
 * own cloth.
 *
 * So the table is now drawn once, at its canvas size, and scaled as a single
 * object to whatever width it is given — which is how a real client does it,
 * and why one set of seat percentages can serve every screen.
 *
 * `compact` is the second canvas rather than a second set of rules: below
 * `wideCompactBelow` the furniture switches to its phone sizes, drawn on a
 * 740px canvas. What changes between the two is how big the type is relative
 * to the felt — a small screen needs proportionally larger labels or it needs
 * a magnifying glass — and 740 is not a taste: it is the width at which the
 * compact furniture occupies the same fraction of the cloth as the full-size
 * furniture does at 1120. The board column is 35.1% of the table's height on
 * one and 35.0% on the other; a seat's column is 31.9% against 31.6%. That is
 * what lets ONE set of percentages below place the bets on both, and it is
 * the thing to re-derive if either set of furniture sizes changes.
 */
export const TABLE_CANVAS = {
  wide: WIDE_W,
  wideCompact: 740,
  /** Under this measured felt width, the compact canvas is the right one. */
  wideCompactBelow: 900,
  portrait: 400,
} as const;

export const TABLE_GEOMETRY = {
  wide: {
    aspect: `${LAYOUT.tableRatio}`,
    ratio: LAYOUT.tableRatio,
    maxWidth: WIDE_W,
    ellipseInset: "13% 11%",
    /**
     * The board column's centre. 47 rather than 44: the column is centred on
     * this point, so moving it down moves the pot clear of the row the top
     * seats' bets occupy, and it still leaves the hero's bet a band three
     * times its own height on the other side.
     */
    boardTop: "47%",
    seats: SEAT_POSITIONS,
    bets: BET_POSITIONS,
    pot: POT_POSITION,
  },
  portrait: {
    aspect: `${LAYOUT.tableRatioPortrait}`,
    ratio: LAYOUT.tableRatioPortrait,
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
