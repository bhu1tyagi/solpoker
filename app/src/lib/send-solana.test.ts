import { describe, expect, it } from "vitest";
import {
  ComputeBudgetProgram,
  Keypair,
  SystemProgram,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import { sendSolana } from "./net";

/**
 * The send that has to survive mainnet.
 *
 * These are the three behaviours the production failure of 2026-08-30 turned
 * out to need, checked against a stub rather than the chain: the transaction
 * bids for inclusion, it keeps being broadcast while nobody has accepted it,
 * and an expired blockhash is reported as a transaction that never happened
 * rather than as one whose fate is unknown.
 */

type Status = { confirmationStatus?: string; err?: unknown } | null;

/** Just enough Connection for the send path, with the levers a test needs. */
function stubConnection(opts: {
  /** Status returned on each poll, in order; the last repeats. */
  statuses: Status[];
  /** Block height returned on each check, in order; the last repeats. */
  heights?: number[];
  lastValidBlockHeight?: number;
  fees?: { slot: number; prioritizationFee: number }[];
}) {
  const sends: number[] = [];
  let poll = 0;
  let heightCall = 0;
  const conn = {
    getRecentPrioritizationFees: async () => opts.fees ?? [],
    getLatestBlockhash: async () => ({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: opts.lastValidBlockHeight ?? 1_000,
    }),
    sendRawTransaction: async () => {
      sends.push(Date.now());
      return "sig-under-test";
    },
    getSignatureStatus: async () => ({
      context: { slot: 1 },
      value: opts.statuses[Math.min(poll++, opts.statuses.length - 1)],
    }),
    getBlockHeight: async () => {
      const h = opts.heights ?? [0];
      return h[Math.min(heightCall++, h.length - 1)];
    },
  } as unknown as Connection;
  return { conn, sends: () => sends.length };
}

const payer = Keypair.generate();

function transfer() {
  return new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: payer.publicKey,
      lamports: 0,
    }),
  );
}

/** The compute-budget instructions the transaction ended up carrying. */
function budgetOf(tx: Transaction) {
  return tx.instructions
    .filter((ix) => ix.programId.equals(ComputeBudgetProgram.programId))
    .map((ix) => ix.data[0]);
}

describe("sendSolana", () => {
  it("bids for inclusion, ahead of the instruction it is paying for", async () => {
    const { conn } = stubConnection({ statuses: [{ confirmationStatus: "confirmed" }] });
    const tx = transfer();
    await sendSolana(conn, tx, { signers: [payer], feePayer: payer.publicKey, label: "test" });

    // A compute unit limit (2) and a price (3), in that order, before the
    // transfer. Zero-priority sends are what mainnet drops first.
    expect(budgetOf(tx)).toEqual([2, 3]);
    expect(tx.instructions[0].programId.equals(ComputeBudgetProgram.programId)).toBe(true);
    expect(tx.instructions[2].programId.equals(SystemProgram.programId)).toBe(true);
  });

  it("never bids below the floor, whatever the chain reports", async () => {
    const { conn } = stubConnection({
      statuses: [{ confirmationStatus: "confirmed" }],
      fees: [{ slot: 1, prioritizationFee: 0 }],
    });
    const tx = transfer();
    await sendSolana(conn, tx, { signers: [payer], feePayer: payer.publicKey, label: "test" });
    // Micro-lamports per unit, little-endian in the instruction's data.
    const price = tx.instructions.find(
      (ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3,
    )!;
    expect(Number(price.data.readBigUInt64LE(1))).toBeGreaterThanOrEqual(20_000);
  });

  it("keeps broadcasting while nobody has accepted it", async () => {
    const { conn, sends } = stubConnection({
      // Nothing for a while, then confirmed.
      statuses: [null, null, null, null, null, { confirmationStatus: "confirmed" }],
    });
    await sendSolana(conn, transfer(), {
      signers: [payer],
      feePayer: payer.publicKey,
      label: "test",
    });
    // One opening send plus at least one rebroadcast across ~3.5s of waiting.
    // The single send this replaced is the whole of the production bug.
    expect(sends()).toBeGreaterThan(1);
  });

  it(
    "calls an expired blockhash a transaction that never happened",
    async () => {
      const { conn } = stubConnection({
        statuses: [null],
        heights: [2_000],
        lastValidBlockHeight: 1_000,
      });
      await expect(
        sendSolana(conn, transfer(), {
          signers: [payer],
          feePayer: payer.publicKey,
          label: "delegate",
        }),
      ).rejects.toThrow(/blockhash expired[\s\S]*safe to retry/);
    },
    // The height is only asked for every few seconds — a confirmation
    // normally arrives long before it matters, and this is the slow path.
    15_000,
  );

  it("surfaces an on-chain failure as itself, not as a timeout", async () => {
    const { conn } = stubConnection({ statuses: [{ err: { Custom: 1 } }] });
    await expect(
      sendSolana(conn, transfer(), {
        signers: [payer],
        feePayer: payer.publicKey,
        label: "delegate",
      }),
    ).rejects.toThrow(/delegate failed.*Custom/);
  });

  it("counts a transaction that landed on the last valid block as landed", async () => {
    // The chain is already past this blockhash's last valid height AND the
    // transaction is confirmed. Reading the status before acting on expiry is
    // what keeps a real landing from being thrown away as a miss.
    const { conn } = stubConnection({
      statuses: [{ confirmationStatus: "confirmed" }],
      heights: [2_000],
      lastValidBlockHeight: 1_000,
    });
    await expect(
      sendSolana(conn, transfer(), {
        signers: [payer],
        feePayer: payer.publicKey,
        label: "delegate",
      }),
    ).resolves.toBe("sig-under-test");
  });
});
