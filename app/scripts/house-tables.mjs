#!/usr/bin/env node
/**
 * Keep four house tables open, so a newcomer always has somewhere to sit.
 *
 * The cold-start problem in this product is not that the room looks quiet,
 * it is that the first player has to OPEN a table before anyone can join one
 * — and nobody opens a table to sit at alone. Four standing tables, paid for
 * by the treasury, remove that step entirely.
 *
 * Idempotent. It counts the house tables that already exist and opens only
 * the difference, so running it twice does not make eight, and running it
 * after a sweep restores what was taken.
 *
 * The sweep is the reason this is a keeper rather than a one-off. Closing an
 * empty table is permissionless on chain and always will be: anyone may
 * reclaim one that has sat empty for an hour, and the rent goes back to the
 * treasury that paid it. The lobby exempts house tables from the filters that
 * HIDE deserted tables, but nothing exempts them from being closed. So this
 * is meant to be run on a schedule.
 *
 *   node scripts/house-tables.mjs [--count 4] [--dry-run]
 *
 * Signs with ~/.config/solana/id.json, which must be TREASURY_AUTHORITY: the
 * lobby recognises a house table by its config's creator, so a table opened
 * by any other key is just an ordinary table nobody will maintain.
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const { BN, Program, AnchorProvider, Wallet } = anchor.default ?? anchor;

const TREASURY = "FWRvqaezac9noSy2WsPSNoZZs2Vc2peA4TRLkjziS7Vq";
const PROGRAM_ID = new PublicKey(idl.address);
const MAX_SEATS = 6;
/** Rent for the table, its config, history, six seats and six card slots. */
const CREATE_TABLE_LAMPORTS = 45_000_000;

/**
 * What the house puts on the floor.
 *
 * Weighted to the bottom on purpose. Three of the four are the cheapest game
 * in the room, because the table a newcomer can actually afford to sit at is
 * the only one that helps them, and $4 is the smallest buy-in the program
 * allows. The fourth gives anyone who arrives with a bankroll somewhere to go.
 */
const HOUSE_TABLES = [
  { label: "Micro", sb: 10, bb: 20, min: 400, max: 2_000 },
  { label: "Micro", sb: 10, bb: 20, min: 400, max: 2_000 },
  { label: "Micro", sb: 10, bb: 20, min: 400, max: 2_000 },
  { label: "Low", sb: 50, bb: 100, min: 2_000, max: 10_000 },
  /*
   * The big table, sized to what the treasury can actually seat.
   *
   * The published High tier is $2.50/$5 with a $100 minimum, which needs $200
   * to sit two players down and is therefore out of reach. This is the
   * largest game the bankroll supports: twenty big blinds at the minimum,
   * a hundred at the top, so a pot here can reach a hundred times what a
   * Micro pot can. Stakes are set from the bankroll rather than the bankroll
   * being pretended into the stakes.
   */
  { label: "Mid", sb: 25, bb: 50, min: 1_000, max: 10_000 },
];

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const WANT = Number(args[args.indexOf("--count") + 1]) || HOUSE_TABLES.length;

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const RPC =
  process.env.HOUSE_RPC ??
  env.match(/^NEXT_PUBLIC_BASE_RPC=(.+)$/m)?.[1].trim() ??
  "https://rpc.magicblock.app/devnet";

const conn = new Connection(RPC, "confirmed");
const signer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);
const log = (...a) => console.log(...a);

if (signer.publicKey.toBase58() !== TREASURY) {
  console.error(
    `This must be signed by the treasury (${TREASURY}), but the local keypair is ` +
      `${signer.publicKey.toBase58()}. A table opened by another key would not be ` +
      `recognised as a house table.`,
  );
  process.exit(1);
}

const provider = new AnchorProvider(conn, new Wallet(signer), {
  commitment: "confirmed",
});
const program = new Program(idl, provider);

const seed = (s) => new TextEncoder().encode(s);
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const tablePda = (id) => pda([seed("table"), id.toArrayLike(Buffer, "le", 8)]);

/** Every table the treasury opened that is still standing. */
async function existingHouseTables() {
  const disc = Buffer.from(idl.accounts.find((a) => a.name === "TableConfig").discriminator);
  const configs = await conn.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: bs58(disc) } },
      // creator sits at 8 discriminator + 8 table_id.
      { memcmp: { offset: 16, bytes: TREASURY } },
    ],
  });
  return configs.map(({ account }) => ({
    tableId: account.data.readBigUInt64LE(8).toString(),
    bigBlind: Number(account.data.readBigUInt64LE(56)),
  }));
}

function bs58(bytes) {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += A[digits[i]];
  return out;
}

/**
 * One table, in three transactions: the table and its history, then six
 * seats, then six card slots.
 *
 * Split because they do not fit in one, and ordered because seats and card
 * slots are seeded on the table's address. A run that stops half way leaves a
 * table the lobby marks `outdated` — it checks seat 0's card slot for exactly
 * this reason — so the balance is checked up front rather than discovered
 * between transactions.
 */
async function openTable(spec) {
  const tableId = new BN(Date.now()).muln(1000).addn(Math.floor(Math.random() * 1000));
  const table = tablePda(tableId);

  const first = [];
  const playerPda = pda([seed("player"), signer.publicKey.toBytes()]);
  if (!(await conn.getAccountInfo(playerPda))) {
    first.push(
      await program.methods
        .initPlayer()
        .accountsPartial({ player: playerPda, authority: signer.publicKey })
        .instruction(),
    );
  }
  first.push(
    await program.methods
      .createTable(
        tableId,
        new BN(spec.sb),
        new BN(spec.bb),
        new BN(spec.min),
        new BN(spec.max),
        new BN(30),
      )
      // Every account named explicitly, mirroring lib/instructions.ts. `hand`
      // and `deck` are created by this instruction too; leaving them to be
      // resolved is how a table ends up without the accounts a hand needs.
      .accountsPartial({
        config: pda([seed("config"), tableId.toArrayLike(Buffer, "le", 8)]),
        table,
        hand: pda([seed("hand"), table.toBytes()]),
        deck: pda([seed("deck"), table.toBytes()]),
        creator: signer.publicKey,
      })
      .instruction(),
    await program.methods
      .createHistory()
      .accountsPartial({
        table,
        history: pda([seed("history"), table.toBytes()]),
        payer: signer.publicKey,
      })
      .instruction(),
  );

  const seats = [];
  const holes = [];
  for (let i = 0; i < MAX_SEATS; i++) {
    seats.push(
      await program.methods
        .createSeat(i)
        .accountsPartial({
          table,
          seat: pda([seed("seat"), table.toBytes(), Uint8Array.from([i])]),
          payer: signer.publicKey,
        })
        .instruction(),
    );
    holes.push(
      await program.methods
        .createHole(i)
        .accountsPartial({
          table,
          hole: pda([seed("hole"), table.toBytes(), Uint8Array.from([i])]),
          payer: signer.publicKey,
        })
        .instruction(),
    );
  }

  const labels = ["table", "seats", "card slots"];
  const groups = [first, seats, holes];
  for (let i = 0; i < groups.length; i++) {
    const bh = await conn.getLatestBlockhash();
    const tx = new Transaction().add(...groups[i]);
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.sign(signer);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) {
      throw new Error(`${labels[i]} failed: ${JSON.stringify(conf.value.err)}`);
    }
    log(`    ${labels[i]} ok`);
  }
  return tableId.toString();
}

// ---------------------------------------------------------------- run

log(`rpc      ${RPC.replace(/\/\/[^.]+/, "//<host>")}`);
log(`treasury ${signer.publicKey.toBase58()}`);

const have = await existingHouseTables();
log(`\nhouse tables standing: ${have.length}`);
for (const t of have) log(`  #${t.tableId}  bb=${t.bigBlind}`);

const missing = Math.max(0, WANT - have.length);
if (missing === 0) {
  log(`\nAll ${WANT} house tables are up. Nothing to do.`);
  process.exit(0);
}

const balance = await conn.getBalance(signer.publicKey);
const cost = missing * CREATE_TABLE_LAMPORTS;
log(
  `\nneed ${missing} more, at ~${(CREATE_TABLE_LAMPORTS / 1e9).toFixed(3)} SOL each ` +
    `= ~${(cost / 1e9).toFixed(3)} SOL`,
);
log(`treasury holds ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
if (balance < cost) {
  console.error("\nNot enough SOL. Refusing to open a table it cannot finish.");
  process.exit(1);
}
if (DRY) {
  log("\n--dry-run, stopping here.");
  process.exit(0);
}

// Open the missing ones, choosing specs the room is short of rather than
// simply the first N: a sweep that took the Low table should not be refilled
// with a fourth Micro.
const shortfall = [...HOUSE_TABLES];
for (const t of have) {
  const at = shortfall.findIndex((s) => s.bb === t.bigBlind);
  if (at >= 0) shortfall.splice(at, 1);
}

for (let i = 0; i < missing; i++) {
  const spec = shortfall[i] ?? HOUSE_TABLES[0];
  log(`\nopening ${spec.label} (${spec.sb}/${spec.bb})`);
  try {
    const id = await openTable(spec);
    log(`  opened #${id}`);
  } catch (e) {
    console.error(`  failed: ${e.message}`);
    process.exitCode = 1;
    break;
  }
}

log("\ndone");
