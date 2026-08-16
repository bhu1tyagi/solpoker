/**
 * Decoder check against real devnet accounts.
 *
 * The offsets in decode.ts are hand-written from state.rs, so this reads live
 * accounts and asserts the numbers come out sane. Excluded from the default
 * test run because it needs the network. Run it with:
 *
 *   npx vitest run --config vitest.devnet.config.ts
 *
 * It used to name one table by id, which made it a fixture that any cleanup
 * could delete out from under it, and it duly broke the first time the tables
 * were swept. Now it discovers whatever tables exist and checks the decoders
 * against those, so it tests the code rather than the state of the chain.
 */

import { describe, it, expect } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import { decodeConfig, decodeHand, decodeSeat, decodeTable } from "./decode";
import { configPda, handPda, seatPda } from "./pdas";
import { BASE_RPC, MAX_SEATS, PROGRAM_ID } from "./constants";

/** Anchor account discriminator for Table, from the IDL. */
const TABLE_DISCRIMINATOR = Uint8Array.from([34, 100, 138, 97, 236, 129, 230, 112]);

describe("decoders against devnet", () => {
  it("reads whatever tables are live and decodes them sanely", async () => {
    const conn = new Connection(BASE_RPC, "confirmed");

    const accounts = await conn.getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: bs58.encode(TABLE_DISCRIMINATOR) } }],
    });
    // Only tables of the current size can be decoded; older layouts are a
    // different shape and the lobby hides them for the same reason.
    const current = accounts.filter((a) => a.account.data.length >= 259);
    expect(current.length).toBeGreaterThan(0);

    let checked = 0;
    for (const account of current.slice(0, 3)) {
      const table = account.pubkey;
      const t = decodeTable(new Uint8Array(account.account.data), table.toBase58());

      // The id must round-trip back to the address it was found at.
      const idBytes = new Uint8Array(8);
      new DataView(idBytes.buffer).setBigUint64(0, BigInt(t.tableId), true);
      const [derived] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("table"), idBytes],
        PROGRAM_ID,
      );
      expect(derived.toBase58()).toBe(table.toBase58());

      expect(t.seats).toHaveLength(MAX_SEATS);
      expect(t.button).toBeLessThan(MAX_SEATS);
      expect([0, 1]).toContain(t.state);

      const [cInfo, hInfo] = await conn.getMultipleAccountsInfo([
        configPda(new BN(t.tableId)),
        handPda(table),
      ]);

      if (cInfo) {
        const c = decodeConfig(new Uint8Array(cInfo.data));
        expect(c.bigBlind).toBeGreaterThan(0);
        expect(c.bigBlind).toBeGreaterThanOrEqual(c.smallBlind);
        expect(c.maxBuyIn).toBeGreaterThanOrEqual(c.minBuyIn);
        expect(c.actionTimeoutSecs).toBeGreaterThan(0);
      }

      if (hInfo) {
        const h = decodeHand(new Uint8Array(hInfo.data));
        expect(h.board).toHaveLength(5);
        expect(h.shuffleSeed).toHaveLength(64);
        expect(h.resultHash).toHaveLength(64);
        expect(h.street).toBeLessThanOrEqual(4);
      }

      // Seats: every one that exists must know its own index, and any chips on
      // it must be a sane number rather than a misread of neighbouring bytes.
      for (let i = 0; i < MAX_SEATS; i++) {
        const info = await conn.getAccountInfo(seatPda(table, i));
        if (!info) continue;
        const s = decodeSeat(new Uint8Array(info.data));
        expect(s.index).toBe(i);
        expect(s.stack).toBeGreaterThanOrEqual(0);
        expect(s.stack).toBeLessThan(1e12);
      }

      checked++;
    }

    expect(checked).toBeGreaterThan(0);
  }, 120_000);
});
