/**
 * A table's terms, remembered.
 *
 * A TableConfig is written once when the table is created and the program has
 * no instruction that can ever change it: blinds, buy-in range, seat count,
 * creator. It is the most cacheable thing in the app, and it was being read
 * from the chain on every single visit — twice, in fact, because the creator
 * was fetched separately from the same account it was already inside.
 *
 * That is why stakes "arrived late". Not retries and not the network: the
 * table page simply asked for something it already knew, waited a round trip
 * for the answer, and had nowhere to put it afterwards. A page that opens
 * knowing its own blinds does not need the network to be fast.
 *
 * The lobby fills this too. `/api/tables` already carries every table's config,
 * so by the time somebody clicks into a table the terms are usually here
 * already and the page opens with them on screen.
 *
 * Safe to cache indefinitely precisely because it is immutable — this is not a
 * staleness trade-off, there is no newer value to miss. The read still happens
 * behind it and overwrites, which is what covers a config written by a build
 * older than the current decoder.
 */

import type { ConfigView } from "@/stores/table-store";

const KEY = "solpoker:configs";

type Store = Record<string, ConfigView>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
  } catch {
    return {};
  }
}

/** The remembered terms for a config account, or null if never seen. */
export function readConfigCache(address: string): ConfigView | null {
  if (typeof window === "undefined") return null;
  const hit = load()[address];
  // A shape check rather than a trust check: a build that changed ConfigView
  // must not hand a half-populated object to a buy-in calculation.
  return hit && typeof hit.minBuyIn === "number" && typeof hit.bigBlind === "number"
    ? hit
    : null;
}

export function writeConfigCache(address: string, config: ConfigView) {
  if (typeof window === "undefined") return;
  try {
    const all = load();
    all[address] = config;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable. Costs a round trip, breaks nothing.
  }
}

/** Warm many at once — what the lobby listing does with its sweep. */
export function seedConfigCache(entries: [string, ConfigView | null][]) {
  if (typeof window === "undefined") return;
  try {
    const all = load();
    let changed = false;
    for (const [address, config] of entries) {
      if (!config || all[address]) continue;
      all[address] = config;
      changed = true;
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // As above.
  }
}
