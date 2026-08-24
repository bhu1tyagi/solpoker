/**
 * Bring every lamport home.
 *
 * Sells any chips the test wallets still hold, sweeps the last saved session
 * signers, revokes every session token the test wallets ever minted (rent
 * returns to whoever paid it), then drains both test wallets to exactly zero
 * — which deletes them — with everything landing at the authority.
 */
import { readFileSync, existsSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { sha256 } from "@noble/hashes/sha256";
import bs58pkg from "bs58";
const bs58 = bs58pkg.default ?? bs58pkg;

const RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const SESSION_PROGRAM = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const USDC_MINT = new PublicKey(
  /devnet/i.test(process.env.RPC ?? "")
    ? "CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq"
    : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
const idl = JSON.parse(readFileSync("src/lib/idl/solpoker.json", "utf8"));
const enc = (s) => new TextEncoder().encode(s);
const pda = (...s) => PublicKey.findProgramAddressSync(s, P)[0];
const D = (n) => Buffer.from(idl.instructions.find((i) => i.name === n).discriminator);
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const log = (...a) => console.log(...a);

const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8"))));
const gates = JSON.parse(readFileSync("/tmp/solpoker-gate/gate-wallets.json", "utf8")).map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
const conn = new Connection(RPC, "confirmed");

async function send(ixs, signers, label, payer = signers[0]) {
  const tx = new Transaction().add(...ixs);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`${label}: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

const startAuthority = await conn.getBalance(authority.publicKey);
let recovered = 0;

// ---- 1. chips back to USDC ----
// The account list mirrors `SellChips` field for field; Anchor matches by
// position, so a stale order here fails on the wrong constraint and reads like
// a seeds bug rather than a missing account.
const [vault] = PublicKey.findProgramAddressSync([enc("vault")], P);
const vaultAta = getAssociatedTokenAddressSync(USDC_MINT, vault, true);
for (const g of gates) {
  const player = pda(enc("player"), g.publicKey.toBuffer());
  const info = await conn.getAccountInfo(player);
  const chips = info ? info.data.readBigUInt64LE(40) : 0n;
  if (chips > 0n) {
    await send([new TransactionInstruction({ programId: P, keys: [
      { pubkey: player, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: getAssociatedTokenAddressSync(USDC_MINT, g.publicKey), isSigner: false, isWritable: true },
      { pubkey: g.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: Buffer.concat([D("sell_chips"), u64(chips)]) })], [g], "sell");
    log(`sold ${chips} chips for ${g.publicKey.toBase58().slice(0, 6)}`);
  }
}

// ---- 1b. the USDC those sales produced, and the account holding it ----
// Draining a wallet's lamports to zero leaves its token account behind with
// its own rent still in it, which is exactly the kind of quiet residue this
// script exists to stop.
for (const g of gates) {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, g.publicKey);
  const info = await conn.getAccountInfo(ata);
  if (!info) continue;
  const held = info.data.readBigUInt64LE(64);
  const ixs = [];
  if (held > 0n) {
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        g.publicKey,
        getAssociatedTokenAddressSync(USDC_MINT, authority.publicKey),
        authority.publicKey,
        USDC_MINT,
      ),
      createTransferCheckedInstruction(
        ata,
        USDC_MINT,
        getAssociatedTokenAddressSync(USDC_MINT, authority.publicKey),
        g.publicKey,
        held,
        6,
      ),
    );
  }
  ixs.push(createCloseAccountInstruction(ata, authority.publicKey, g.publicKey));
  await send(ixs, [g], "usdc sweep");
  log(`swept $${(Number(held) / 1e6).toFixed(2)} and closed the token account for ${g.publicKey.toBase58().slice(0, 6)}`);
}

// ---- 2. last saved session signers ----
if (existsSync("/tmp/solpoker-gate/session-keys.json")) {
  const sk = JSON.parse(readFileSync("/tmp/solpoker-gate/session-keys.json", "utf8"));
  for (const [k, v] of Object.entries(sk)) {
    if (!k.includes(":mainnet:")) continue;
    try {
      const kp = Keypair.fromSecretKey(bs58.decode(JSON.parse(v).secret));
      const bal = await conn.getBalance(kp.publicKey);
      if (bal > 5000) {
        await send([SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: authority.publicKey, lamports: bal - 5000 })], [kp], "session sweep");
        recovered += bal - 5000;
        log(`session signer swept ${((bal - 5000) / 1e9).toFixed(4)} SOL`);
      }
    } catch (e) { log("session sweep skip:", String(e).slice(0, 60)); }
  }
}

// ---- 3. revoke every session token owned by our wallets ----
const revokeDisc = Buffer.from(sha256(enc("global:revoke_session_v2"))).subarray(0, 8);
const tokens = await conn.getProgramAccounts(SESSION_PROGRAM);
const ours = new Set([...gates.map((g) => g.publicKey.toBase58()), authority.publicKey.toBase58()]);
let revoked = 0;
for (const t of tokens) {
  const d = t.account.data;
  if (d.length < 144) continue;
  const auth = new PublicKey(d.subarray(8, 40)).toBase58();
  const target = new PublicKey(d.subarray(40, 72)).toBase58();
  if (target !== P.toBase58() || !ours.has(auth)) continue;
  const feePayer = new PublicKey(d.subarray(104, 136));
  const signer = gates.find((g) => g.publicKey.toBase58() === auth) ?? authority;
  try {
    await send([new TransactionInstruction({ programId: SESSION_PROGRAM, keys: [
      { pubkey: t.pubkey, isSigner: false, isWritable: true },
      { pubkey: feePayer, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: revokeDisc })], [signer], "revoke");
    revoked++;
  } catch (e) { log(`revoke skip ${t.pubkey.toBase58().slice(0, 6)}:`, String(e).slice(0, 80)); }
}
log(`revoked ${revoked} session token(s); rents returned to their payers`);

// ---- 4. drain the test wallets to exactly zero, which deletes them ----
for (const g of gates) {
  const bal = await conn.getBalance(g.publicKey);
  if (bal > 5000) {
    await send([SystemProgram.transfer({ fromPubkey: g.publicKey, toPubkey: authority.publicKey, lamports: bal - 5000 })], [g], "drain");
    log(`drained ${(bal / 1e9).toFixed(4)} SOL from ${g.publicKey.toBase58().slice(0, 6)} (account now empty = deleted)`);
  } else if (bal > 0) {
    log(`${g.publicKey.toBase58().slice(0, 6)} holds dust ${bal} lamports (below fee)`);
  }
}

const endAuthority = await conn.getBalance(authority.publicKey);
log(`authority: ${(startAuthority / 1e9).toFixed(4)} -> ${(endAuthority / 1e9).toFixed(4)} SOL (+${((endAuthority - startAuthority) / 1e9).toFixed(4)})`);
for (const g of gates) log(`${g.publicKey.toBase58().slice(0, 6)} final:`, await conn.getBalance(g.publicKey), "lamports");
