#!/usr/bin/env node
/**
 * The first real money through the new program, spent deliberately.
 *
 * Buys ten chips for a dollar and sells them straight back, asserting the
 * amounts to the penny in both directions. It is the operator's own dollar, so
 * if the rate is wrong or an account is misrouted, the person who finds out is
 * the person who shipped it.
 *
 * The buy also creates the vault's token account and pays its rent, which is
 * why the house does this first: otherwise the cost lands on whichever player
 * happens to deposit first.
 *
 *   node scripts/mainnet-smoke.mjs
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";

const RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const USDC = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MICRO_USDC_PER_CHIP = 100_000;
const CHIPS = 10;
const COST = CHIPS * MICRO_USDC_PER_CHIP;

const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
const D = (n) => Buffer.from(sha256(`global:${n}`)).subarray(0, 8);
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

const conn = new Connection(RPC, "confirmed");
const me = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);

const VAULT = pda(enc("vault"));
const vaultAta = getAssociatedTokenAddressSync(USDC, VAULT, true);
const myAta = getAssociatedTokenAddressSync(USDC, me.publicKey);
const playerPda = pda(enc("player"), me.publicKey.toBuffer());

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

async function send(ixs, label) {
  const tx = new Transaction().add(...ixs);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = me.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(me);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`${label}: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

const amount = async (ata) => {
  const i = await conn.getAccountInfo(ata);
  return i ? Number(i.data.readBigUInt64LE(64)) : 0;
};
const chipsOf = async () => {
  const i = await conn.getAccountInfo(playerPda);
  return i ? Number(i.data.readBigUInt64LE(40)) : 0;
};

const trade = (kind) =>
  new TransactionInstruction({
    programId: P,
    keys: [
      { pubkey: playerPda, isSigner: false, isWritable: true },
      { pubkey: VAULT, isSigner: false, isWritable: false },
      { pubkey: USDC, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: myAta, isSigner: false, isWritable: true },
      { pubkey: me.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([D(kind === "buy" ? "buy_chips" : "sell_chips"), u64(CHIPS)]),
  });

async function main() {
  console.log(`=== MAINNET SMOKE — real USDC ===`);
  console.log(`vault token account ${vaultAta.toBase58()}\n`);

  const walletBefore = await amount(myAta);
  const vaultBefore = await amount(vaultAta);
  const chipsBefore = await chipsOf();
  const vaultExisted = (await conn.getAccountInfo(vaultAta)) !== null;
  console.log(
    `wallet $${(walletBefore / 1e6).toFixed(6)} · vault $${(vaultBefore / 1e6).toFixed(6)} · chips ${chipsBefore}`,
  );
  console.log(`vault token account exists already: ${vaultExisted}\n`);

  if (walletBefore < COST) {
    console.error(`Need at least $${COST / 1e6} in the wallet. Aborting.`);
    process.exit(1);
  }

  const ixs = [];
  if (!(await conn.getAccountInfo(playerPda))) {
    ixs.push(
      new TransactionInstruction({
        programId: P,
        keys: [
          { pubkey: playerPda, isSigner: false, isWritable: true },
          { pubkey: me.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: D("init_player"),
      }),
    );
  }

  console.log(`1. buy ${CHIPS} chips for $${COST / 1e6}`);
  const sig1 = await send([...ixs, trade("buy")], "buy");
  const walletMid = await amount(myAta);
  const vaultMid = await amount(vaultAta);
  check(walletBefore - walletMid === COST, `wallet paid exactly $${COST / 1e6}`);
  check(vaultMid - vaultBefore === COST, `vault received exactly $${COST / 1e6}`);
  check((await chipsOf()) === chipsBefore + CHIPS, `ledger credited ${CHIPS} chips`);
  console.log(`  ${sig1}`);

  console.log(`\n2. sell them straight back`);
  const sig2 = await send([trade("sell")], "sell");
  const walletAfter = await amount(myAta);
  const vaultAfter = await amount(vaultAta);
  check(walletAfter - walletMid === COST, `wallet was repaid exactly $${COST / 1e6}`);
  check(walletAfter === walletBefore, "the wallet is exactly where it started");
  check(vaultAfter === vaultBefore, "the vault is exactly where it started");
  check((await chipsOf()) === chipsBefore, "the ledger is exactly where it started");
  console.log(`  ${sig2}`);

  console.log(
    failures.length === 0
      ? `\nSMOKE PASSED — real USDC moved and returned to the penny.`
      : `\nSMOKE FAILED: ${failures.length}\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("SMOKE DIED:", e.message ?? e);
  process.exit(1);
});
