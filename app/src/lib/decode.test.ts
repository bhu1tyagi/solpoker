import { describe, it, expect } from "vitest";
import { decodeConfig, decodeHand, decodeSeat, decodeTable, decodeHole } from "./decode";

/**
 * Older builds of the program left accounts on devnet that are genuinely
 * shorter than today's layout. One of them throwing inside the lobby listing
 * emptied the whole lobby, which looks exactly like having no tables. Short
 * data must read as zeros, never as an exception.
 */
describe("decoding truncated accounts", () => {
  it("reads a short TableConfig without throwing", () => {
    // 82 bytes: the real length of configs created before action_timeout_secs.
    const short = new Uint8Array(82);
    const view = new DataView(short.buffer);
    view.setBigUint64(8, 1234n, true);
    view.setBigUint64(48, 5n, true);
    view.setBigUint64(56, 10n, true);

    const cfg = decodeConfig(short);
    expect(cfg.tableId).toBe(1234);
    expect(cfg.smallBlind).toBe(5);
    expect(cfg.bigBlind).toBe(10);
    // The field that does not exist reads as zero.
    expect(cfg.actionTimeoutSecs).toBe(0);
  });

  it("survives an empty account", () => {
    const empty = new Uint8Array(0);
    expect(() => decodeConfig(empty)).not.toThrow();
    expect(() => decodeTable(empty, "x")).not.toThrow();
    expect(() => decodeSeat(empty)).not.toThrow();
    expect(() => decodeHand(empty)).not.toThrow();
    expect(() => decodeHole(empty)).not.toThrow();
  });

  it("reports an empty seat map for a truncated table", () => {
    const t = decodeTable(new Uint8Array(60), "addr");
    expect(t.seats.filter(Boolean).length).toBe(0);
    expect(t.button).toBe(0);
    expect(t.address).toBe("addr");
  });

  it("decodes a full-length account normally", () => {
    const full = new Uint8Array(90);
    const view = new DataView(full.buffer);
    view.setBigUint64(8, 777n, true);
    view.setBigUint64(48, 25n, true);
    view.setBigUint64(56, 50n, true);
    view.setBigUint64(64, 1000n, true);
    view.setBigUint64(72, 10_000n, true);
    view.setBigInt64(81, 30n, true);

    const cfg = decodeConfig(full);
    expect(cfg).toEqual({
      tableId: 777,
      // Bytes 16..48, left as zeroes here, which is the system program's
      // address. The decoder started reading this field when house tables
      // needed telling apart from a player's own, and this expectation was
      // never brought along.
      creator: "11111111111111111111111111111111",
      smallBlind: 25,
      bigBlind: 50,
      minBuyIn: 1000,
      maxBuyIn: 10_000,
      actionTimeoutSecs: 30,
    });
  });
});
