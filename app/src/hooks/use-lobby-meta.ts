"use client";

import { useEffect, useState } from "react";

/**
 * The backend's contribution to the lobby: the table name registry and the
 * trailing-24h aggregates built from server-verified hand reports.
 *
 * Everything here is optional by design. No DATABASE_URL, an unreachable
 * route, an empty day: the hook settles on nulls and an empty name map, and
 * the lobby renders exactly what the chain alone supports. A null is never
 * rendered as a zero.
 */
export interface LobbyMeta {
  names: Record<string, string>;
  hands24h: number | null;
  volume24hChips: number | null;
  avgPotChips: number | null;
}

const EMPTY: LobbyMeta = {
  names: {},
  hands24h: null,
  volume24hChips: null,
  avgPotChips: null,
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
            hands24h: body.hands24h ?? null,
            volume24hChips: body.volume24hChips ?? null,
            avgPotChips: body.avgPotChips ?? null,
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
