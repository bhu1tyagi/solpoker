/**
 * The terms of the rewards programme, in one place.
 *
 * These are commitments, not styling, so they live where the page, the API and
 * the snapshot script all read the same number. A share that says 20% on the
 * page and computes 15% in the export is the kind of mistake that is
 * indistinguishable from dishonesty afterwards.
 */

/**
 * The share of collected rake set aside for players, in basis points.
 *
 * 2000 = 20%. Rake is taken in chips, so the pool is a chip figure and stays
 * one until there is a token to convert it into.
 */
export const AIRDROP_RAKE_SHARE_BPS = 2_000;

/** The share of token fees set aside for players, in basis points. 5000 = 50%. */
export const AIRDROP_TOKEN_FEE_SHARE_BPS = 5_000;

/**
 * The least rake a wallet must have generated to take a share.
 *
 * 100 chips is one dollar. A floor rather than a rank cutoff, and the
 * distinction is the whole design: a cutoff at the fiftieth player would make
 * the boundary worth fighting over, and the cheapest way to fight over it is
 * to play yourself from a second wallet — paying real rake to manufacture a
 * rank. Sharing in proportion to rake paid removes the prize for doing that,
 * because a wash hand costs its full rake and buys back only its own fraction
 * of a fifth of it. The floor exists solely to keep the distribution list from
 * filling with wallets owed a fraction of a cent.
 */
export const MIN_ELIGIBLE_RAKE_CHIPS = 100;

/** How many contributors the leaderboard shows. Display only, not eligibility. */
export const REWARDS_BOARD_SIZE = 50;

/** The player-bound share of a rake total, in chips. */
export const poolFromRake = (rakeChips: number) =>
  Math.floor((rakeChips * AIRDROP_RAKE_SHARE_BPS) / 10_000);

export const pct = (bps: number) => `${bps / 100}%`;
