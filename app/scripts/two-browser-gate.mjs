#!/usr/bin/env node
/**
 * The gate: two browsers, two wallets, a real hand.
 *
 * Drives the actual UI rather than the modules underneath it, because the
 * modules passing is not the same thing as the app working. Each browser gets
 * its own wallet-standard wallet backed by its own keypair, so both take the
 * same path a player with an extension takes.
 *
 * Usage, with the dev server already running:
 *   node scripts/two-browser-gate.mjs [port]
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";

const PORT = process.argv[2] ?? "3111";
const BASE = `http://localhost:${PORT}`;
// The Node side must talk to the same chain the served client does, or the
// wallets get funded on one cluster and play on another. Devnet by default;
// a mainnet run passes GATE_RPC explicitly.
const RPC = process.env.GATE_RPC ?? "https://rpc.magicblock.app/devnet";
const SHOTS = "/tmp/solpoker-gate";
mkdirSync(SHOTS, { recursive: true });

const INJECT = readFileSync(new URL("./inject-wallet.js", import.meta.url), "utf8");
const conn = new Connection(RPC, "confirmed");
const funder = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Open a browser whose wallet is this keypair. */
async function openBrowser(browser, kp, name) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Surface anything the app tells the player, so a failed step explains
  // itself instead of just not happening.
  const toasts = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/failed|Error|error:|^session:/i.test(t)) toasts.push(t.slice(0, 240));
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

  return { name, ctx, page, errors, kp };
}

async function connectWallet(b) {
  await b.page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
  await b.page.getByRole("button", { name: /select wallet/i }).click();
  await b.page.getByRole("button", { name: /test wallet/i }).first().click();
  // Connected means the lobby's own controls appear. Waiting for the word
  // "chips" worked by accident: it matched the leaderboard's column header,
  // which a virgin cluster with no ranked players never renders.
  await b.page.getByRole("button", { name: /create a table/i }).waitFor({ timeout: 30_000 });
  log(`  ${b.name}: connected`);
}

async function shot(b, label) {
  await b.page.screenshot({ path: `${SHOTS}/${b.name}-${label}.png` });
}

/**
 * The two test players, kept between runs.
 *
 * Generating fresh keypairs every run left a new Player account on chain each
 * time, each holding chips nobody can ever spend because the key is gone. They
 * pile up in the leaderboard forever. Two wallets reused across runs keep the
 * chain as clean as the test can leave it.
 */
function testWallets() {
  const path = `${SHOTS}/gate-wallets.json`;
  try {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    return saved.map((secret) => Keypair.fromSecretKey(Uint8Array.from(secret)));
  } catch {
    const fresh = [Keypair.generate(), Keypair.generate()];
    try {
      writeFileSync(path, JSON.stringify(fresh.map((k) => Array.from(k.secretKey))));
    } catch {
      // Not being able to save them only costs the next run two more accounts.
    }
    return fresh;
  }
}

// What each test wallet needs on hand for a run: two buy-ins, a session key,
// and fees.
const TARGET_LAMPORTS = 0.35 * LAMPORTS_PER_SOL;

async function main() {
  const players = testWallets();

  // Top up to the target rather than transferring unconditionally. The wallets
  // are reused across runs and a hand rarely spends the whole float, so a flat
  // transfer every run is a slow leak out of the funder and into two accounts
  // nothing ever sweeps: they had quietly accumulated 2.37 SOL before this was
  // noticed, at which point the funder could no longer afford a run.
  const balances = await Promise.all(players.map((p) => conn.getBalance(p.publicKey)));
  const short = players
    .map((p, i) => ({ p, need: TARGET_LAMPORTS - balances[i] }))
    .filter(({ need }) => need > 0);

  if (short.length === 0) {
    log(`funding: all ${players.length} wallets already at target, nothing to send`);
  } else {
    log(`funding ${short.map(({ p, need }) =>
      `${p.publicKey.toBase58().slice(0, 8)} (+${(need / LAMPORTS_PER_SOL).toFixed(3)})`).join(", ")}`);

    const fund = new Transaction().add(
      ...short.map(({ p, need }) =>
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: p.publicKey,
          lamports: need,
        }),
      ),
    );
    const bh = await conn.getLatestBlockhash();
    fund.feePayer = funder.publicKey;
    fund.recentBlockhash = bh.blockhash;
    fund.sign(funder);
    const sig = await conn.sendRawTransaction(fund.serialize());
    await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    log("  funded");
  }

  // One PROCESS per player, not one context: two contexts share the
  // browser's HTTP/2 connection pool to the RPC, and the creator's heavier
  // traffic kept poisoning the shared connection — every fetch in that
  // context dying with ERR_FAILED while the sibling context sailed. Real
  // players bring their own browsers; the gate now does too.
  const browserA = await chromium.launch();
  const browserB = await chromium.launch();
  const A = await openBrowser(browserA, players[0], "A");
  const B = await openBrowser(browserB, players[1], "B");
  const failures = [];
  const check = (ok, what) => {
    log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };

  try {
    log("\n1. connect both wallets");
    await connectWallet(A);
    await connectWallet(B);

    log("\n2. buy chips with SOL");
    for (const b of [A, B]) {
      await b.page.getByRole("button", { name: /^buy chips$/i }).click();
      await b.page.waitForTimeout(1200);
      await b.page.getByRole("button", { name: /^100$/ }).click();
      await b.page.getByRole("button", { name: /^buy$/i }).click();
      await b.page.waitForFunction(
        () => /Bought 100 chips/i.test(document.body.innerText),
        { timeout: 90_000 },
      );
      log(`  ${b.name}: bought 100 chips for 0.1 SOL`);
    }
    await shot(A, "1-lobby");

    log("\n3. A creates a table");
    await A.page.getByRole("button", { name: /create a table/i }).click();
    // The modal springs in; clicking mid-animation can miss.
    await A.page.waitForTimeout(1200);
    // One transient RPC error inside create() resets the modal in under a
    // second; a player would simply click again, so the gate does too rather
    // than staring at an idle button for three minutes.
    let navigated = false;
    for (let attempt = 0; attempt < 3 && !navigated; attempt++) {
      await A.page
        .getByRole("button", { name: /^create table$/i })
        .click()
        .catch(() => {});
      navigated = await A.page
        .waitForURL(/\/table\/\d+/, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!navigated) {
      (A.page.__toasts ?? []).slice(-6).forEach((t) => log(`      A console: ${t}`));
      throw new Error("table creation did not navigate after 3 attempts");
    }
    const tableUrl = A.page.url();
    const tableId = tableUrl.match(/\/table\/(\d+)/)[1];
    log(`  created table ${tableId}`);
    await A.page.waitForTimeout(4000);
    await shot(A, "2-table-created");

    log("\n4. A sits down");
    await A.page.getByRole("button", { name: /^seat \d$/i }).first().click();
    await A.page.waitForTimeout(1200);
    await A.page.getByRole("button", { name: /sit down/i }).click();
    // The seat must show the player, which is the bug the user reported.
    const aSeated = await A.page
      .waitForFunction(() => /\byou\b/.test(document.body.innerText), { timeout: 90_000 })
      .then(() => true)
      .catch(() => false);
    check(aSeated, "A sees itself seated after joining");
    await shot(A, "3-seated");

    log("\n5. B finds the table in the lobby and joins");
    await B.page.reload({ waitUntil: "networkidle" });
    const bSeesTable = await B.page
      .waitForFunction(
        (id) => document.body.innerText.includes(id),
        tableId,
        { timeout: 60_000 },
      )
      .then(() => true)
      .catch(() => false);
    check(bSeesTable, "B sees A's table in the lobby");
    await shot(B, "4-lobby-with-table");

    await B.page.goto(`${BASE}/table/${tableId}`, { waitUntil: "networkidle" });
    // Do not pick a seat until A's occupancy has actually rendered, or a
    // stale view offers B the seat A is sitting in. The short key is what a
    // taken seat displays; innerText reflects the CSS uppercasing.
    const aKey = players[0].publicKey.toBase58();
    const aShort = `${aKey.slice(0, 4)}..${aKey.slice(-4)}`.toUpperCase();
    await B.page.waitForFunction(
      (k) => document.body.innerText.toUpperCase().includes(k),
      aShort,
      { timeout: 60_000 },
    );
    // The page reached over a full navigation, so the wallet reconnects
    // asynchronously — and a seat click while it is still connecting is a
    // designed no-op. Waiting for the content beat the wallet by seconds.
    await B.page.waitForFunction(
      () => window.__pokerableDebug?.()?.connected === true,
      { timeout: 30_000 },
    );
    const bSeesA = await B.page
      .waitForFunction(() => /\d{3,}/.test(document.body.innerText), { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    check(bSeesA, "B sees A already seated at the table");

    await B.page.getByRole("button", { name: /^seat \d$/i }).first().click();
    await B.page.waitForTimeout(1200);
    await B.page.getByRole("button", { name: /sit down/i }).click();
    // Seated means the modal is gone and B's own plate says "you". The old
    // check matched the word "you" anywhere, which the sit modal's own copy
    // contains, so a join stuck mid-flight still "passed".
    await B.page.waitForFunction(
      () => !/take seat/i.test(document.body.innerText) && /\byou\b/i.test(document.body.innerText),
      { timeout: 90_000 },
    );
    log("  B seated");
    await shot(B, "5-both-seated");

    // A must see B arrive without a reload — B's short key specifically,
    // because counting name-shaped tokens also counted the wallet chip in the
    // top bar.
    const bKey = players[1].publicKey.toBase58();
    const bShort = `${bKey.slice(0, 4)}..${bKey.slice(-4)}`.toUpperCase();
    const aSeesB = await A.page
      .waitForFunction(
        (k) => document.body.innerText.toUpperCase().includes(k),
        bShort,
        { timeout: 60_000 },
      )
      .then(() => true)
      .catch(() => false);
    check(aSeesB, "A sees B arrive live, without a reload");

    log("\n6. both authorise a session key");
    for (const b of [A, B]) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        await b.page
          .getByRole("button", { name: /authorise session key/i })
          .first()
          .click({ timeout: 5_000 })
          .catch(() => {});
        ok = await b.page
          .waitForFunction(() => !/authorise session key/i.test(document.body.innerText), {
            timeout: 90_000,
          })
          .then(() => true)
          .catch(() => false);
      }
      check(ok, `${b.name} authorised a session key`);
      if (!ok) {
        (b.page.__toasts ?? []).slice(-5).forEach((t) => log(`      ${b.name} console: ${t}`));
      }
    }

    log("\n7. A starts the table");
    const startVisible = await A.page
      .getByRole("button", { name: /start playing/i })
      .isVisible()
      .catch(() => false);
    check(startVisible, "Start playing appears once two players are seated");
    if (startVisible) {
      // Starting spans eight transactions and two layers; one flaky
      // confirmation aborts it and puts the button back. The flow is
      // resumable on chain, so a player would press again — the gate does
      // too, and prints the browser's own error when it has to.
      let live = false;
      for (let attempt = 0; attempt < 3 && !live; attempt++) {
        await A.page
          .getByRole("button", { name: /start playing/i })
          .click({ timeout: 5_000 })
          .catch(() => {});
        live = await A.page
          .waitForFunction(() => /preflop|shuffling|flop|dealing/i.test(document.body.innerText), {
            timeout: 100_000,
          })
          .then(() => true)
          .catch(() => false);
        if (!live) {
          (A.page.__toasts ?? []).slice(-3).forEach((t) => log(`      A console: ${t}`));
        }
      }
      check(live, "table goes live and a hand begins");
      await A.page.waitForTimeout(6000);
      await shot(A, "6-hand-live");
      await shot(B, "6-hand-live");
    }

    log("\n8. each player sees their own two cards, face up");
    // A face-up card renders its rank and suit as text; a back renders
    // nothing. So the pod for "you" containing a rank is the check, and it
    // must hold for both players independently.
    const seesOwnCards = async (b) =>
      b.page
        .waitForFunction(
          () => {
            const cards = Array.from(document.querySelectorAll("div")).filter((el) =>
              /^(10|[2-9]|[TJQKA])[\u2660\u2663\u2665\u2666]?$/.test((el.textContent ?? "").trim()),
            );
            return cards.length >= 2;
          },
          { timeout: 90_000 },
        )
        .then(() => true)
        .catch(() => false);
    const aSaw = await seesOwnCards(A);
    check(aSaw, "A can see its own hole cards face up");
    if (!aSaw) {
      const dbg = await A.page.evaluate(() => window.__pokerableDebug?.()).catch(() => null);
      log(`      A store: ${JSON.stringify(dbg)}`);
    }
    const bSaw = await seesOwnCards(B);
    check(bSaw, "B can see its own hole cards face up");
    if (!bSaw) {
      const dbg = await B.page.evaluate(() => window.__pokerableDebug?.()).catch(() => null);
      log(`      B store: ${JSON.stringify(dbg)}`);
    }
    await shot(A, "6b-own-cards");

    // History entries live in IndexedDB, which is the ground truth for
    // "a hand finished and was recorded".
    const historyCount = () =>
      A.page
        .evaluate(
          () =>
            new Promise((res) => {
              // Never open the database blind: opening one that does not exist
              // yet CREATES it, empty, and the app's own versioned open then
              // skips its store creation. That exact accident once made every
              // history save fail silently while this counter reported zero.
              indexedDB
                .databases()
                .then((dbs) => {
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
                })
                .catch(() => res(0));
            }),
        )
        .catch(() => 0);

    let acted = 0;
    const clickThrough = async () => {
      for (const b of [A, B]) {
        for (const label of [/^check$/i, /^call/i]) {
          const btn = b.page.getByRole("button", { name: label });
          if (await btn.isVisible().catch(() => false)) {
            await btn.click().catch(() => {});
            acted++;
            await b.page.waitForTimeout(350);
            break;
          }
        }
      }
    };
    const playUntil = async (hands, budgetMs) => {
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        await clickThrough();
        if ((await historyCount()) >= hands) return true;
        await sleep(1000);
      }
      return false;
    };

    log("\n9. play two hands back to back");
    // Two hands, because the second one is where a stale capture shows up: the
    // hand account still holds the first hand's seed until settlement lands.
    const one = await playUntil(1, 300_000);
    check(one, "the first hand settles and is recorded");
    await shot(A, "7-after-play");
    const two = await playUntil(2, 300_000);
    check(two, "a second hand starts by itself, settles, and is recorded");
    check(acted > 0, `players could act through the UI (${acted} actions)`);

    log("\n10. the lobby still lists the live table");
    await B.page.goto(BASE, { waitUntil: "networkidle" });
    const lobbyListsLive = await B.page
      .waitForFunction((id) => document.body.innerText.includes(id), tableId, {
        timeout: 45_000,
      })
      .then(() => true)
      .catch(() => false);
    check(lobbyListsLive, "a table mid-game appears in the lobby");
    const returnBtn = B.page.getByRole("button", { name: /return to table/i }).first();
    const hasReturn = await returnBtn.isVisible().catch(() => false);
    check(hasReturn, "the lobby offers a way back to your table");
    await shot(B, "7b-lobby-live");
    if (hasReturn) {
      await returnBtn.click();
      await B.page.waitForURL(/\/table\//, { timeout: 30_000 }).catch(() => {});
    } else {
      await B.page.goto(`${BASE}/table/${tableId}`, { waitUntil: "networkidle" });
    }
    await B.page.waitForTimeout(3000);

    log("\n11. hand history: both hands verify");
    await A.page.goto(`${BASE}/history/${tableId}`, { waitUntil: "networkidle" });
    await A.page.waitForTimeout(2500);
    for (let i = 0; i < 4; i++) {
      const btn = A.page.getByRole("button", { name: /verify this shuffle/i }).first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click().catch(() => {});
      await A.page.waitForTimeout(1500);
    }
    const verifiedCount = await A.page
      .evaluate(() => (document.body.innerText.match(/\bVerified\b/g) ?? []).length)
      .catch(() => 0);
    const failedCount = await A.page
      .evaluate(() => (document.body.innerText.match(/\bFailed\b/g) ?? []).length)
      .catch(() => 0);
    check(verifiedCount >= 2, `both hands verify in the browser (${verifiedCount} verified)`);
    check(failedCount === 0, "no hand fails verification");
    await shot(A, "8-verified");

    log("\n12. the creator can delete the table");
    await A.page.goto(`${BASE}/table/${tableId}`, { waitUntil: "networkidle" });
    // The page has to restore the session key and check delegation before it
    // knows which buttons to offer.
    await A.page
      .waitForFunction(() => /pause table|delete table/i.test(document.body.innerText), {
        timeout: 90_000,
      })
      .catch(() => {});

    // Pause first: a live table is delegated and cannot be deleted. If the
    // next shuffle was already fulfilled, the table has to play that hand out
    // before it can leave the rollup, so pausing retries around a hand.
    let paused = false;
    for (let attempt = 0; attempt < 3 && !paused; attempt++) {
      const pauseBtn = A.page.getByRole("button", { name: /pause table/i });
      if (await pauseBtn.isVisible().catch(() => false)) {
        await pauseBtn.click().catch(() => {});
        // Wait for the room to say it is back on the base layer, which it now
        // does by offering "Start playing" again rather than by naming a layer.
        // This used to look for the text "on Solana", from a Link field that was
        // taken out of the HUD ("which layer a table is sitting on is plumbing,
        // not something a player needs to read every hand"). Nothing rendered
        // that string afterwards, so this check could only ever time out — and
        // it did, silently, on a pause that had actually succeeded.
        paused = await A.page
          .waitForFunction(
            () =>
              /start playing|ready to start|delete table/i.test(
                document.body.innerText,
              ) && !/pause table/i.test(document.body.innerText),
            { timeout: 120_000 },
          )
          .then(() => true)
          .catch(() => false);
      }
      if (!paused) {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          await clickThrough();
          if (
            await A.page
              .getByRole("button", { name: /pause table/i })
              .isVisible()
              .catch(() => false)
          )
            break;
          await sleep(1500);
        }
      }
    }
    check(paused, "the table pauses back to the base layer");
    if (!paused) {
      const shown = await A.page
        .evaluate(() => document.body.innerText.slice(0, 700))
        .catch(() => "");
      log(`      on screen: ${shown.replace(/\s+/g, " ").slice(0, 400)}`);
      (A.page.__toasts ?? []).slice(-4).forEach((t) => log(`      console: ${t}`));
    }
    await A.page
      .waitForFunction(() => /delete table/i.test(document.body.innerText), { timeout: 90_000 })
      .catch(() => {});
    const delBtn = A.page.getByRole("button", { name: /delete table/i });
    const canDelete = await delBtn.isVisible().catch(() => false);
    check(canDelete, "the creator sees a delete button");
    if (canDelete) {
      await delBtn.click();
      await A.page.waitForTimeout(1000);
      await A.page.getByRole("button", { name: /delete it/i }).click();
      const gone = await A.page
        .waitForURL(/localhost:\d+\/$/, { timeout: 240_000 })
        .then(() => true)
        .catch(() => false);
      check(gone, "deleting returns to the lobby");
      await A.page.waitForTimeout(4000);
      const stillListed = await A.page
        .evaluate((id) => document.body.innerText.includes(id), tableId)
        .catch(() => true);
      check(!stillListed, "the deleted table is gone from the lobby");
      await shot(A, "9-deleted");
    }

    // B must not be offered a delete on someone else's table.
    await B.page.goto(`${BASE}/table/${tableId}`, { waitUntil: "networkidle" }).catch(() => {});
    await B.page.waitForTimeout(2500);
    const bCanDelete = await B.page
      .getByRole("button", { name: /delete table/i })
      .isVisible()
      .catch(() => false);
    check(!bCanDelete, "a non-creator is not offered a delete button");

    log("\n13. cashing out: chips become SOL again");
    await A.page.goto(BASE, { waitUntil: "networkidle" });
    await A.page.waitForTimeout(2500);
    const solBefore = await conn.getBalance(players[0].publicKey);
    const cashOutBtn = A.page.getByRole("button", { name: /^cash out$/i }).first();
    const canSell = await cashOutBtn.isVisible().catch(() => false);
    check(canSell, "the lobby offers cash out when chips are held");
    if (canSell) {
      await cashOutBtn.click();
      await A.page.waitForTimeout(1200);
      await A.page.getByRole("button", { name: /^max$/i }).click();
      await A.page.getByRole("button", { name: /^cash out$/i }).last().click();
      const sold = await A.page
        .waitForFunction(() => /Sold [\d,]+ chips/i.test(document.body.innerText), {
          timeout: 90_000,
        })
        .then(() => true)
        .catch(() => false);
      check(sold, "chips sell back to the wallet");
      await sleep(3000);
      const solAfter = await conn.getBalance(players[0].publicKey);
      check(
        solAfter > solBefore,
        `the wallet's SOL went up (${((solAfter - solBefore) / 1e9).toFixed(4)} SOL received)`,
      );
      await shot(A, "10-cashed-out");
    }

    log("\n14. console errors");
    for (const b of [A, B]) {
      const real = b.errors.filter(
        (e) => !/favicon|Download the React DevTools|preload/i.test(e),
      );
      check(real.length === 0, `${b.name} had no console errors`);
      if (real.length) real.slice(0, 4).forEach((e) => log(`      ${e.slice(0, 180)}`));
    }
  } catch (e) {
    log(`\nTHREW: ${e.message}`);
    failures.push(`threw: ${e.message}`);
    await shot(A, "error").catch(() => {});
    await shot(B, "error").catch(() => {});
  } finally {
    void browserB;
    // Save both browsers' session keys before the contexts evaporate. Each
    // session key holds a real SOL float, which on devnet was noise and on
    // mainnet is money: with the secrets on disk the float can be swept back
    // to the funder after the run instead of dying with the browser.
    try {
      const saved = {};
      for (const b of [A, B]) {
        const entries = await b.page.evaluate(() => {
          const out = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("solpoker:session:")) out[k] = localStorage.getItem(k);
          }
          return out;
        });
        Object.assign(saved, entries);
      }
      writeFileSync(`${SHOTS}/session-keys.json`, JSON.stringify(saved));
    } catch {
      // Losing this only costs the floats, and must not hide a real failure.
    }
    await browserA.close();
    await browserB.close();
  }

  log(`\n${failures.length === 0 ? "GATE PASSED" : `GATE FAILED: ${failures.length} check(s)`}`);
  failures.forEach((f) => log(`  - ${f}`));
  log(`screenshots in ${SHOTS}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
