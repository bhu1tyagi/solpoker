#!/usr/bin/env node
/**
 * Put test dollars in a wallet, on devnet.
 *
 * The devnet mint is ours and the operator key is its mint authority, so this
 * prints what you need instead of queueing at a faucet. Devnet only, by
 * construction: the mint has no account on mainnet and never can.
 *
 *   node scripts/mint-test-usdc.mjs <wallet address> [dollars]
 *   node scripts/mint-test-usdc.mjs 9xQe...  250
 *
 * With no address it funds the operator's own wallet.
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const MINT = new PublicKey("CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq");

const conn = new Connection(RPC, "confirmed");
const authority = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);

const target = process.argv[2] ? new PublicKey(process.argv[2]) : authority.publicKey;
const dollars = Number(process.argv[3] ?? 500);

if (/mainnet/i.test(RPC)) {
  console.error("This mint only exists on devnet. Refusing to run against mainnet.");
  process.exit(1);
}

const ata = getAssociatedTokenAddressSync(MINT, target);
const ixs = [
  createAssociatedTokenAccountIdempotentInstruction(
    authority.publicKey,
    ata,
    target,
    MINT,
  ),
  createMintToInstruction(MINT, ata, authority.publicKey, Math.round(dollars * 1e6)),
];

// Dollars buy chips; SOL pays the network. A wallet with one and not the other
// can do exactly nothing, so top up both in one go rather than leaving someone
// to discover the second half at the signing prompt.
const GAS_TARGET = 0.3e9;
const gasHeld = await conn.getBalance(target);
if (gasHeld < GAS_TARGET && !target.equals(authority.publicKey)) {
  ixs.unshift(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: target,
      lamports: GAS_TARGET - gasHeld,
    }),
  );
  console.log(`  topping up gas to ${(GAS_TARGET / 1e9).toFixed(2)} SOL (had ${(gasHeld / 1e9).toFixed(4)})`);
}

const tx = new Transaction().add(...ixs);

const bh = await conn.getLatestBlockhash();
tx.feePayer = authority.publicKey;
tx.recentBlockhash = bh.blockhash;
tx.sign(authority);
const sig = await conn.sendRawTransaction(tx.serialize());
await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");

const info = await conn.getAccountInfo(ata);
const held = info ? Number(info.data.readBigUInt64LE(64)) / 1e6 : 0;
console.log(`minted $${dollars.toFixed(2)} test USDC to ${target.toBase58()}`);
console.log(`  token account ${ata.toBase58()}`);
console.log(`  now holds     $${held.toFixed(2)}  (${(held / 0.1).toLocaleString()} chips' worth)`);
console.log(`  ${sig}`);
