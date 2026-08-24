#!/usr/bin/env node
/**
 * Where is every mainnet lamport, and which of them can come home?
 *
 * Read-only. It finds the money and sorts it into three piles — already home,
 * recoverable now, and stuck (with the reason) — because "recover everything"
 * is only a safe instruction once you can see what everything is. One of the
 * piles here is the program's own rent, and reclaiming that means deleting the
 * deployment, which is not a sweep, it is a shutdown.
 *
 *   node scripts/mainnet-audit.mjs
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const SESSION_PROGRAM = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const conn = new Connection(RPC, "confirmed");
const authority = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);

const sol = (l) => `${(l / 1e9).toFixed(6)} SOL`;
const home = [];
const recoverable = [];
const stuck = [];

async function main() {
  console.log(`=== MAINNET LAMPORT AUDIT ===\n${RPC}\n`);

  // --- 1. the authority itself -------------------------------------------
  const authBal = await conn.getBalance(authority.publicKey);
  home.push([`authority ${authority.publicKey.toBase58().slice(0, 8)}`, authBal]);

  // --- 2. the program and its data account -------------------------------
  const [programData] = PublicKey.findProgramAddressSync([P.toBuffer()], LOADER);
  const pdInfo = await conn.getAccountInfo(programData);
  const progInfo = await conn.getAccountInfo(P);
  if (pdInfo) {
    stuck.push([
      "program data account (the deployment itself)",
      pdInfo.lamports,
      "only refunded by `solana program close`, which DELETES pokerable.fun",
    ]);
  }
  if (progInfo) {
    stuck.push([
      "program account header",
      progInfo.lamports,
      "same — it is the deployment",
    ]);
  }

  // --- 3. leftover write buffers -----------------------------------------
  // These are pure waste when they exist: an interrupted deploy leaves one
  // holding the full rent of a binary nobody is running.
  //
  // Filtered server-side on the authority, not fetched and sifted here: the
  // upgradeable loader owns every program on Solana, and asking for all of
  // them returns gigabytes and kills the process.
  const buffers = await conn.getProgramAccounts(LOADER, {
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: 0, bytes: "2" } }, // buffer discriminant, base58 of [1,0,0,0]
      { memcmp: { offset: 5, bytes: authority.publicKey.toBase58() } },
    ],
  });
  for (const { pubkey, account } of buffers) {
    recoverable.push([
      `orphaned write buffer ${pubkey.toBase58().slice(0, 8)}`,
      account.lamports,
      "solana program close --buffers",
    ]);
  }
  if (buffers.length === 0) console.log("no orphaned deploy buffers\n");

  // --- 4. everything the poker program owns ------------------------------
  const owned = await conn.getProgramAccounts(P);
  const PLAYER_SIZE = 8 + 32 + 8 + 8 + 8 + 1;
  let playerRent = 0;
  let otherRent = 0;
  const others = [];
  for (const { pubkey, account } of owned) {
    if (account.data.length === PLAYER_SIZE) {
      playerRent += account.lamports;
    } else {
      otherRent += account.lamports;
      others.push([pubkey.toBase58().slice(0, 8), account.data.length, account.lamports]);
    }
  }
  if (playerRent > 0) {
    stuck.push([
      `${owned.filter((o) => o.account.data.length === PLAYER_SIZE).length} Player accounts`,
      playerRent,
      "the program has no close instruction for Player — known, on the record",
    ]);
  }
  for (const [addr, len, lam] of others) {
    recoverable.push([
      `program account ${addr} (${len} b — table furniture)`,
      lam,
      "close_table refunds this to the table creator",
    ]);
  }

  // --- 5. the chip vault -------------------------------------------------
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], P);
  const vaultBal = await conn.getBalance(vault);
  if (vaultBal > 0) {
    recoverable.push([
      "legacy SOL vault",
      vaultBal,
      "reclaim_legacy_vault — needs the USDC upgrade deployed first",
    ]);
  }

  // --- 6. session tokens still holding rent ------------------------------
  const tokens = await conn.getProgramAccounts(SESSION_PROGRAM);
  let mine = 0;
  let mineLamports = 0;
  for (const { account } of tokens) {
    if (account.data.length < 136) continue;
    const feePayer = new PublicKey(account.data.subarray(104, 136));
    if (!feePayer.equals(authority.publicKey)) continue;
    mine += 1;
    mineLamports += account.lamports;
  }
  if (mine > 0) {
    recoverable.push([
      `${mine} session tokens with you as fee payer`,
      mineLamports,
      "revoke_session_v2 — repatriate.mjs already does this",
    ]);
  }

  // --- 7. the old test wallets, if anything crept back -------------------
  try {
    const gates = JSON.parse(readFileSync("/tmp/solpoker-gate/gate-wallets.json", "utf8"));
    for (const secret of gates) {
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      const bal = await conn.getBalance(kp.publicKey);
      if (bal > 0) {
        recoverable.push([
          `test wallet ${kp.publicKey.toBase58().slice(0, 8)}`,
          bal,
          "drain to the authority",
        ]);
      }
    }
  } catch {
    // No saved wallets is a fine state.
  }

  // --- report -------------------------------------------------------------
  const sum = (rows) => rows.reduce((a, r) => a + r[1], 0);
  console.log("ALREADY HOME");
  for (const [what, lam] of home) console.log(`  ${sol(lam).padStart(14)}  ${what}`);

  console.log("\nRECOVERABLE");
  if (recoverable.length === 0) console.log("  nothing — every loose lamport is already home");
  for (const [what, lam, how] of recoverable) {
    console.log(`  ${sol(lam).padStart(14)}  ${what}\n                  -> ${how}`);
  }

  console.log("\nSTUCK");
  for (const [what, lam, why] of stuck) {
    console.log(`  ${sol(lam).padStart(14)}  ${what}\n                  -> ${why}`);
  }

  console.log(
    `\nTOTAL under your control: ${sol(sum(home) + sum(recoverable) + sum(stuck))}` +
      `\n  in hand now:           ${sol(sum(home))}` +
      `\n  sweepable:             ${sol(sum(recoverable))}` +
      `\n  locked in the program: ${sol(sum(stuck))}`,
  );
}

main().catch((e) => {
  console.error("AUDIT DIED:", e.message ?? e);
  process.exit(1);
});
