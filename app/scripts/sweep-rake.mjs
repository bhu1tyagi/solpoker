#!/usr/bin/env node
/**
 * Move accrued rake from tables into the treasury balance.
 *
 * Rake is taken at settlement, which happens on the rollup — where a base-layer
 * `Player` account cannot be written. So it waits on the table in
 * `rake_accrued` until the table is back on Solana, and this moves it the rest
 * of the way. That is why the house's chips do not appear the moment a hand
 * ends: they are real and accounted for, just not yet in a balance.
 *
 * Permissionless by design. The destination is fixed in the program — the only
 * account `sweep_rake` will credit is the treasury's — so there is nothing for
 * a caller to gain, and anyone tidying a table can do it.
 *
 *   node scripts/sweep-rake.mjs
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";

const RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const TREASURY = new PublicKey("FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq");

// Table layout up to rake_accrued: disc, id, config, 6 seats, button, hand,
// state, bump, empty_since.
const RAKE_OFF = 8 + 8 + 32 + 6 * 32 + 1 + 8 + 1 + 1 + 8;

const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];

const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);

const treasuryPda = pda(enc("player"), TREASURY.toBuffer());
const chipsOf = async (who) => {
  const i = await conn.getAccountInfo(who);
  return i ? Number(i.data.readBigUInt64LE(40)) : 0;
};

const before = await chipsOf(treasuryPda);
console.log(`treasury holds ${before} chips ($${(before / 100).toFixed(2)}) before\n`);

const all = await conn.getProgramAccounts(P);
let swept = 0;

for (const { pubkey, account } of all) {
  if (account.data.length < RAKE_OFF + 8) continue;
  const rake = Number(account.data.readBigUInt64LE(RAKE_OFF));
  if (rake === 0) continue;

  const tableId = account.data.readBigUInt64LE(8);
  console.log(`table ${pubkey.toBase58().slice(0, 12)} (id ${tableId}) holds ${rake} chips`);

  const ix = new TransactionInstruction({
    programId: P,
    keys: [
      { pubkey, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(sha256("global:sweep_rake")).subarray(0, 8),
  });

  try {
    const tx = new Transaction().add(ix);
    const bh = await conn.getLatestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.sign(payer);
    const sig = await conn.sendRawTransaction(tx.serialize());
    const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));
    swept += rake;
    console.log(`  swept ${rake} chips  ${sig}`);
  } catch (e) {
    // A delegated table cannot be swept: its base-layer account is owned by the
    // delegation program, so `Account<Table>` refuses it outright. Pause the
    // table and run this again.
    console.log(`  could not sweep: ${String(e.message ?? e).slice(0, 110)}`);
  }
}

const after = await chipsOf(treasuryPda);
console.log(
  swept === 0
    ? "\nNo rake was available to sweep."
    : `\nswept ${swept} chips ($${(swept / 100).toFixed(2)}) — treasury ${before} -> ${after}`,
);
console.log("Cash out from the lobby with the treasury wallet to turn these into USDC.");
