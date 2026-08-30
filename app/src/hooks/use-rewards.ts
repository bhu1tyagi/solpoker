"use client";

import { useEffect, useState } from "react";

/**
 * The rewards page's figures: what wallets have won, what they have paid in
 * rake, and where the caller stands in both.
 *
 * Optional in exactly the way the lobby's totals are. No DATABASE_URL, an
 * unreachable route, a room that has played nothing: the hook settles on nulls
 * and empty boards, and `stored` carries the difference between "nobody is
 * keeping track" and "the database answered and there is nothing yet". A null
 * is never rendered as a zero.
 */

export interface RewardRow {
  wallet: string;
  /** What they chose to be called, if anything. Never replaces the address. */
  displayName: string | null;
  chips: number;
  hands: number;
}

export interface YouRewards {
  rakeChips: number;
  rakeRank: number;
  /** Profit, and null for a wallet with no hand carrying both halves. */
  netChips: number | null;
  netRank: number | null;
  /** Share of the pool in basis points, or null below the eligibility floor. */
  shareBps: number | null;
  eligible: boolean;
}

/** One day, cumulative: the rake collected and the players' share of it. */
export interface PoolPoint {
  at: number;
  /** Hands recorded to date — the chart's x axis. */
  hands: number;
  rake: number;
  pool: number;
  /** The caller's own rake to date, or null when no wallet was named. */
  yours: number | null;
}

export interface Rewards {
  stored: boolean;
  /** Epoch millis of the first recorded hand, which is when counting started. */
  since: number | null;
  handsRecorded: number | null;
  rakeChips: number | null;
  poolChips: number | null;
  contributors: number | null;
  eligibleRakeChips: number | null;
  winners: RewardRow[];
  contributorsBoard: RewardRow[];
  series: PoolPoint[];
  you: YouRewards | null;
  /** False only until the first answer arrives, so skeletons know to show. */
  loaded: boolean;
}

const EMPTY: Rewards = {
  stored: false,
  since: null,
  handsRecorded: null,
  rakeChips: null,
  poolChips: null,
  contributors: null,
  eligibleRakeChips: null,
  winners: [],
  contributorsBoard: [],
  series: [],
  you: null,
  loaded: false,
};

const POLL_MS = 60_000;
const CACHE_KEY = "solpoker:rewards";

/**
 * The last boards that arrived, kept across navigations, and deliberately
 * without the caller's own row: a warm start must never show one wallet's
 * figures to whoever connects next.
 */
function readCache(): Omit<Rewards, "you" | "loaded"> | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "");
    return parsed && parsed.stored === true ? parsed : null;
  } catch {
    return null;
  }
}

export function useRewards(wallet: string | null): Rewards {
  const [data, setData] = useState<Rewards>(EMPTY);

  // In an effect rather than the initialiser: the server renders this route
  // too, and hydration has to agree with what it rendered.
  useEffect(() => {
    const cached = readCache();
    if (cached) setData((cur) => (cur.stored ? cur : { ...cur, ...cached }));
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const res = await fetch(
          wallet ? `/api/rewards?wallet=${encodeURIComponent(wallet)}` : "/api/rewards",
        );
        if (!res.ok) return;
        const body = (await res.json()) as Partial<Rewards>;
        if (dead) return;
        const next: Rewards = {
          stored: body.stored === true,
          since: body.since ?? null,
          handsRecorded: body.handsRecorded ?? null,
          rakeChips: body.rakeChips ?? null,
          poolChips: body.poolChips ?? null,
          contributors: body.contributors ?? null,
          eligibleRakeChips: body.eligibleRakeChips ?? null,
          winners: body.winners ?? [],
          contributorsBoard: body.contributorsBoard ?? [],
          series: body.series ?? [],
          you: body.you ?? null,
          loaded: true,
        };
        setData(next);
        if (next.stored) {
          try {
            const { you: _you, loaded: _loaded, ...shared } = next;
            localStorage.setItem(CACHE_KEY, JSON.stringify(shared));
          } catch {
            // Storage being unavailable only costs the warm start.
          }
        }
      } catch {
        // The page has an honest empty state for exactly this.
        if (!dead) setData((cur) => ({ ...cur, loaded: true }));
      }
    };
    void pull();
    const t = setInterval(() => void pull(), POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [wallet]);

  return data;
}
