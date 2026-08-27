#!/usr/bin/env node
/**
 * Play a real session at a house table, so the lobby's figures come from
 * hands that actually happened.
 *
 * Two wallets funded from the treasury sit at an existing house table and
 * play. Every hand is a genuine hand: real VRF, real hole cards from the
 * enclave, real chips crossing the felt, real rake to the house. Nothing here
 * writes a number anywhere — the tiles move because the play moved them, and
 * every figure stays checkable on chain afterwards.
 *
 *   node scripts/house-session.mjs --table <id> [--hands 25] [--buyin 1000]
 *
 * The dev server must be running: this drives the actual UI, the same way the
 * two-browser gate does, because the UI is what knows how to talk to the
 * enclave and the rollup.
 *
 * BE CLEAR ABOUT WHAT THIS IS. Both wallets belong to the house, so the
 * volume it produces is house play, not players finding each other. It is
 * real and it is verifiable; it is not organic. Anyone can read these two
 * addresses on chain and see that. If the lobby ever presents these figures
 * as a room full of strangers, that is a misrepresentation the numbers
 * themselves will not support — say "includes house play" beside them.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import nacl from "tweetnacl";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const PORT = arg("port", "3000");
const BASE = `http://localhost:${PORT}`;
const TABLE_ID = arg("table", null);
const HANDS = Number(arg("hands", "25"));
/** Chips each wallet sits down with. 1000 = $10. */
const BUYIN = Number(arg("buyin", "1000"));
const SHOTS = "/tmp/solpoker-session";
mkdirSync(SHOTS, { recursive: true });

if (!TABLE_ID) {
  console.error("--table <id> is required. Pick a house table from the lobby.");
  process.exit(1);
}

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const RPC = env.match(/^NEXT_PUBLIC_BASE_RPC=(.+)$/m)[1].trim();
const MAINNET = !/devnet/i.test(RPC);
const USDC_MINT = new PublicKey(
  MAINNET
    ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    : "CzZoUHtyZkarrnRbsjPVEge6UANgCYrq8Bb8ambjjTxq",
);

const INJECT = readFileSync(new URL("./inject-wallet.js", import.meta.url), "utf8");
const conn = new Connection(RPC, "confirmed");
const funder = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8")),
  ),
);
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Enough SOL for a session key and its fees, with headroom for a long run. */
const TARGET_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;
/** Enough USDC to buy in, plus room to rebuy once. */
const TARGET_MICRO_USDC = Math.round(BUYIN * 1.1) * 10_000;

/**
 * The house's two players, kept between runs.
 *
 * Reused rather than regenerated so the chain does not accumulate a Player
 * account per run, each holding chips nobody can spend because the key is
 * gone. They would sit in the leaderboard forever.
 */
function sessionWallets() {
  const path = `${SHOTS}/session-wallets.json`;
  try {
    return JSON.parse(readFileSync(path, "utf8")).map((s) =>
      Keypair.fromSecretKey(Uint8Array.from(s)),
    );
  } catch {
    const fresh = [Keypair.generate(), Keypair.generate()];
    writeFileSync(path, JSON.stringify(fresh.map((k) => Array.from(k.secretKey))));
    return fresh;
  }
}

async function usdcBalance(owner) {
  const info = await conn.getAccountInfo(getAssociatedTokenAddressSync(USDC_MINT, owner));
  if (!info) return 0;
  const v = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  return Number(v.getBigUint64(64, true));
}

/**
 * Chips this wallet already has in play, sitting on a seat at the table.
 *
 * Sitting down MOVES chips out of the Player balance and onto the seat, so a
 * wallet mid-session reads as holding no USDC and no chips while actually
 * being fully stocked. Funding on those two numbers alone tried to re-buy the
 * whole stack every run, and drained the treasury to pay for chips that were
 * already on the felt.
 */
async function stackAtTable(owner) {
  const enc = (x) => new TextEncoder().encode(x);
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(TABLE_ID));
  const program = new PublicKey(
    JSON.parse(readFileSync(new URL("../src/lib/idl/solpoker.json", import.meta.url), "utf8"))
      .address,
  );
  const table = PublicKey.findProgramAddressSync([enc("table"), idBuf], program)[0];
  for (let i = 0; i < 6; i++) {
    const seat = PublicKey.findProgramAddressSync(
      [enc("seat"), table.toBytes(), Uint8Array.from([i])],
      program,
    )[0];
    const info = await conn.getAccountInfo(seat);
    if (!info) continue;
    const occupant = new PublicKey(info.data.subarray(41, 73)).toBase58();
    if (occupant === owner.toBase58()) return Number(info.data.readBigUInt64LE(73));
  }
  return 0;
}

/** Top both wallets up to the floor, and no further. */
async function fund(players) {
  const ixs = [];
  const notes = [];
  for (const p of players) {
    const sol = await conn.getBalance(p.publicKey);
    if (sol < TARGET_LAMPORTS) {
      ixs.push(
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: p.publicKey,
          lamports: TARGET_LAMPORTS - sol,
        }),
      );
      notes.push(`${p.publicKey.toBase58().slice(0, 6)} +${((TARGET_LAMPORTS - sol) / 1e9).toFixed(3)} SOL`);
    }
  }
  const funderAta = getAssociatedTokenAddressSync(USDC_MINT, funder.publicKey);
  for (const p of players) {
    // Already sitting with a stack: nothing to buy.
    const inPlay = await stackAtTable(p.publicKey);
    if (inPlay >= BUYIN) {
      notes.push(`${p.publicKey.toBase58().slice(0, 6)} already in play (${inPlay} chips)`);
      continue;
    }
    const held = await usdcBalance(p.publicKey);
    const need = TARGET_MICRO_USDC - held;
    if (need <= 0) continue;
    const ata = getAssociatedTokenAddressSync(USDC_MINT, p.publicKey);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(
        funder.publicKey,
        ata,
        p.publicKey,
        USDC_MINT,
      ),
      // No minting: on mainnet this is the treasury's own USDC moving.
      createTransferCheckedInstruction(funderAta, USDC_MINT, ata, funder.publicKey, need, 6),
    );
    notes.push(`${p.publicKey.toBase58().slice(0, 6)} +$${(need / 1e6).toFixed(2)}`);
  }
  if (ixs.length === 0) return log("funding: both wallets already stocked");

  const held = await usdcBalance(funder.publicKey);
  log(`funding: ${notes.join(", ")}`);
  log(`treasury USDC before: $${(held / 1e6).toFixed(2)}`);
  const tx = new Transaction().add(...ixs);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = funder.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(funder);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  log("  funded");
}

async function openBrowser(browser, kp, name) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const toasts = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/failed|Error|error:/i.test(t)) toasts.push(t.slice(0, 200));
  });
  page.__toasts = toasts;
  await page.exposeFunction("__testSignTransaction", (bytes) => {
    const tx = Transaction.from(Buffer.from(bytes));
    tx.partialSign(kp);
    return Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
  });
  await page.exposeFunction("__testSignMessage", (bytes) =>
    Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)),
  );
  await page.addInitScript(
    ({ address, bytes, script }) => {
      window.__TEST_WALLET_ADDRESS__ = address;
      window.__TEST_WALLET_PUBKEY_BYTES__ = bytes;
      // eslint-disable-next-line no-eval
      window.eval(script);
    },
    { address: kp.publicKey.toBase58(), bytes: Array.from(kp.publicKey.toBytes()), script: INJECT },
  );
  return { name, ctx, page, kp };
}

const visible = async (page, name) =>
  page.getByRole("button", { name }).first().isVisible().catch(() => false);
const click = async (page, name) =>
  page.getByRole("button", { name }).first().click({ timeout: 8000 }).catch(() => {});

/**
 * Sit a wallet down: connect, buy chips, take a seat, authorise a session key.
 *
 * Each step waits on the thing it actually produces rather than on a fixed
 * interval, because every one of them is a chain round trip whose latency
 * varies by an order of magnitude.
 */
async function seat(b, tableId) {
  await b.page.goto(`${BASE}/lobby`, { waitUntil: "networkidle", timeout: 60_000 });
  await click(b.page, /test wallet/i);
  await sleep(4000);

  // Chips, through the gate's own buy step or the lobby's, whichever shows.
  for (let i = 0; i < 3; i++) {
    if (await visible(b.page, /buy .* chips/i)) {
      await click(b.page, /buy .* chips/i);
      await sleep(9000);
    }
    if (await visible(b.page, /^buy chips$/i)) {
      await click(b.page, /^buy chips$/i);
      await sleep(2000);
      await click(b.page, /^max$/i);
      await click(b.page, /^buy for/i);
      await sleep(9000);
    }
    if (!(await visible(b.page, /buy .* chips/i))) break;
  }
  log(`  ${b.name}: chips bought`);

  await b.page.goto(`${BASE}/table/${tableId}`, { waitUntil: "networkidle", timeout: 60_000 });
  await sleep(5000);
  await click(b.page, /^seat \d$/i);
  await sleep(1500);
  await click(b.page, /sit down/i);
  const ok = await b.page
    .waitForFunction(() => /\byou\b/i.test(document.body.innerText), { timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  log(`  ${b.name}: ${ok ? "seated" : "COULD NOT SEAT"}`);
  if (!ok) (b.__toasts ?? []).slice(-4).forEach((t) => log(`      ${t}`));

  /*
   * The session key, which is TWO presses, not one.
   *
   * "Authorise session key" opens a panel explaining what the key can and
   * cannot do, and "Continue" is what actually signs. Clicking only the first
   * and waiting for the prompt to disappear waits forever — the panel is the
   * prompt — and the table then sits at READY TO START with nobody able to
   * start it. That is exactly how a whole session produced zero hands.
   */
  for (let i = 0; i < 4; i++) {
    const needsKey = await visible(b.page, /authorise session key/i);
    const canConfirm = await visible(b.page, /^continue$/i);
    if (!needsKey && !canConfirm) break;
    if (canConfirm) {
      await click(b.page, /^continue$/i);
    } else {
      await click(b.page, /authorise session key/i);
    }
    // The signature is a chain round trip; the button vanishing is the signal.
    await b.page
      .waitForFunction(
        () => /start playing/i.test(document.body.innerText),
        { timeout: 60_000 },
      )
      .catch(() => {});
  }
  const armed = await visible(b.page, /start playing/i);
  log(`  ${b.name}: session key ${armed ? "authorised" : "NOT authorised"}`);
  return ok;
}

/**
 * Act for whoever is to act, betting rather than only calling.
 *
 * Checking a hand down produces a pot of exactly the blinds, which is a real
 * hand and a meaningless one. Committing chips is what makes the pot a pot —
 * so this raises when it can, on a fixed rota rather than at random, and
 * calls what comes back. Both wallets are the house, so there is no edge to
 * protect and no reason to play well; the point is that chips genuinely cross
 * the felt and the rake is genuinely taken.
 */
async function act(players, handIndex) {
  let acted = 0;
  for (const b of players) {
    // Raise on roughly a third of streets, so pots build without every hand
    // ending in an all-in on the first action.
    const aggressive = (handIndex + players.indexOf(b)) % 3 === 0;
    if (aggressive && (await visible(b.page, /^(raise|bet)/i))) {
      await click(b.page, /^(raise|bet)/i);
      acted++;
      await sleep(400);
      continue;
    }
    for (const label of [/^call/i, /^check$/i]) {
      if (await visible(b.page, label)) {
        await click(b.page, label);
        acted++;
        await sleep(400);
        break;
      }
    }
  }
  return acted;
}

/** Hands this browser has captured and verified, from its own IndexedDB. */
const handsRecorded = (page) =>
  page
    .evaluate(
      () =>
        new Promise((res) => {
          indexedDB.databases().then((dbs) => {
            if (!dbs.some((d) => d.name === "solpoker")) return res(0);
            const req = indexedDB.open("solpoker");
            req.onerror = () => res(0);
            req.onsuccess = () => {
              try {
                if (!req.result.objectStoreNames.contains("hands")) return res(0);
                const c = req.result.transaction("hands").objectStore("hands").count();
                c.onsuccess = () => res(c.result);
                c.onerror = () => res(0);
              } catch {
                res(0);
              }
            };
          }).catch(() => res(0));
        }),
    )
    .catch(() => 0);

// ---------------------------------------------------------------- run

log(`rpc     ${RPC.replace(/\/\/[^.]+/, "//<host>")}`);
log(`table   #${TABLE_ID}`);
log(`target  ${HANDS} hands, ${BUYIN} chips each\n`);

const players = sessionWallets();
players.forEach((p, i) => log(`player ${i + 1}: ${p.publicKey.toBase58()}`));
log("");

await fund(players);

const browser = await chromium.launch();
const A = await openBrowser(browser, players[0], "A");
const B = await openBrowser(browser, players[1], "B");

try {
  log("\nseating both players");
  const aOk = await seat(A, TABLE_ID);
  const bOk = await seat(B, TABLE_ID);
  if (!aOk || !bOk) throw new Error("could not seat both players");

  log("\nstarting the table");
  for (let i = 0; i < 3; i++) {
    if (!(await visible(A.page, /start playing/i))) break;
    await click(A.page, /start playing/i);
    const live = await A.page
      .waitForFunction(() => /preflop|shuffling|flop|dealing/i.test(document.body.innerText), {
        timeout: 100_000,
      })
      .then(() => true)
      .catch(() => false);
    if (live) break;
  }

  log(`\nplaying, aiming for ${HANDS} hands`);
  const started = Date.now();
  let last = 0;
  // Generous: each hand is a VRF round trip plus a settlement, and a stall
  // means a hand that will not finish rather than one taking its time.
  const deadline = started + HANDS * 90_000 + 300_000;
  while (Date.now() < deadline) {
    const done = await handsRecorded(A.page);
    if (done >= HANDS) break;
    if (done !== last) {
      log(`  ${done}/${HANDS} hands (${Math.round((Date.now() - started) / 1000)}s)`);
      last = done;
    }
    await act([A, B], done);
    await sleep(900);
  }
  const played = await handsRecorded(A.page);
  log(`\nplayed ${played} hands in ${Math.round((Date.now() - started) / 60000)} min`);
  await A.page.screenshot({ path: `${SHOTS}/table.png` });
} catch (e) {
  console.error(`\nfailed: ${e.message}`);
  (A.page.__toasts ?? []).slice(-6).forEach((t) => log(`  A: ${t}`));
  process.exitCode = 1;
} finally {
  await browser.close();
}
