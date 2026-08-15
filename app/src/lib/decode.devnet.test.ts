/**
 * Decoder check against real devnet accounts.
 *
 * The offsets in decode.ts are hand-written from state.rs, so this reads a table
 * that actually played hands and asserts the numbers come out sane. Excluded
 * from the default test run because it needs the network. Run it with:
 *
 *   npx vitest run --config vitest.devnet.config.ts
 */

import { describe, it, expect } from "vitest";
import { Connection } from "@solana/web3.js";
import BN from "bn.js";
import { decodeConfig, decodeHand, decodeSeat, decodeTable } from "./decode";
import { configPda, handPda, seatPda, tablePda } from "./pdas";
import { BASE_RPC, MAX_SEATS } from "./constants";

// The table from the three-hand session run: six seats, 2000 chips each.
const TABLE_ID = new BN(1786784760);
const EXPECTED_TOTAL = 12_000;

describe("decoders against devnet", () => {
  it("reads a real table, config, hand and seats", async () => {
    const conn = new Connection(BASE_RPC, "confirmed");
    const table = tablePda(TABLE_ID);

    const [tInfo, cInfo, hInfo] = await conn.getMultipleAccountsInfo([
      table,
      configPda(TABLE_ID),
      handPda(table),
    ]);

    const t = decodeTable(new Uint8Array(tInfo!.data), table.toBase58());
    expect(t.tableId).toBe(TABLE_ID.toNumber());
    expect(t.seats.filter(Boolean).length).toBe(6);
    expect(t.button).toBeLessThan(MAX_SEATS);
    expect(t.state).toBe(0);
    expect(t.handNumber).toBe(3);

    const c = decodeConfig(new Uint8Array(cInfo!.data));
    expect(c.smallBlind).toBe(5);
    expect(c.bigBlind).toBe(10);
    expect(c.minBuyIn).toBe(200);
    expect(c.actionTimeoutSecs).toBeGreaterThan(0);

    const h = decodeHand(new Uint8Array(hInfo!.data));
    expect(h.handNumber).toBe(3);
    expect(h.street).toBe(4);
    expect(h.board).toHaveLength(5);
    expect(h.shuffleSeed).toHaveLength(64);
    expect(h.resultHash).toHaveLength(64);

    let total = 0;
    for (let i = 0; i < MAX_SEATS; i++) {
      const info = await conn.getAccountInfo(seatPda(table, i));
      const s = decodeSeat(new Uint8Array(info!.data));
      expect(s.index).toBe(i);
      expect(s.occupant).not.toBeNull();
      total += s.stack;
    }
    expect(total).toBe(EXPECTED_TOTAL);
  }, 90_000);
});
