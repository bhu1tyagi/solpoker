import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
const INJECT = readFileSync("scripts/inject-wallet.js", "utf8");
const kp = Keypair.fromSecretKey(Uint8Array.from(
  JSON.parse(readFileSync("/tmp/solpoker-session/session-wallets.json","utf8"))[0]));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const logs = [];
page.on("console", m => { const t=m.text(); if(/error|fail|session|start|delegat/i.test(t)) logs.push(`[${m.type()}] ${t.slice(0,240)}`); });
page.on("pageerror", e => logs.push(`[pageerror] ${String(e).slice(0,240)}`));
await page.exposeFunction("__testSignTransaction", (bytes) => {
  const tx = Transaction.from(Buffer.from(bytes));
  tx.partialSign(kp);
  return Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
});
await page.exposeFunction("__testSignMessage", (bytes) =>
  Array.from(nacl.sign.detached(Uint8Array.from(bytes), kp.secretKey)));
await page.addInitScript(({address,bytes,script}) => {
  window.__TEST_WALLET_ADDRESS__ = address;
  window.__TEST_WALLET_PUBKEY_BYTES__ = bytes;
  window.eval(script);
}, { address: kp.publicKey.toBase58(), bytes: Array.from(kp.publicKey.toBytes()), script: INJECT });

// Connect first, on the lobby, the way a player would.
await page.goto("http://localhost:3000/lobby", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /test wallet/i }).first().click().catch(()=>{});
await page.waitForTimeout(6000);
console.log("after connect, lobby debug:", JSON.stringify(await page.evaluate(() => window.__pokerableDebug?.() ?? null)));

await page.goto("http://localhost:3000/table/1787824632828380", { waitUntil: "networkidle" });
await page.waitForTimeout(14000);
console.log("\ntable debug:", JSON.stringify(await page.evaluate(() => window.__pokerableDebug?.() ?? null)));
console.log("BUTTONS:", JSON.stringify(await page.$$eval("button", els => els.map(e=>(e.textContent||"").trim()).filter(Boolean))));
console.log("\nTEXT:", await page.evaluate(() => document.body.innerText.replace(/\s+/g," ").slice(0,500)));
console.log("\nLOGS:"); logs.slice(-15).forEach(l=>console.log("  ",l));
await page.screenshot({ path: "/tmp/solpoker-shots/diag2.png" });
await b.close();
