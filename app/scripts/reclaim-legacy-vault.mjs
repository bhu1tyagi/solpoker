#!/usr/bin/env node
/**
 * Empty the pre-USDC SOL vault, once.
 *
 * Before the migration those lamports were what a chip was worth. Now the
 * chips are backed by the token account and the PDA's own balance backs
 * nothing — it does not even need to be rent-exempt to keep signing, because a
 * PDA signs by its seeds. So the leftover goes home rather than sitting at an
 * address nothing else can reach.
 *
 * House key only, and draining a system account to zero deletes it, so a
 * second run finds nothing and stops.
 *
 *   node scripts/reclaim-legacy-vault.mjs
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
import { sha256 } from "@noble/hashes/sha256";

const RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");

const conn = new Connection(RPC, "confirmed");
const authority = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);

const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], P);
const before = await conn.getBalance(vault);
const authBefore = await conn.getBalance(authority.publicKey);

console.log(`legacy vault ${vault.toBase58()}`);
console.log(`  holds ${(before / 1e9).toFixed(9)} SOL`);

if (before === 0) {
  console.log("  already empty — nothing to reclaim");
  process.exit(0);
}

const ix = new TransactionInstruction({
  programId: P,
  keys: [
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: authority.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(sha256("global:reclaim_legacy_vault")).subarray(0, 8),
});

const tx = new Transaction().add(ix);
const bh = await conn.getLatestBlockhash();
tx.feePayer = authority.publicKey;
tx.recentBlockhash = bh.blockhash;
tx.sign(authority);
const sig = await conn.sendRawTransaction(tx.serialize());
const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));

const after = await conn.getBalance(vault);
const authAfter = await conn.getBalance(authority.publicKey);
console.log(`  reclaimed ${(before / 1e9).toFixed(9)} SOL`);
console.log(`  vault now ${after} lamports ${after === 0 ? "(account deleted)" : ""}`);
console.log(`  authority ${(authBefore / 1e9).toFixed(6)} -> ${(authAfter / 1e9).toFixed(6)} SOL`);
console.log(`  ${sig}`);
