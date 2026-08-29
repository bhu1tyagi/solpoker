#!/usr/bin/env node
/**
 * Bring a half-delegated table back to Solana.
 *
 * A start that delegated the core but not the seats leaves the table, hand and
 * deck on the rollup with every seat still on the base layer. Nothing can drive
 * a hand across that gap, so the room looks live and deals nobody in. The fix
 * is to pull the core back: with the seats never having left, undelegating the
 * core alone restores the table whole.
 *
 *   node scripts/recover-table.mjs --table <id> [--dry]
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import anchor from "@coral-xyz/anchor";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const { Program, AnchorProvider, Wallet } = anchor.default ?? anchor;
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i+1] : null; };
const TABLE_ID = arg("table");
const DRY = args.includes("--dry");
if (!TABLE_ID) { console.error("--table <id> required"); process.exit(1); }

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const RPC = env.match(/^BASE_RPC=(.+)$/m)[1].trim();
const TEE = "https://mainnet-tee.magicblock.app";

const base = new Connection(RPC, { commitment: "confirmed",
  fetch: (u,i) => fetch(u, { ...i, headers: { ...i?.headers, Origin: "https://pokerable.fun" } }) });
const PROGRAM_ID = new PublicKey(idl.address);
const DEL = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const enc = (s) => new TextEncoder().encode(s);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

const kp = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))));

const idBuf = Buffer.alloc(8); idBuf.writeBigUInt64LE(BigInt(TABLE_ID));
const table = pda([enc("table"), idBuf]);

const owner = async (k) => { const i = await base.getAccountInfo(k); return !i ? "missing" : i.owner.equals(DEL) ? "rollup" : i.owner.equals(PROGRAM_ID) ? "base" : "other"; };

console.log(`table ${TABLE_ID}  ${table.toBase58()}`);
console.log(`  table=${await owner(table)} hand=${await owner(pda([enc("hand"), table.toBytes()]))} deck=${await owner(pda([enc("deck"), table.toBytes()]))}`);
const seatOwners = [];
for (let i = 0; i < 6; i++) seatOwners.push(await owner(pda([enc("seat"), table.toBytes(), Uint8Array.from([i])])));
console.log(`  seats: ${seatOwners.join(" ")}`);

if ((await owner(table)) !== "rollup") { console.log("\nTable is not delegated. Nothing to recover."); process.exit(0); }
const stragglers = seatOwners.filter((o) => o === "rollup").length;
console.log(`\n  seats still on the rollup: ${stragglers}`);
if (DRY) { console.log("--dry, stopping here."); process.exit(0); }

async function teeConn() {
  const res = await fetch(`${TEE}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`);
  const { challenge } = await res.json();
  const sig = nacl.sign.detached(enc(challenge), kp.secretKey);
  const login = await fetch(`${TEE}/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge, signature: bs58.encode(sig) }),
  });
  const { token } = await login.json();
  return new Connection(`${TEE}?token=${token}`, { commitment: "confirmed" });
}

const er = await teeConn();
const program = new Program(idl, new AnchorProvider(er, new Wallet(kp), { commitment: "confirmed" }));

const send = async (ix, label) => {
  const tx = new Transaction().add(ix);
  const bh = await er.getLatestBlockhash();
  tx.feePayer = kp.publicKey; tx.recentBlockhash = bh.blockhash; tx.sign(kp);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 40; i++) {
    const st = await er.getSignatureStatus(sig);
    if (st.value?.confirmationStatus) { if (st.value.err) throw new Error(`${label}: ${JSON.stringify(st.value.err)}`); console.log(`  ${label} ok  ${sig.slice(0,12)}`); return; }
    await new Promise(r => setTimeout(r, 600));
  }
  throw new Error(`${label}: no confirmation`);
};

// Seats first when any are on the rollup — the core must still be there to check them.
for (let i = 0; i < 6; i++) {
  if (seatOwners[i] !== "rollup") continue;
  try {
    await send(await program.methods.undelegateSeat(i).accountsPartial({
      payer: kp.publicKey, table,
      seat: pda([enc("seat"), table.toBytes(), Uint8Array.from([i])]),
      hole: pda([enc("hole"), table.toBytes(), Uint8Array.from([i])]),
    }).instruction(), `undelegate seat ${i}`);
  } catch (e) { console.error(`  seat ${i} failed: ${e.message}`); }
}
await send(await program.methods.undelegateCore().accountsPartial({
  payer: kp.publicKey, table,
  hand: pda([enc("hand"), table.toBytes()]),
  deck: pda([enc("deck"), table.toBytes()]),
}).instruction(), "undelegate core");

console.log("\nwaiting for the commit to land on Solana...");
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  if ((await owner(table)) === "base") { console.log("  table is back on Solana ✓"); break; }
}
console.log(`  final: table=${await owner(table)} hand=${await owner(pda([enc("hand"), table.toBytes()]))} deck=${await owner(pda([enc("deck"), table.toBytes()]))}`);
