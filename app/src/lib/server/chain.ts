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

/** Byte offsets into a `Table` account. Mirrors decode.ts, which is the client's copy. */
const TABLE_ID_AT = 8;
// 8 discriminator + 8 table_id + 32 config + 6 x 32 seats + 1 button
const HAND_NUMBER_AT = 241;
// state(249) + bump(250) + empty_since(251..259), then rake_accrued.
const RAKE_AT = 259;
const NEEDED = RAKE_AT + 8;

/** Player: 8 discriminator + 32 authority, then chips. */
const PLAYER_CHIPS_AT = 40;

/**
 * The house's own `Player`. Rake lands in it and leaves through the same
 * `sell_chips` everyone uses, so its balance is rake that has been swept off
 * the tables and not yet cashed out. Matches `TREASURY_AUTHORITY` in the
 * program, which is the only account `sweep_rake` will credit.
 */
const TREASURY = new PublicKey("FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq");

/**
 * Pot per chip of rake.
 *
 * The program takes `RAKE_BPS` (250) of a flopped pot, so rake is
 * `floor(pot / 40)` and therefore `pot >= 40 * rake`. Inverting it gives a
 * FLOOR on the pot and never an estimate of it: rake is capped at three big
 * blinds, and a hand that never saw a flop is not raked at all, so both of
 * those push the true pot above this and neither pushes it below.
 */
const POT_PER_RAKE_CHIP = 10_000 / 250;

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
  return process.env.NEXT_PUBLIC_BASE_RPC || null;
}

export interface TableHands {
  tableId: string;
  hands: number;
}

export interface ChainRead {
  tables: TableHands[];
  /**
   * Every chip of rake the program has taken and still holds: unswept on the
   * tables, plus swept into the treasury and not yet cashed out.
   *
   * A floor, not a total. Rake the house has already sold back for USDC is
   * gone from here, which can only make the volume derived from it smaller.
   */
  rakeChips: number;
}

const PLAYER_DISCRIMINATOR = new Uint8Array(
  (idl.accounts as { name: string; discriminator: number[] }[]).find(
    (a) => a.name === "Player",
  )!.discriminator,
);

/**
 * Everything the base layer will say about how much poker has been played.
 *
 * Returns null when the chain cannot be reached, which the caller must treat
 * as "no news" rather than as "no tables" — the difference between the two is
 * a hand count that quietly resets to zero.
 */
export async function readChain(): Promise<ChainRead | null> {
  const url = rpc();
  if (!url) return null;
  try {
    const conn = new Connection(url, "confirmed");
    const [tableAccounts, treasury] = await Promise.all([
      conn.getProgramAccounts(PROGRAM, {
        commitment: "confirmed",
        // Only Table accounts, and only the prefix carrying the fields read
        // below. The lobby makes this same call unfiltered every few seconds;
        // no reason for the server to pull more than it uses.
        filters: [{ memcmp: { offset: 0, bytes: bs58(TABLE_DISCRIMINATOR) } }],
        dataSlice: { offset: 0, length: NEEDED },
      }),
      conn.getProgramAccounts(PROGRAM, {
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: 0, bytes: bs58(PLAYER_DISCRIMINATOR) } },
          { memcmp: { offset: 8, bytes: TREASURY.toBase58() } },
        ],
        dataSlice: { offset: 0, length: PLAYER_CHIPS_AT + 8 },
      }),
    ]);

    const tables: TableHands[] = [];
    let rakeChips = 0;
    for (const { account } of tableAccounts) {
      const d = account.data;
      if (d.length < NEEDED) continue;
      tables.push({
        tableId: d.readBigUInt64LE(TABLE_ID_AT).toString(),
        hands: Number(d.readBigUInt64LE(HAND_NUMBER_AT)),
      });
      rakeChips += Number(d.readBigUInt64LE(RAKE_AT));
    }
    for (const { account } of treasury) {
      const d = account.data;
      if (d.length >= PLAYER_CHIPS_AT + 8) {
        rakeChips += Number(d.readBigUInt64LE(PLAYER_CHIPS_AT));
      }
    }
    return { tables, rakeChips };
  } catch {
    // An RPC that is down must not be reported as an empty poker room.
    return null;
  }
}

/**
 * The least volume consistent with the rake the program actually took.
 *
 * Every raked chip implies at least forty chips of pot behind it. Hands that
 * folded before the flop, and pots small enough to be rake-free, contributed
 * volume this cannot see at all — so the true figure is above this and never
 * below it.
 */
export const volumeFloorChips = (rakeChips: number) =>
  Math.floor(rakeChips * POT_PER_RAKE_CHIP);

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
