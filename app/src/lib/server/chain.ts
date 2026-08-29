/**
 * Reading hand counts off the base layer, on the server.
 *
 * Every table carries `hand_number`, a counter the program bumps as each hand
 * is dealt. That is the authoritative answer to "how many hands has this table
 * played" — better than the hand reports clients send, which are best effort
 * and go missing whenever a tab closes before the capture finishes.
 *
 * It is read here rather than taken from the browser because it is about to
 * become a headline figure. The lobby reads the same accounts client-side for
 * its own listing, but a number the page can post to us is a number anyone can
 * post to us.
 *
 * The catch, and the reason this is written down instead of just displayed:
 * `close_table` deletes the table account AND drains its history account, so a
 * closed table takes its hand count off the chain entirely. A figure read live
 * would silently fall when someone tidied up. Recording the highest count ever
 * seen, per table, is what makes it survive.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import idl from "@/lib/idl/solpoker.json";
import { serverRpc, serverFetch } from "./rpc";

/** Byte offsets into a `Table` account. Mirrors decode.ts, which is the client's copy. */
const TABLE_ID_AT = 8;
// 8 discriminator + 8 table_id + 32 config + 6 x 32 seats + 1 button
const HAND_NUMBER_AT = 241;
const NEEDED = HAND_NUMBER_AT + 8;

const PROGRAM = new PublicKey(idl.address);
const TABLE_DISCRIMINATOR = new Uint8Array(
  (idl.accounts as { name: string; discriminator: number[] }[]).find(
    (a) => a.name === "Table",
  )!.discriminator,
);

/**
 * The same endpoint the browser uses.
 *
 * NEXT_PUBLIC_ variables are readable on the server too — the prefix controls
 * what is additionally exposed to the client, not what the server can see — so
 * this cannot drift from the chain the app is actually playing on.
 */
function rpc(): string | null {
  return serverRpc() || null;
}

export interface TableHands {
  tableId: string;
  hands: number;
}

export interface ChainRead {
  tables: TableHands[];
}

/**
 * Everything the base layer will say about how much poker has been played.
 *
 * Returns null when the chain cannot be reached, which the caller must treat
 * as "no news" rather than as "no tables" — the difference between the two is
 * a hand count that quietly resets to zero.
 *
 * This used to also total up the rake so the lobby could invert it into a
 * volume floor. That read as clever and displayed as wrong: volume derived
 * from rake ignores every pot that folded before the flop, which is most of
 * them, and moves only when the house gets paid. Volume is the money that
 * went through the pots, and the pot is never written to chain — so it comes
 * from verified hand reports or it is honestly unknown.
 */
export async function readChain(): Promise<ChainRead | null> {
  const url = rpc();
  if (!url) return null;
  try {
    const conn = new Connection(url, { commitment: "confirmed", fetch: serverFetch() });
    const tableAccounts = await conn.getProgramAccounts(PROGRAM, {
      commitment: "confirmed",
      // Only Table accounts, and only the prefix carrying the fields read
      // below. The lobby makes this same call unfiltered every few seconds;
      // no reason for the server to pull more than it uses.
      filters: [{ memcmp: { offset: 0, bytes: bs58(TABLE_DISCRIMINATOR) } }],
      dataSlice: { offset: 0, length: NEEDED },
    });

    const tables: TableHands[] = [];
    for (const { account } of tableAccounts) {
      const d = account.data;
      if (d.length < NEEDED) continue;
      tables.push({
        tableId: d.readBigUInt64LE(TABLE_ID_AT).toString(),
        hands: Number(d.readBigUInt64LE(HAND_NUMBER_AT)),
      });
    }
    return { tables };
  } catch {
    // An RPC that is down must not be reported as an empty poker room.
    return null;
  }
}

/** base58, for the memcmp filter. Small enough not to warrant a dependency. */
function bs58(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}
