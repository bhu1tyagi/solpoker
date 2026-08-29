/**
 * One place that knows what a chip costs.
 *
 * The conversion used to be written out at five call sites, and two of them
 * divided by a hard-coded 1000 instead of reading the rate at all — so changing
 * the price of a chip would have left the create-table modal and the take-seat
 * sheet quoting the old one, in the two places a player looks right before they
 * commit money. Everything goes through here now.
 */

import { MICRO_USDC_PER_CHIP } from "./constants";

/** Base units of USDC — what the chain actually moves. */
export const chipsToMicroUsdc = (chips: number) => chips * MICRO_USDC_PER_CHIP;

/** Dollars, as a number, for arithmetic. */
export const chipsToUsd = (chips: number) => chipsToMicroUsdc(chips) / 1e6;

/** Chips a given USDC balance can buy, rounded down. */
export const microUsdcToChips = (microUsdc: number) =>
  Math.max(0, Math.floor(microUsdc / MICRO_USDC_PER_CHIP));

/**
 * Dollars, as a string, for display. Cents are shown whenever they carry
 * information: $4 rather than $4.00, but $0.20 rather than $0.2, and never a
 * trailing half-cent from floating point.
 */
export function formatUsd(chips: number): string {
  const usd = chipsToUsd(chips);
  const whole = Number.isInteger(usd);
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A profit or a loss, with its sign written out.
 *
 * The sign is part of the string rather than a colour applied to it, because
 * green-versus-red is the one pairing the most common colour blindness cannot
 * separate — and this is the figure a player most wants to read at a glance.
 * A true minus sign, not a hyphen: it aligns with the digits in a tabular
 * face, where a hyphen sits low and narrow.
 */
export function formatSignedUsd(chips: number): string {
  if (chips === 0) return formatUsd(0);
  return `${chips > 0 ? "+" : "−"}${formatUsd(Math.abs(chips))}`;
}

/** A stake range, as one string: "$4–$20". */
export const formatUsdRange = (min: number, max: number) =>
  `${formatUsd(min)}–${formatUsd(max)}`;

/** Lamports as SOL, for the gas notes. SOL is not money here, it is postage. */
export const formatSol = (lamports: number) =>
  `${(lamports / 1e9).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} SOL`;
