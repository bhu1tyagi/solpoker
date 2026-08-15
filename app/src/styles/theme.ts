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
 * Seat 0 is bottom center because the local player is rotated into it, so the
 * person you are always sits closest to the action bar. The rest run clockwise.
 */
export const SEAT_POSITIONS: { x: number; y: number }[] = [
  { x: 50, y: 96 },
  { x: 12, y: 76 },
  { x: 6, y: 32 },
  { x: 50, y: 6 },
  { x: 94, y: 32 },
  { x: 88, y: 76 },
];

/** Where a seat's bet chips sit: pulled in toward the pot. */
export const BET_POSITIONS: { x: number; y: number }[] = [
  { x: 50, y: 74 },
  { x: 27, y: 65 },
  { x: 23, y: 40 },
  { x: 50, y: 26 },
  { x: 77, y: 40 },
  { x: 73, y: 65 },
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
