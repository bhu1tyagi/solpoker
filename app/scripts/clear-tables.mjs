#!/usr/bin/env node
/**
 * Delete every table this wallet created.
 *
 * Seats are vacated first, which returns each player's chips to their own
 * balance, then the table and all its accounts are closed and the rent comes
 * back. Tables created by someone else are left alone, because only their
 * creator can delete them.
 *
 *   node scripts/clear-tables.mjs [--all-mine]
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const RPC = "https://rpc.magicblock.app/devnet";
const P = new PublicKey("4f8UE9BfWnAMLpYwpxJCNFD6HEmHwNQLtmQfhKW45tZ9");
const conn = new Connection(RPC, "confirmed");
const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);
const program = new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" }));
const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

const retry = async (fn, tries = 5) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
};

const send = async (ix, label) => {
  const tx = new Transaction().add(ix);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(kp);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) return `failed ${JSON.stringify(conf.value.err)}`;
    return null;
  } catch (e) {
    return String(e).slice(0, 120);
  }
};

const disc = bs58.encode(Buffer.from([34, 100, 138, 97, 236, 129, 230, 112]));
const accounts = await retry(() =>
  conn.getProgramAccounts(P, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }),
);
console.log(`${accounts.length} tables on the program`);

let closed = 0;
let skipped = 0;
for (const a of accounts) {
  const d = a.account.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const tableId = Number(dv.getBigUint64(8, true));
  const table = a.pubkey;
  const config = new PublicKey(d.subarray(16, 48));

  if (a.account.owner.toBase58() !== P.toBase58()) {
    console.log(`  ${tableId}: still delegated, skipping`);
    skipped++;
    continue;
  }
  const cfgInfo = await retry(() => conn.getAccountInfo(config));
  const creator =
    cfgInfo && cfgInfo.data.length >= 48 ? new PublicKey(cfgInfo.data.subarray(16, 48)) : null;
  const mine = creator && creator.equals(kp.publicKey);
  const emptySince = d.length >= 259
    ? Number(new DataView(d.buffer, d.byteOffset, d.byteLength).getBigInt64(251, true))
    : 0;
  let occupied = 0;
  for (let i = 0; i < 6; i++) {
    if (!d.subarray(48 + i * 32, 80 + i * 32).every((b) => b === 0)) occupied++;
  }
  // Someone else's table can still be swept once it is empty. The rent goes
  // back to its creator, so this only removes clutter.
  if (!mine && occupied > 0) {
    console.log(`  ${tableId}: someone else's and still occupied, leaving it`);
    skipped++;
    continue;
  }
  if (!creator) {
    console.log(`  ${tableId}: no readable creator, leaving it`);
    skipped++;
    continue;
  }

  // Vacate anyone still sitting, which hands their chips back.
  for (let i = 0; i < 6; i++) {
    const occ = d.subarray(48 + i * 32, 80 + i * 32);
    if (occ.every((b) => b === 0) || !mine) continue;
    const occupant = new PublicKey(occ);
    const err = await send(
      await program.methods.vacateSeat(i).accountsPartial({
        table,
        config,
        seat: pda(enc("seat"), table.toBuffer(), Buffer.from([i])),
        player: pda(enc("player"), occupant.toBuffer()),
        creator: kp.publicKey,
      }).instruction(),
      `vacate ${i}`,
    );
    if (err) console.log(`  ${tableId}: seat ${i} ${err}`);
  }

  const seats = Array.from({ length: 6 }, (_, i) =>
    pda(enc("seat"), table.toBuffer(), Buffer.from([i])));
  const holes = Array.from({ length: 6 }, (_, i) =>
    pda(enc("hole"), table.toBuffer(), Buffer.from([i])));
  const err = await send(
    await program.methods.closeTable().accountsPartial({
      table,
      config,
      hand: pda(enc("hand"), table.toBuffer()),
      deck: pda(enc("deck"), table.toBuffer()),
      history: pda(enc("history"), table.toBuffer()),
      payer: kp.publicKey,
      creator,
    }).remainingAccounts(
      [...seats, ...holes].map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })),
    ).instruction(),
    "close",
  );
  if (err) {
    console.log(`  ${tableId}: close ${err}`);
    skipped++;
  } else {
    console.log(`  ${tableId}: deleted`);
    closed++;
  }
}

console.log(`\n${closed} deleted, ${skipped} left`);
const after = await retry(() =>
  conn.getProgramAccounts(P, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }),
);
console.log(`${after.length} tables remain`);
