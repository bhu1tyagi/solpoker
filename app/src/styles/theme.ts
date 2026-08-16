/**
 * The JS half of the design system: motion, geometry, and anything a component
 * needs as a number rather than a CSS variable.
 *
 * One spring vocabulary for the whole app. Reaching for a bespoke transition is
 * usually a sign the component wants a different one of these, not a new one.
 */

export const spring = {
  /** Controls, chips, seat rings. Quick and decisive. */
  snappy: { type: "spring", stiffness: 420, damping: 30 } as const,
  /** Panels, modals, route changes. Settles without bouncing. */
  gentle: { type: "spring", stiffness: 260, damping: 26 } as const,
  /** Cards leaving the dealer. A little overshoot reads as a flick of the wrist. */
  deal: { type: "spring", stiffness: 300, damping: 24 } as const,
};

export const duration = {
  micro: 0.12,
  standard: 0.2,
  large: 0.32,
};

/** Stagger gaps, in seconds. */
export const stagger = {
  deal: 0.06,
  board: 0.09,
  list: 0.04,
};

/**
 * Seat positions around the felt, as percentages of the table box.
 *
 * The table is an ellipse sitting on a rectangular panel, so the seats run
 * evenly around that ellipse rather than along the panel's edges. Seat 0 is
 * bottom centre because the local player is rotated into it, so the person you
 * are always sits nearest the action bar, and the rest run clockwise.
 *
 * The ring is a little tighter than the ellipse itself, which puts the plates
 * astride the rim the way players sit at a real table. Keeping it symmetric
 * matters: an uneven ring reads as a mistake even when nobody can say why.
 */
const RAIL_X = 40;
const RAIL_Y = 40;
const point = (deg: number) => ({
  x: Math.round((50 + RAIL_X * Math.cos((deg * Math.PI) / 180)) * 10) / 10,
  y: Math.round((50 + RAIL_Y * Math.sin((deg * Math.PI) / 180)) * 10) / 10,
});

export const SEAT_POSITIONS: { x: number; y: number }[] = [
  point(90),
  point(145),
  point(215),
  point(270),
  point(325),
  point(35),
];

/** Where a seat's bet chips sit: the same ring, pulled in toward the pot. */
const BET_PULL = 0.5;
const betPoint = (deg: number) => ({
  x: Math.round((50 + RAIL_X * BET_PULL * Math.cos((deg * Math.PI) / 180)) * 10) / 10,
  y: Math.round((50 + RAIL_Y * BET_PULL * Math.sin((deg * Math.PI) / 180)) * 10) / 10,
});

export const BET_POSITIONS: { x: number; y: number }[] = [
  betPoint(90),
  betPoint(145),
  betPoint(215),
  betPoint(270),
  betPoint(325),
  betPoint(35),
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
 */
export const TABLE_GEOMETRY = {
  wide: {
    aspect: "1108 / 640",
    maxWidth: 1108,
    ellipseInset: "13% 11%",
    boardTop: "44%",
    seats: SEAT_POSITIONS,
    bets: BET_POSITIONS,
    pot: POT_POSITION,
  },
  portrait: {
    aspect: "560 / 760",
    maxWidth: 430,
    ellipseInset: "9% 6%",
    boardTop: "44%",
    seats: SEAT_POSITIONS_PORTRAIT,
    bets: BET_POSITIONS_PORTRAIT,
    pot: POT_POSITION_PORTRAIT,
  },
} as const;

export const z = {
  felt: 0,
  seat: 10,
  chips: 20,
  cards: 30,
  actionBar: 40,
  toast: 50,
  modal: 60,
};
