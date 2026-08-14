// Runs each cu-bench workload on devnet and reports measured compute units.
//
// The program brackets its work with sol_log_compute_units(), which emits
// "Program consumption: N units remaining". Readings 0 and 1 bracket nothing, so
// their difference is the cost of one instrumentation call; that is subtracted
// from every later delta to leave the engine work alone.
//
//   node run-bench.mjs [rpcUrl]

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";
import os from "os";

const RPC = process.argv[2] ?? "https://rpc.magicblock.app/devnet";
const PROGRAM_ID = new PublicKey(
  JSON.parse(
    fs.readFileSync(new URL("./program-id.json", import.meta.url), "utf8"),
  ),
);

const payer = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8")),
  ),
);

const connection = new Connection(RPC, "confirmed");

const WORKLOADS = [
  { mode: 0, label: "baseline (instrumentation only)" },
  { mode: 1, label: "evaluate() — one 7-card hand" },
  { mode: 2, label: "showdown — 6 evaluates + side pots + payout" },
  { mode: 3, label: "shuffle — 52-card deterministic Fisher-Yates" },
];

/** Pull the ordered "units remaining" readings out of the program logs. */
function readings(logs) {
  return logs
    .map((l) => l.match(/Program consumption: (\d+) units remaining/))
    .filter(Boolean)
    .map((m) => Number(m[1]));
}

async function run(mode) {
  const data = Buffer.alloc(33);
  data[0] = mode;
  // Fixed seed so the measurement is reproducible run to run.
  for (let i = 1; i < 33; i++) data[i] = 42;

  const ix = new TransactionInstruction({
    keys: [],
    programId: PROGRAM_ID,
    data,
  });
  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [payer],
    { commitment: "confirmed", skipPreflight: true },
  );
  const tx = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const logs = tx?.meta?.logMessages ?? [];
  const totalMatch = logs
    .join("\n")
    .match(/consumed (\d+) of \d+ compute units/);
  return {
    sig,
    logs,
    points: readings(logs),
    totalCu: totalMatch ? Number(totalMatch[1]) : null,
  };
}

console.log(`RPC:     ${RPC}`);
console.log(`Program: ${PROGRAM_ID.toBase58()}`);
console.log(`Payer:   ${payer.publicKey.toBase58()}\n`);

// Calibrate the instrumentation cost from the baseline run.
const base = await run(0);
if (base.points.length < 2) {
  console.error("baseline did not emit two readings; logs:", base.logs);
  process.exit(1);
}
const overhead = base.points[0] - base.points[1];
console.log(`instrumentation cost per reading: ${overhead} CU`);
console.log(`whole-transaction baseline:       ${base.totalCu} CU\n`);

const rows = [];
for (const w of WORKLOADS) {
  const r = await run(w.mode);
  // The measured region sits between the last two readings.
  let workCu = null;
  if (r.points.length >= 2) {
    const a = r.points[r.points.length - 2];
    const b = r.points[r.points.length - 1];
    workCu = a - b - overhead;
  }
  rows.push({ ...w, workCu, totalCu: r.totalCu, sig: r.sig });
  const detail = r.logs.find((l) => l.includes("mode=")) ?? "";
  console.log(
    `mode ${w.mode}  ${String(workCu ?? "-").padStart(6)} CU  ` +
      `(tx total ${String(r.totalCu).padStart(6)})  ${w.label}`,
  );
  if (detail) console.log(`         ${detail.replace(/^Program log: /, "")}`);
}

console.log("\n--- summary ---");
const budget = 200_000;
for (const r of rows) {
  if (r.mode === 0) continue;
  const pct = ((r.workCu / budget) * 100).toFixed(2);
  console.log(
    `${r.label.padEnd(48)} ${String(r.workCu).padStart(6)} CU  ` +
      `${pct}% of the default ${budget.toLocaleString()} CU budget`,
  );
}
