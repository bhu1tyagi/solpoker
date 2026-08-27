#!/usr/bin/env node
/**
 * Empty a table and close it, straight on chain.
 *
 * Driving the UI to do this is slower and can fail for reasons that have
 * nothing to do with the chain; these are two plain instructions and both
 * wallets are held locally, so they are called directly.
 *
 * Order is not optional. `leave_table` returns a seat's stack to its owner's
 * Player balance and empties the seat; `close_table` refuses while anyone is
 * still seated. Rent from the table, its config, hand, deck and history all
 * goes back to the creator that paid for it.
 *
 *   node scripts/table-teardown.mjs --table <id> [--keep-open]
 *
 * --keep-open leaves the table standing and only empties the seats, which is
 * what you want for a table that is fine and simply has stale players at it.
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const { Program, AnchorProvider, Wallet } = anchor.default ?? anchor;

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const TABLE_ID = arg("table", null);
const KEEP_OPEN = args.includes("--keep-open");
if (!TABLE_ID) {
  console.error("--table <id> is required");
  process.exit(1);
}

const RPC = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
  .match(/^NEXT_PUBLIC_BASE_RPC=(.+)$/m)[1]
  .trim();
const conn = new Connection(RPC, "confirmed");
const PROGRAM_ID = new PublicKey(idl.address);
const enc = (s) => new TextEncoder().encode(s);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

const treasury = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);
/** The house's session wallets, so their seats can be vacated by their owners. */
let players = [];
try {
  players = JSON.parse(
    readFileSync("/tmp/solpoker-session/session-wallets.json", "utf8"),
  ).map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
} catch {
  // None saved. Only seats belonging to the treasury can then be emptied.
}
const known = new Map([treasury, ...players].map((k) => [k.publicKey.toBase58(), k]));

const idBuf = Buffer.alloc(8);
idBuf.writeBigUInt64LE(BigInt(TABLE_ID));
const table = pda([enc("table"), idBuf]);
const log = (...a) => console.log(...a);

const info = await conn.getAccountInfo(table);
if (!info) {
  log(`table ${TABLE_ID} does not exist`);
  process.exit(0);
}
if (!info.owner.equals(PROGRAM_ID)) {
  console.error(
    "This table is DELEGATED — a game is live on the rollup and it cannot be " +
      "emptied from the base layer. Pause it from the table page first.",
  );
  process.exit(1);
}

log(`table  ${TABLE_ID}`);
log(`state  ${info.data[249]}, hand ${info.data.readBigUInt64LE(241)}`);

const send = async (ixs, signer, label) => {
  const bh = await conn.getLatestBlockhash();
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(signer);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`${label}: ${JSON.stringify(conf.value.err)}`);
  log(`  ${label} ok`);
};

// --- empty every seat -------------------------------------------------------
for (let i = 0; i < 6; i++) {
  const occupant = new PublicKey(info.data.subarray(48 + i * 32, 80 + i * 32)).toBase58();
  if (occupant === "11111111111111111111111111111111") continue;
  const kp = known.get(occupant);
  if (!kp) {
    log(`  seat ${i}: ${occupant.slice(0, 8)}.. is not a wallet held here, skipping`);
    continue;
  }
  const provider = new AnchorProvider(conn, new Wallet(kp), { commitment: "confirmed" });
  const program = new Program(idl, provider);
  const ix = await program.methods
    .leaveTable(i)
    .accountsPartial({
      table,
      seat: pda([enc("seat"), table.toBytes(), Uint8Array.from([i])]),
      player: pda([enc("player"), kp.publicKey.toBytes()]),
      authority: kp.publicKey,
    })
    .instruction();
  try {
    await send([ix], kp, `seat ${i} vacated (${occupant.slice(0, 8)}..)`);
  } catch (e) {
    log(`  seat ${i} could not be vacated: ${e.message}`);
  }
}

if (KEEP_OPEN) {
  log("\n--keep-open, leaving the table standing");
  process.exit(0);
}

// --- close it ---------------------------------------------------------------
const provider = new AnchorProvider(conn, new Wallet(treasury), { commitment: "confirmed" });
const program = new Program(idl, provider);
const closeIx = await program.methods
  .closeTable()
  .accountsPartial({
    table,
    config: pda([enc("config"), idBuf]),
    payer: treasury.publicKey,
    hand: pda([enc("hand"), table.toBytes()]),
    deck: pda([enc("deck"), table.toBytes()]),
    history: pda([enc("history"), table.toBytes()]),
    creator: treasury.publicKey,
  })
  /*
   * Six seats then six card slots, in index order.
   *
   * close_table drains each of them back to the creator, and it checks every
   * address against the PDA it re-derives itself — so the order is part of the
   * instruction, not a convention. Anchor cannot infer these: they are
   * remaining accounts, and passing none is the SeatOrderMismatch this hit.
   */
  .remainingAccounts(
    [
      ...Array.from({ length: 6 }, (_, i) =>
        pda([enc("seat"), table.toBytes(), Uint8Array.from([i])]),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        pda([enc("hole"), table.toBytes(), Uint8Array.from([i])]),
      ),
    ].map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })),
  )
  .instruction();
try {
  await send([closeIx], treasury, "table closed");
} catch (e) {
  console.error(`  close failed: ${e.message}`);
  process.exitCode = 1;
}
