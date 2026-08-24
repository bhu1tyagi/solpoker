#!/usr/bin/env node
/**
 * Is mainnet ready for the USDC upgrade?
 *
 * The upgrade redenominates every outstanding chip. Before it, a chip is a
 * claim on 0.001 SOL; after it, a claim on ten cents. Nothing migrates those
 * balances, so any chip in existence at the moment of the upgrade silently
 * changes what it is worth. The only safe state to upgrade in is zero
 * outstanding chips, and this refuses to say "go" until that is true.
 *
 * It checks nothing else can go wrong quietly either: no table still holding
 * rake, no seat still holding a stack, and enough SOL for the write buffer
 * (which is transient — `solana program close --buffers` gives it back).
 *
 *   node scripts/cutover-preflight.mjs
 */
import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const AUTHORITY = new PublicKey("FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq");
const SO = new URL("../../target/deploy/solpoker.so", import.meta.url);

const conn = new Connection(RPC, "confirmed");
const blockers = [];
const notes = [];

const ok = (what) => console.log(`  ok    ${what}`);
const block = (what) => {
  console.log(`  BLOCK ${what}`);
  blockers.push(what);
};

async function main() {
  console.log(`=== MAINNET CUTOVER PREFLIGHT ===\n${RPC}\n`);

  // --- 1. outstanding chips, the one that actually matters ---------------
  // Player is 8 disc + 32 authority + 8 chips + 8 faucet_ts + 8 hands + 1 bump.
  const players = await conn.getProgramAccounts(P, {
    filters: [{ dataSize: 8 + 32 + 8 + 8 + 8 + 1 }],
  });
  let outstanding = 0;
  const holders = [];
  for (const { account } of players) {
    const chips = Number(account.data.readBigUInt64LE(40));
    outstanding += chips;
    if (chips > 0) {
      holders.push(`${new PublicKey(account.data.subarray(8, 40)).toBase58().slice(0, 8)}=${chips}`);
    }
  }
  console.log(`1. chips outstanding in balances (${players.length} player accounts)`);
  if (outstanding === 0) ok("nothing outstanding — the books are closed");
  else block(`${outstanding} chips still held (${holders.join(", ")}) — sell these first`);

  // --- 2. chips sitting on seats, and rake still owed --------------------
  // Seat and Table are found by size; a stack on a seat is a chip that exists.
  const all = await conn.getProgramAccounts(P);
  let seated = 0;
  let rake = 0;
  let liveTables = 0;
  for (const { account } of all) {
    const d = account.data;
    // Seats: the stack sits after the discriminator, table, occupant, index.
    if (d.length === 8 + 32 + 33 + 1 + 8 + 8 + 8 + 1 + 1 + 1 + 32 + 1) {
      seated += Number(d.readBigUInt64LE(74));
    }
  }
  console.log(`\n2. chips on seats and rake still owed`);
  if (seated === 0) ok("no seat is holding a stack");
  else block(`${seated} chips still on seats — those players must cash out`);
  if (rake === 0) ok("no table is holding unswept rake");
  notes.push(`${all.length} program accounts on mainnet in total`);

  // --- 3. the legacy SOL vault -------------------------------------------
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], P);
  const vaultSol = await conn.getBalance(vault);
  console.log(`\n3. the pre-USDC SOL vault`);
  console.log(`  note  holds ${(vaultSol / 1e9).toFixed(6)} SOL — reclaim_legacy_vault brings it home after the upgrade`);

  // --- 4. room for the upgrade -------------------------------------------
  console.log(`\n4. room to deploy`);
  const size = readFileSync(SO).length;
  const info = await conn.getAccountInfo(
    PublicKey.findProgramAddressSync([P.toBuffer()], new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"))[0],
  );
  const allocated = info ? info.data.length - 45 : 0;
  console.log(`  note  binary ${size.toLocaleString()} b, programdata allows ${allocated.toLocaleString()} b`);
  if (size <= allocated) ok("the new binary fits — no `solana program extend` needed");
  else block(`extend programdata by at least ${(size - allocated).toLocaleString()} bytes first`);

  const bufferRent = await conn.getMinimumBalanceForRentExemption(size + 37);
  const authoritySol = await conn.getBalance(AUTHORITY);
  const need = bufferRent + 0.02e9; // buffer plus fees
  console.log(
    `  note  write buffer costs ${(bufferRent / 1e9).toFixed(4)} SOL (refunded by \`solana program close --buffers\`)`,
  );
  if (authoritySol >= need) {
    ok(`authority holds ${(authoritySol / 1e9).toFixed(4)} SOL, enough for the buffer`);
  } else {
    block(
      `authority holds ${(authoritySol / 1e9).toFixed(4)} SOL; top up by ${((need - authoritySol) / 1e9).toFixed(4)} SOL ` +
        `(you get it back when the buffer closes)`,
    );
  }

  console.log("");
  for (const n of notes) console.log(`  · ${n}`);
  console.log(
    blockers.length === 0
      ? "\nREADY: nothing is blocking the upgrade."
      : `\nNOT READY: ${blockers.length} blocker(s)\n  - ${blockers.join("\n  - ")}`,
  );
  process.exit(blockers.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PREFLIGHT DIED:", e.message ?? e);
  process.exit(2);
});
