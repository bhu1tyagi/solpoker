import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { decodeConfig, decodeTable } from "@/lib/decode";
import { deckPda, holePda } from "@/lib/pdas";
import {
  ABANDONED_AFTER_SECS,
  DECK_ACCOUNT_SIZE,
  DELEGATION_PROGRAM,
  PROGRAM_ID,
  TREASURY_AUTHORITY,
} from "@/lib/constants";
import type { ConfigView } from "@/stores/table-store";

export const runtime = "nodejs";

/**
 * The lobby's table listing, swept once for everybody.
 *
 * This used to run in every browser. `getProgramAccounts` is a full scan of a
 * program's accounts — Helius bills it at ten times a normal call and gives it
 * its own, much lower rate limit (25/s on Developer against 50/s for
 * everything else) — and the lobby needs TWO of them, because a delegated
 * table's account is owned by the delegation program rather than by ours.
 *
 * Per client that is survivable and per crowd it is not: eight people opening
 * the lobby in the same second exhaust the scan budget on any plan, and the
 * eighth sees an empty room. One scan behind a cache serves all of them
 * instead, so the cost of the listing stops scaling with the number of people
 * reading it.
 *
 * Liveness does not come from here. The browser keeps a websocket on the same
 * two owners and updates seats the moment they change; this route is the
 * initial picture and the slow reconcile behind it.
 */

/** Anchor account discriminator for Table, from the IDL. */
const TABLE_DISCRIMINATOR = Uint8Array.from([34, 100, 138, 97, 236, 129, 230, 112]);

const NEVER_PLAYED_GRACE_MS = 60 * 60 * 1000;

/** A table id is `Date.now() * 1000 + random`, so it carries its own birthday. */
const createdAt = (tableId: number) => Math.floor(tableId / 1000);

/**
 * A warm instance answers from memory rather than re-scanning.
 *
 * The HTTP cache in front of this route does most of the work; this catches
 * the burst of cold requests that arrives when that cache expires and several
 * readers turn up at once.
 */
let memo: { at: number; payload: unknown } | null = null;
const MEMO_MS = 4_000;

/** Solana caps getMultipleAccounts at 100 keys and web3.js does not chunk. */
async function batched(conn: Connection, keys: PublicKey[]) {
  const out: Awaited<ReturnType<typeof conn.getMultipleAccountsInfo>> = [];
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...(await conn.getMultipleAccountsInfo(keys.slice(i, i + 100))));
  }
  return out;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_BASE_RPC;
  if (!url) {
    return NextResponse.json({ error: "no rpc configured" }, { status: 503 });
  }

  const now = Date.now();
  if (memo && now - memo.at < MEMO_MS) {
    return NextResponse.json(memo.payload, {
      headers: { "Cache-Control": "s-maxage=5, stale-while-revalidate=25" },
    });
  }

  try {
    const conn = new Connection(url, "confirmed");
    const filters = [
      { memcmp: { offset: 0, bytes: bs58.encode(TABLE_DISCRIMINATOR) } },
    ];

    // Both owners: ours holds idle tables, the delegation program holds the
    // ones currently being played.
    const [own, delegated] = await Promise.all([
      conn.getProgramAccounts(PROGRAM_ID, { filters }),
      conn.getProgramAccounts(DELEGATION_PROGRAM, { filters }),
    ]);

    // The delegation program hosts frozen accounts from every app on the
    // network, and an Anchor discriminator is only a hash of the struct name,
    // so another app's "Table" matches ours byte for byte. Re-deriving the
    // address from the id the account itself claims is what keeps impostors
    // out: one cannot sit at our program's address.
    const enc = new TextEncoder();
    const accounts = [...own, ...delegated].filter((a) => {
      const d = a.account.data;
      if (d.length < 16) return false;
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const idBytes = new Uint8Array(8);
      new DataView(idBytes.buffer).setBigUint64(0, view.getBigUint64(8, true), true);
      const [expected] = PublicKey.findProgramAddressSync(
        [enc.encode("table"), idBytes],
        PROGRAM_ID,
      );
      return expected.equals(a.pubkey);
    });

    // One unreadable account must not take the lobby down with it: older
    // builds left accounts with a different layout, and a failed listing is
    // indistinguishable from an empty one on screen.
    const decoded = accounts.flatMap((a) => {
      try {
        return [
          {
            table: decodeTable(new Uint8Array(a.account.data), a.pubkey.toBase58()),
            delegated: a.account.owner.equals(DELEGATION_PROGRAM),
          },
        ];
      } catch {
        return [];
      }
    });

    // Creation-time facts, read together. Config never changes, and a table's
    // deck and card slots either were made with it or never will be.
    const [configs, holes, decks] = decoded.length
      ? await Promise.all([
          batched(conn, decoded.map((d) => new PublicKey(d.table.config))),
          batched(conn, decoded.map((d) => holePda(new PublicKey(d.table.address), 0))),
          batched(conn, decoded.map((d) => deckPda(new PublicKey(d.table.address)))),
        ])
      : [[], [], []];

    const tables = decoded
      .map((d, i) => {
        let config: ConfigView | null = null;
        try {
          const info = configs[i];
          if (info) config = decodeConfig(new Uint8Array(info.data));
        } catch {
          // Show the table without its stakes rather than not at all.
        }
        const deck = decks[i];
        // A table whose card slots were never created cannot deal a hand and
        // looks completely normal until somebody sits at it and waits. Seat
        // 0's slot is the cheap probe: creation makes all six at once.
        const hasCardSlots = holes[i] !== null;
        const seated = d.table.seats.filter(Boolean).length;
        const emptyFor = d.table.emptySince
          ? Math.floor(now / 1000) - d.table.emptySince
          : 0;
        /*
         * A house table, opened by the treasury so somebody arriving has
         * somewhere to sit. Sitting empty is its JOB, so the two rules that
         * hide a deserted table do not apply to it — without the exemption
         * every house table vanishes an hour after the last player leaves,
         * which is exactly when a newcomer most needs to find one.
         */
        const house = config?.creator === TREASURY_AUTHORITY.toBase58();
        return {
          table: d.table,
          delegated: d.delegated,
          config,
          seated,
          house,
          outdated: !deck || deck.data.length < DECK_ACCOUNT_SIZE || !hasCardSlots,
          abandoned:
            !house && !d.delegated && seated === 0 && emptyFor >= ABANDONED_AFTER_SECS,
          stale:
            !house &&
            !d.delegated &&
            d.table.handNumber === 0 &&
            now - createdAt(d.table.tableId) > NEVER_PLAYED_GRACE_MS,
        };
      })
      .sort((a, b) => b.table.tableId - a.table.tableId);

    const payload = { tables };
    memo = { at: now, payload };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "s-maxage=5, stale-while-revalidate=25" },
    });
  } catch (e) {
    console.error("table listing failed:", e);
    // Serve the last good sweep rather than an empty room: a lobby that
    // briefly shows stale seat counts is worth more than one that claims
    // there are no tables.
    if (memo) {
      return NextResponse.json(memo.payload, {
        headers: { "Cache-Control": "s-maxage=5, stale-while-revalidate=25" },
      });
    }
    return NextResponse.json({ error: "listing failed" }, { status: 502 });
  }
}
