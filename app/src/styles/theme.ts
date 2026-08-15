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
 * Six seats spaced evenly on the rail. Seat 0 is bottom center because the
 * local player is rotated into it, so the person you are always sits nearest
 * the action bar, and the rest run clockwise from there.
 *
 * The felt is an ellipse inset 4 percent horizontally and 8 percent
 * vertically, so these come from that ellipse rather than being nudged by eye.
 * Keeping them symmetric matters: an uneven ring reads as a mistake even when
 * nobody can say why.
 */
const RAIL_X = 44;
const RAIL_Y = 43;
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
const BET_PULL = 0.52;
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

export const POT_POSITION = { x: 50, y: 58 };

export const z = {
  felt: 0,
  seat: 10,
  chips: 20,
  cards: 30,
  actionBar: 40,
  toast: 50,
  modal: 60,
};
