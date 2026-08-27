import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { Keypair, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
const INJECT = readFileSync("scripts/inject-wallet.js", "utf8");
const secrets = JSON.parse(readFileSync("/tmp/solpoker-session/session-wallets.json","utf8"));
const b = await chromium.launch();
const logs = [];
async function open(idx, name) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(secrets[idx]));
  const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  page.on("console", m => logs.push(`[${name}/${m.type()}] ${m.text().slice(0,300)}`));
  page.on("pageerror", e => logs.push(`[${name}/pageerror] ${String(e).slice(0,300)}`));
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
  await page.goto("http://localhost:3000/lobby", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /test wallet/i }).first().click().catch(()=>{});
  await page.waitForTimeout(5000);
  await page.goto("http://localhost:3000/table/1787824632828380", { waitUntil: "networkidle" });
  await page.waitForTimeout(12000);
  return { name, page };
}
const A = await open(0,"A"), B = await open(1,"B");
for (const p of [A,B]) {
  for (let i=0;i<3;i++){
    if (await p.page.getByRole("button",{name:/^continue$/i}).first().isVisible().catch(()=>false)) {
      await p.page.getByRole("button",{name:/^continue$/i}).first().click().catch(()=>{}); await p.page.waitForTimeout(8000);
    } else if (await p.page.getByRole("button",{name:/authorise session key/i}).first().isVisible().catch(()=>false)) {
      await p.page.getByRole("button",{name:/authorise session key/i}).first().click().catch(()=>{}); await p.page.waitForTimeout(8000);
    } else break;
  }
}
console.log("A buttons:", JSON.stringify(await A.page.$$eval("button", e=>e.map(x=>(x.textContent||"").trim()).filter(Boolean))));
logs.length = 0;
console.log("\n--- clicking Start playing on A ---");
await A.page.getByRole("button",{name:/start playing/i}).first().click().catch(e=>console.log("click err", e.message));
await A.page.waitForTimeout(45000);
console.log("A debug:", JSON.stringify(await A.page.evaluate(()=>window.__pokerableDebug?.()??null)));
console.log("A text:", (await A.page.evaluate(()=>document.body.innerText.replace(/\s+/g," "))).slice(0,260));
console.log("\nLOGS:"); logs.slice(-30).forEach(l=>console.log("  ",l));
await A.page.screenshot({ path: "/tmp/solpoker-shots/start.png" });
await b.close();
