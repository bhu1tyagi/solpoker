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
page.on("console", m => logs.push(`[${m.type()}] ${m.text().slice(0,220)}`));
page.on("pageerror", e => logs.push(`[pageerror] ${String(e).slice(0,220)}`));
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

await page.goto("http://localhost:3000/table/1787824632828380", { waitUntil: "networkidle" });
await page.waitForTimeout(15000);
const buttons = await page.$$eval("button", els => els.map(e => (e.textContent||"").trim()).filter(Boolean));
console.log("BUTTONS:", JSON.stringify(buttons));
console.log("\nDEBUG:", JSON.stringify(await page.evaluate(() => window.__pokerableDebug?.() ?? null)));
const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g," ").slice(0,700));
console.log("\nTEXT:", txt);
console.log("\nLOGS:"); logs.slice(-18).forEach(l => console.log(" ", l));
await page.screenshot({ path: "/tmp/solpoker-shots/diag-table.png" });
await b.close();
