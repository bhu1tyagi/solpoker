"use client";

import { useEffect, useState } from "react";

/**
 * The backend's contribution to the lobby: play totals built from
 * server-verified hand reports, the same totals broken down per table, and
 * the table name registry.
 *
 * Everything here is optional by design. No DATABASE_URL, an unreachable
 * route, an empty day: the hook settles on nulls and empty maps, and the
 * lobby renders exactly what the chain alone supports. A null is never
 * rendered as a zero.
 */

/** Play totals over whichever window the server chose. */
export interface Totals {
  /** Hands verified and stored. Zero is a fact; null means nobody knows. */
  hands: number | null;
  /** How many of those carried a pot anyone saw. The money figures use only these. */
  potted: number | null;
  /** Chips that moved through pots. Null until hands carry an observed pot. */
  volumeChips: number | null;
  avgPotChips: number | null;
  biggestPotChips: number | null;
}

export interface TableTotals extends Totals {
  /** Epoch millis of the most recent stored hand, or null. */
  lastHandAt: number | null;
}

export interface LobbyMeta extends Totals {
  names: Record<string, string>;
  /**
   * A database answered.
   *
   * This is the difference between "this room has played nothing yet" and
   * "nobody is keeping track", which look identical in the figures and are
   * not the same claim at all. False keeps the lobby on chain-derived tiles;
   * true lets it state a zero, because a zero is then something known rather
   * than something assumed.
   */
  stored: boolean;
  /**
   * Hands dealt, counted by the program itself and never windowed.
   *
   * Distinct from `hands`, which counts the reports that reached us. This one
   * is the authority — it covers hands played before any reporting existed and
   * hands whose client closed the tab before finishing the capture — but it
   * comes from a running counter with no timestamps behind it, so it can only
   * ever mean "all time".
   */
  handsDealt: number | null;
  /**
   * Floors the on-chain rake proves, for the figures the chain does not store
   * directly. Present only when rake has actually been taken.
   *
   * The lobby prefers an observed figure and falls back to these, marking the
   * result as a lower bound when it does. They are never mixed silently: a
   * bound that reads as a total is the same lie as an invented number, just
   * with arithmetic in front of it.
   */
  rakeFloor: {
    volumeChips: number;
    avgPotChips: number;
    biggestPotChips: number;
  } | null;
  /**
   * Which stretch of time every figure above covers. The server picks the
   * last 24 hours while there was play in it and all time otherwise, so a
   * quiet night reads as history rather than as an empty room. Labels have to
   * follow this rather than hard-coding "24h", or they will say one thing
   * while the numbers mean another.
   */
  window: "24h" | "all";
  tables: Record<string, TableTotals>;
}

const EMPTY: LobbyMeta = {
  names: {},
  stored: false,
  handsDealt: null,
  rakeFloor: null,
  window: "24h",
  hands: null,
  potted: null,
  volumeChips: null,
  avgPotChips: null,
  biggestPotChips: null,
  tables: {},
};

const POLL_MS = 60_000;

export function useLobbyMeta(): LobbyMeta {
  const [meta, setMeta] = useState<LobbyMeta>(EMPTY);

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/lobby");
        if (!res.ok) return;
        const body = (await res.json()) as Partial<LobbyMeta>;
        if (!dead) {
          setMeta({
            names: body.names ?? {},
            stored: body.stored === true,
            handsDealt: body.handsDealt ?? null,
            rakeFloor: body.rakeFloor ?? null,
            window: body.window === "all" ? "all" : "24h",
            hands: body.hands ?? null,
            potted: body.potted ?? null,
            volumeChips: body.volumeChips ?? null,
            avgPotChips: body.avgPotChips ?? null,
            biggestPotChips: body.biggestPotChips ?? null,
            tables: body.tables ?? {},
          });
        }
      } catch {
        // The chain-derived lobby needs nothing from this route to work.
      }
    };
    void pull();
    const t = setInterval(() => void pull(), POLL_MS);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  return meta;
}
