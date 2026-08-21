#!/usr/bin/env node
/**
 * Clear the tables the two-browser gate leaves behind.
 *
 * `wipe-tables.mjs` signs with `~/.config/solana/id.json`, and the gate creates
 * its tables from its own persisted wallet. A non-creator may only vacate a
 * seat or close a table once it has been abandoned for an hour, so the ordinary
 * wipe leaves every fresh gate table in place with a `TableNotAbandoned`. This
 * signs as the creator instead, which needs no waiting.
 *
 * Chips always go back to the seat occupant's own balance, whoever signs, so
 * this can clear a chair but never take anything from anyone.
 *
 *   node scripts/clear-gate-tables.mjs
 */
import { readFileSync } from "node:fs";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const RPC = process.env.RPC ?? "https://rpc.magicblock.app/devnet";
const WALLETS = process.env.WALLETS ?? "/tmp/solpoker-gate/gate-wallets.json";
const P = new PublicKey(idl.address);
/** Must match `TREASURY_AUTHORITY` in the program: the only account rake lands in. */
const TREASURY_AUTHORITY = new PublicKey("FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq");
const conn = new Connection(RPC, "confirmed");

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
const u64 = (n) => Buffer.from(new BigUint64Array([BigInt(n)]).buffer);

const keypairs = JSON.parse(readFileSync(WALLETS, "utf8")).map((s) =>
  Keypair.fromSecretKey(Uint8Array.from(s)),
);
// The local wallet too, so a table created by hand is covered as well.
try {
  keypairs.push(
    Keypair.fromSecretKey(
      Uint8Array.from(
        JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
      ),
    ),
  );
} catch {
  // Not configured; the gate wallets are enough.
}
const byPubkey = new Map(keypairs.map((k) => [k.publicKey.toBase58(), k]));
console.log(`holding keys for: ${[...byPubkey.keys()].map((k) => k.slice(0, 8)).join(", ")}\n`);

const programFor = (kp) =>
  new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(kp), {
    commitment: "confirmed",
  }));

// Anchor derives an account discriminator as the first eight bytes of
// sha256("account:<Name>"). Computed here rather than pulled off a coder,
// whose shape moves between Anchor versions.
import { createHash } from "node:crypto";
const discriminator = (name) =>
  createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);

const configs = await conn.getProgramAccounts(P, {
  filters: [
    {
      memcmp: {
        offset: 0,
        bytes: anchor.utils.bytes.bs58.encode(discriminator("TableConfig")),
      },
    },
  ],
});
console.log(`${configs.length} table(s) on chain\n`);

let cleared = 0;
let skipped = 0;

for (const c of configs) {
  const d = c.account.data;
  const tableId = d.readBigUInt64LE(8);
  const creator = new PublicKey(d.slice(16, 48)).toBase58();
  const kp = byPubkey.get(creator);

  console.log(`table ${tableId}  creator ${creator.slice(0, 8)}`);
  if (!kp) {
    console.log("  no key for the creator; leave it to the one-hour sweep\n");
    skipped++;
    continue;
  }

  const table = pda([Buffer.from("table"), u64(tableId)]);
  const info = await conn.getAccountInfo(table);
  if (!info) {
    console.log("  table account already gone\n");
    continue;
  }
  if (!info.owner.equals(P)) {
    console.log("  still delegated to the rollup; run wipe-tables.mjs first\n");
    skipped++;
    continue;
  }

  const program = programFor(kp);
  const hand = pda([Buffer.from("hand"), table.toBuffer()]);

  for (let i = 0; i < 6; i++) {
    const occupant = new PublicKey(info.data.slice(48 + i * 32, 80 + i * 32));
    if (occupant.equals(PublicKey.default)) continue;
    try {
      await program.methods
        .vacateSeat(i)
        .accountsPartial({
          table,
          config: c.pubkey,
          hand,
          seat: pda([Buffer.from("seat"), table.toBuffer(), Buffer.from([i])]),
          player: pda([Buffer.from("player"), occupant.toBuffer()]),
          payer: kp.publicKey,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`  seat ${i}: chips returned to ${occupant.toBase58().slice(0, 8)}`);
    } catch (e) {
      console.log(`  seat ${i}: ${String(e).split("\n")[0].slice(0, 90)}`);
    }
  }

  // Rake has to reach the house before the table can go. `close_table` refuses
  // while any is unswept, because deleting the table would destroy chips the
  // vault is still backing. Permissionless, and the destination is fixed.
  const rake = info.data.length >= 267 ? Number(info.data.readBigUInt64LE(259)) : 0;
  if (rake > 0) {
    try {
      await program.methods
        .sweepRake()
        .accountsPartial({
          table,
          treasury: pda([Buffer.from("player"), TREASURY_AUTHORITY.toBuffer()]),
          payer: kp.publicKey,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`  swept ${rake} chips of rake to the treasury`);
    } catch (e) {
      console.log(`  sweep: ${String(e).split("\n")[0].slice(0, 80)}`);
    }
  }

  try {
    await program.methods
      .closeTable()
      .accountsPartial({
        table,
        config: c.pubkey,
        payer: kp.publicKey,
        hand,
        deck: pda([Buffer.from("deck"), table.toBuffer()]),
        history: pda([Buffer.from("history"), table.toBuffer()]),
        creator: kp.publicKey,
      })
      // The six seat PDAs then the six hole PDAs, in order. `close_table`
      // drains their rent back to the creator, so it needs them all and
      // checks each address it is given.
      .remainingAccounts(
        [
          ...Array.from({ length: 6 }, (_, i) =>
            pda([Buffer.from("seat"), table.toBuffer(), Buffer.from([i])]),
          ),
          ...Array.from({ length: 6 }, (_, i) =>
            pda([Buffer.from("hole"), table.toBuffer(), Buffer.from([i])]),
          ),
        ].map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })),
      )
      .rpc({ commitment: "confirmed" });
    console.log("  deleted\n");
    cleared++;
  } catch (e) {
    console.log(`  close: ${String(e).split("\n")[0].slice(0, 90)}\n`);
    skipped++;
  }
}

console.log(`${cleared} deleted, ${skipped} left in place`);
