"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey, type KeyedAccountInfo } from "@solana/web3.js";
import bs58 from "bs58";
import { getBaseConnection } from "@/lib/connection";
import { decodeConfig, decodeTable } from "@/lib/decode";
import { seedConfigCache } from "@/lib/config-cache";
import { isTransient, net } from "@/lib/net";
import {
  ABANDONED_AFTER_SECS,
  DECK_ACCOUNT_SIZE,
  DELEGATION_PROGRAM,
  PROGRAM_ID,
  TREASURY_AUTHORITY,
} from "@/lib/constants";
import { deckPda, holePda } from "@/lib/pdas";
import type { ConfigView, TableView } from "@/stores/table-store";

/** Anchor account discriminator for Table, from the IDL. */
const TABLE_DISCRIMINATOR = Uint8Array.from([34, 100, 138, 97, 236, 129, 230, 112]);

/**
 * Tables this browser deleted. The chain forgets them the moment the close
 * lands, but an RPC node can echo the dead account for a while afterwards, and
 * a table you just deleted reappearing in the lobby reads as a failed delete.
 */
const TOMBSTONE_KEY = "solpoker:deleted-tables";
const TOMBSTONE_TTL_MS = 30 * 60 * 1000;

export function tombstoneTable(tableId: number | string) {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? "{}") as Record<
      string,
      number
    >;
    raw[String(tableId)] = Date.now();
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(raw));
  } catch {
    // Storage being unavailable only costs the cosmetic filter.
  }
}

function tombstonedIds(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? "{}") as Record<
      string,
      number
    >;
    const now = Date.now();
    return new Set(
      Object.entries(raw)
        .filter(([, ts]) => now - Number(ts) < TOMBSTONE_TTL_MS)
        .map(([id]) => id),
    );
  } catch {
    return new Set();
  }
}

export interface LobbyTable {
  table: TableView;
  config: ConfigView | null;
  /** Delegated means a game is live on the rollup, so seats are locked. */
  delegated: boolean;
  seated: number;
  /**
   * Created by an older build, so its deck no longer fits the program. Such a
   * table can be paused and cashed out but never played.
   */
  outdated: boolean;
  /** Empty long enough that anyone may sweep it away. */
  abandoned: boolean;
  /**
   * Opened by the treasury, so a newcomer always has somewhere to sit.
   *
   * Sitting empty is the point of one, so it is exempt from `abandoned` and
   * `stale` — the two rules that exist to hide tables nobody is coming back
   * to.
   */
  house: boolean;
  /**
   * Created, sat at, and then left without a single hand ever being played,
   * long enough ago that nobody is coming back.
   *
   * The on-chain sweep cannot reach these: the empty-table clock never starts
   * because a seat is taken, and the game-stale clock never starts because no
   * hand was ever dealt. So they are unreachable litter, usually an abandoned
   * test run or a create flow that was closed half way. The table id carries
   * the moment it was made, which is enough to recognise them and stop showing
   * them. Nothing is destroyed; a table you are sitting at is always shown.
   */
  stale: boolean;
}

/** A table id is `Date.now() * 1000 + random`, so it carries its own birthday. */
export const createdAt = (tableId: number) => Math.floor(tableId / 1000);

/**
 * The last listing that succeeded, kept across navigations.
 *
 * Coming back to the lobby used to mean a blank room until the first RPC
 * round trip finished — and a blank room with an error if that trip failed,
 * which after a session of play it often did, the moment the connection was
 * busiest. The previous list is almost always still true seconds later, so it
 * goes up immediately and the refresh corrects it. Everything in a LobbyTable
 * is plain data, which is what makes the JSON round trip safe.
 */
const LIST_CACHE_KEY = "solpoker:lobby-tables";

function readListCache(): LobbyTable[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LIST_CACHE_KEY) ?? "") as LobbyTable[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function writeListCache(tables: LobbyTable[]) {
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(tables));
  } catch {
    // Storage being unavailable only costs the warm start.
  }
}

const NEVER_PLAYED_GRACE_MS = 60 * 60 * 1000;

/**
 * Per-table facts that cannot change, fetched once and remembered.
 *
 * A table's config is written at creation and never after, and the deck and
 * hole accounts that decide `outdated` either were made with the table or will
 * never exist. Yet every six-second poll re-read all three for every table in
 * the room — three batched calls whose answers were guaranteed to match last
 * tick's. On a lobby of forty tables that made the poll a five-call burst,
 * which is exactly the shape a rate limiter exists to flatten; only the two
 * ownership sweeps actually carry news. Keyed by table address, module level
 * on purpose: remounting the lobby should not forget what cannot have changed.
 *
 * Config is only cached once an account was actually read, so one null from a
 * flaky batch cannot freeze a table as stakes-less for the rest of the visit.
 * `outdated` caches either way: an absent deck at a verified table address is
 * a fact about how the table was created, not about the network.
 */
const configCache = new Map<string, ConfigView | null>();
const outdatedCache = new Map<string, boolean>();

const measured = (address: string) =>
  configCache.has(address) && outdatedCache.has(address);

/**
 * The three creation-time reads for one table, when it first appears over the
 * websocket rather than in a listing. One call, three keys.
 */
async function measureTable(table: TableView): Promise<void> {
  if (measured(table.address)) return;
  const conn = getBaseConnection();
  const addr = new PublicKey(table.address);
  const [config, hole, deck] = await conn.getMultipleAccountsInfo([
    new PublicKey(table.config),
    holePda(addr, 0),
    deckPda(addr),
  ]);
  try {
    if (config) configCache.set(table.address, decodeConfig(new Uint8Array(config.data)));
  } catch {
    // Show the table without its stakes rather than not at all.
    configCache.set(table.address, null);
  }
  outdatedCache.set(
    table.address,
    !deck || deck.data.length < DECK_ACCOUNT_SIZE || hole === null,
  );
}

/**
 * One row of the lobby, from a table account plus the remembered
 * creation-time facts. Shared by the full listing and the websocket path, so
 * a table looks the same however news of it arrived.
 */
function buildEntry(table: TableView, delegated: boolean): LobbyTable {
  const config = configCache.get(table.address) ?? null;
  const seated = table.seats.filter(Boolean).length;
  const emptyFor = table.emptySince
    ? Math.floor(Date.now() / 1000) - table.emptySince
    : 0;
  /*
   * A house table, opened by the treasury so somebody arriving has somewhere
   * to sit without opening one themselves.
   *
   * Sitting empty is its JOB, so the two rules that hide a deserted table do
   * not apply to it. Without this exemption every house table vanishes from
   * the lobby an hour after the last player leaves, which is exactly when a
   * newcomer most needs to find one.
   *
   * It changes nothing on chain: the sweep is permissionless and still
   * reaches these, so the keeper that opens them has to be able to open them
   * again.
   */
  const house = config?.creator === TREASURY_AUTHORITY.toBase58();
  return {
    table,
    delegated,
    config,
    seated,
    house,
    outdated: outdatedCache.get(table.address) ?? false,
    abandoned:
      !house && !delegated && seated === 0 && emptyFor >= ABANDONED_AFTER_SECS,
    stale:
      !house &&
      !delegated &&
      table.handNumber === 0 &&
      Date.now() - createdAt(table.tableId) > NEVER_PLAYED_GRACE_MS,
  };
}

/**
 * The address a Table account must live at, derived from its own claimed id.
 *
 * The delegation program hosts frozen accounts from every app on the network,
 * and an Anchor discriminator is just a hash of the struct name, so another
 * app's "Table" matches ours byte for byte. Re-deriving the address is what
 * keeps an impostor out: it cannot sit at our program's address.
 */
function verifiedTableAddress(data: Uint8Array): PublicKey | null {
  if (data.length < 16) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const idBytes = new Uint8Array(8);
  new DataView(idBytes.buffer).setBigUint64(0, view.getBigUint64(8, true), true);
  const [expected] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("table"), idBytes],
    PROGRAM_ID,
  );
  return expected;
}

/**
 * Every table on the program, including the ones currently playing.
 *
 * The subtlety that once made live tables vanish: while a game runs, the
 * table's base-layer account is owned by the delegation program, not by ours.
 * A query for our program's accounts therefore returns only idle tables, and a
 * player who stepped away from a live one found a lobby that said it did not
 * exist. So this asks both owners.
 *
 * The delegation program hosts frozen accounts from every app on the network,
 * and Anchor discriminators are just a hash of the struct name, so another
 * app's "Table" matches ours byte for byte. Each candidate is verified by
 * re-deriving its address from its own table id; an impostor cannot sit at our
 * program's address.
 */
export function useTables() {
  const [tables, setTables] = useState<LobbyTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Whether at least one listing has succeeded, and how many have failed since. */
  const hadTables = useRef(false);
  const failures = useRef(0);
  /**
   * One listing at a time. A refresh now retries through network weather, so
   * it can still be running when the six-second poll fires again; two
   * interleaved listings would race each other's writes and double the load on
   * an RPC that is already rate-limiting us.
   */
  const inFlight = useRef(false);

  /**
   * Reload the list.
   *
   * `showLoading` is for a refresh the player asked for by hand: the list goes
   * back to skeletons so the press visibly did something. The background poll
   * leaves it alone, because flashing the whole lobby every few seconds on its
   * own schedule is worse than showing nothing.
   */
  const refresh = useCallback(async (showLoading = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const conn = getBaseConnection();
    if (showLoading) setLoading(true);
    try {
      setError(null);
      /*
       * The whole listing, retried in place through transient failures.
       *
       * The first load is a burst — two program sweeps plus three batched
       * reads, landing alongside everything else the page fetches — and the
       * public RPC rate-limits bursts. That is weather, not an outage: the
       * next attempt a second later almost always succeeds. Before this, the
       * very first blip on a browser with no cached list went straight to
       * "Could not reach the network", which the six-second poll then quietly
       * disproved — an error that fixes itself is worse than a skeleton that
       * takes two seconds longer.
       */
      const list = await net(async () => {
        const filters = [{ memcmp: { offset: 0, bytes: bs58.encode(TABLE_DISCRIMINATOR) } }];
        const [ownAccounts, delegatedAccounts] = await Promise.all([
          conn.getProgramAccounts(PROGRAM_ID, { filters }),
          conn.getProgramAccounts(DELEGATION_PROGRAM, { filters }),
        ]);
        const accounts = [...ownAccounts, ...delegatedAccounts].filter((a) =>
          verifiedTableAddress(new Uint8Array(a.account.data))?.equals(a.pubkey),
        );

        // One unreadable account must not take the lobby down with it. Older
        // builds of the program left accounts with a different layout, and a
        // failed listing is indistinguishable from an empty one on screen.
        const dead = tombstonedIds();
        const decoded = accounts.flatMap((a) => {
          try {
            const table = decodeTable(new Uint8Array(a.account.data), a.pubkey.toBase58());
            if (dead.has(String(table.tableId))) return [];
            return [
              {
                table,
                delegated: a.account.owner.equals(DELEGATION_PROGRAM),
              },
            ];
          } catch {
            return [];
          }
        });

        // Solana RPC caps getMultipleAccountsInfo at 100 keys and web3.js does
        // not chunk for you: key 101 is not a partial answer but an error, which
        // would blank the whole lobby — including for people already seated —
        // the day the room grows past a hundred tables. Chunk, preserving order.
        const batched = async (keys: PublicKey[]) => {
          const out: Awaited<ReturnType<typeof conn.getMultipleAccountsInfo>> = [];
          for (let i = 0; i < keys.length; i += 100) {
            out.push(...(await conn.getMultipleAccountsInfo(keys.slice(i, i + 100))));
          }
          return out;
        };

        // Only the tables this browser has not measured yet. Config, deck and
        // card slots are set at creation and never change, so on a steady
        // lobby these three reads happen once and every later poll is just the
        // two ownership sweeps above.
        const unseen = decoded.filter((d) => !measured(d.table.address));
        if (unseen.length) {
          const [configs, holes, decks] = [
            await batched(unseen.map((d) => new PublicKey(d.table.config))),
            await batched(unseen.map((d) => holePda(new PublicKey(d.table.address), 0))),
            await batched(unseen.map((d) => deckPda(new PublicKey(d.table.address)))),
          ];
          unseen.forEach((d, i) => {
            try {
              const info = configs[i];
              // Only a read that actually found the account is remembered; a
              // missing config retries next poll rather than sticking.
              if (info) configCache.set(d.table.address, decodeConfig(new Uint8Array(info.data)));
            } catch {
              // Show the table without its stakes rather than not at all.
              configCache.set(d.table.address, null);
            }
            const deck = decks[i];
            // A table whose card slots were never created cannot deal a hand,
            // and looks completely normal until somebody sits at it and waits.
            // Seat 0's slot is the cheap probe: creation makes all six in one
            // transaction, so either they all exist or none do.
            outdatedCache.set(
              d.table.address,
              !deck || deck.data.length < DECK_ACCOUNT_SIZE || holes[i] === null,
            );
          });
        }

        return decoded
          .map((d) => buildEntry(d.table, d.delegated))
          .sort((a, b) => b.table.tableId - a.table.tableId);
      }, "table listing", { tries: 3 });
      /*
       * Hand the terms to the table pages while we have them.
       *
       * This sweep has already read every table's config, and a config cannot
       * change once written. Somebody clicking into one of these tables should
       * not then wait a round trip for blinds this listing is showing them.
       */
      seedConfigCache(list.map((t) => [t.table.config, t.config]));

      setTables(list);
      writeListCache(list);
      hadTables.current = true;
      failures.current = 0;
    } catch (e) {
      // Loud only when it matters. This used to console.error every failure,
      // and with a poll every six seconds, one network blip put the dev
      // overlay over a lobby that was fine: the last good list was still on
      // screen and the next tick replaced it. A transient with a good list
      // showing is weather, not news — and anything transient has now already
      // been retried three times by `net` before it even lands here. Loud is
      // reserved for failing with nothing to show — the case that once read
      // as an empty lobby to a player who had just created a table — and for
      // failures that repeat or are not network-shaped, which are real and
      // worth a stack trace.
      failures.current += 1;
      if (!hadTables.current || failures.current >= 3 || !isTransient(e)) {
        console.error("table listing failed:", e);
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // Warm start: the previous visit's list, up before the first round trip
  // even begins. In an effect rather than the state initialiser on purpose —
  // the server renders this component too, and hydration must agree with it.
  useEffect(() => {
    const cached = readListCache();
    if (cached) {
      hadTables.current = true;
      setTables((cur) => (cur.length > 0 ? cur : cached));
      setLoading(false);
    }
  }, []);

  /*
   * News arrives by push, not by asking again.
   *
   * The six-second listing poll was the app's biggest RPC spender: two
   * program scans per tick per open tab, which at fifty concurrent viewers is
   * a scan-storm no rate limit survives. The endpoint's websocket carries the
   * same facts for free — a table account changes exactly when somebody
   * joins, leaves, starts, pauses, or closes it — so the room updates the
   * moment something happens and costs nothing while nothing does.
   *
   * Both owners are watched, same as the listing reads both: a table being
   * delegated is next modified as the delegation program's account, and one
   * coming home is next modified as ours. Each subscription filters on the
   * Table discriminator server-side, and the address check keeps out the
   * other apps' same-named accounts that share the delegation program.
   */
  useEffect(() => {
    const conn = getBaseConnection();
    const filters = [{ memcmp: { offset: 0, bytes: bs58.encode(TABLE_DISCRIMINATOR) } }];

    const upsert = (entry: LobbyTable) =>
      setTables((cur) => {
        const rest = cur.filter((t) => t.table.address !== entry.table.address);
        return [...rest, entry].sort((a, b) => b.table.tableId - a.table.tableId);
      });

    const onChange = ({ accountId, accountInfo }: KeyedAccountInfo) => {
      // A closed account notifies once with nothing in it. That is
      // `close_table` seen from outside: take the row down.
      if (accountInfo.lamports === 0 || accountInfo.data.length < 16) {
        setTables((cur) => cur.filter((t) => t.table.address !== accountId.toBase58()));
        return;
      }
      const data = new Uint8Array(accountInfo.data);
      if (!verifiedTableAddress(data)?.equals(accountId)) return;
      let table: TableView;
      try {
        table = decodeTable(data, accountId.toBase58());
      } catch {
        return;
      }
      if (tombstonedIds().has(String(table.tableId))) return;
      const delegated = accountInfo.owner.equals(DELEGATION_PROGRAM);
      upsert(buildEntry(table, delegated));
      // A table born after the last listing has no measured facts yet. Show
      // it at once — stakes arrive a beat later — and measure exactly once.
      if (!measured(table.address)) {
        void measureTable(table)
          .then(() => upsert(buildEntry(table, delegated)))
          .catch(() => {
            // The next reconcile listing measures it instead.
          });
      }
    };

    const subs = [
      conn.onProgramAccountChange(PROGRAM_ID, onChange, { commitment: "confirmed", filters }),
      conn.onProgramAccountChange(DELEGATION_PROGRAM, onChange, { commitment: "confirmed", filters }),
    ];
    return () => {
      for (const s of subs) void conn.removeProgramAccountChangeListener(s).catch(() => {});
    };
  }, []);

  useEffect(() => {
    void refresh();
    // A slow reconcile, not the news channel. The websocket above carries the
    // room's changes; this exists for what a socket can miss — events dropped
    // across a reconnect, a subscription the endpoint quietly let lapse — and
    // once a minute is enough for a safety net. Coming back to the tab still
    // refreshes immediately, because that is the moment a person is actually
    // looking and the socket may have been idle for hours.
    const id = setInterval(() => {
      // A hidden tab keeps its place but stops spending the shared RPC
      // budget; the focus handler below catches it up the moment it returns.
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  return { tables, loading, error, refresh };
}

/**
 * A delegated table's base-layer copy is frozen, so reading it tells you what
 * the table looked like when play started, not what it looks like now.
 */
export function isJoinable(t: LobbyTable) {
  return !t.outdated && !t.delegated && t.table.state === 0 && t.seated < 6;
}

/** Tables that have sat empty long enough for anyone to clear away. */
export const abandonedTables = (tables: LobbyTable[]) => tables.filter((t) => t.abandoned);
