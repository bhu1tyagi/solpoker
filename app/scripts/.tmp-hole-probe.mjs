// Can each seated wallet read ITS OWN hole account on the mainnet TEE?
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58pkg from "bs58";
const bs58 = bs58pkg.default ?? bs58pkg;
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const TEE = "https://mainnet-tee.magicblock.app";
const enc = (s) => new TextEncoder().encode(s);
const pda = (...s) => PublicKey.findProgramAddressSync(s, P)[0];
const idBuf = Buffer.alloc(8); idBuf.writeBigUInt64LE(1787508451601819n);
const table = pda(enc("table"), idBuf);
const gates = JSON.parse(readFileSync("/tmp/solpoker-gate/gate-wallets.json", "utf8"))
  .map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
async function teeAs(kp) {
  const r = await fetch(`${TEE}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`);
  const { challenge } = await r.json();
  const sig = nacl.sign.detached(enc(challenge), kp.secretKey);
  const l = await fetch(`${TEE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge, signature: bs58.encode(sig) }) });
  return new Connection(`${TEE}?token=${(await l.json()).token}`, "confirmed");
}
for (let seat = 0; seat < 2; seat++) {
  const hole = pda(enc("hole"), table.toBuffer(), Buffer.from([seat]));
  for (let g = 0; g < 2; g++) {
    const conn = await teeAs(gates[g]);
    const info = await conn.getAccountInfo(hole).catch((e) => ({ err: String(e).slice(0, 60) }));
    const who = gates[g].publicKey.toBase58().slice(0, 6);
    if (info && !info.err) console.log(`seat ${seat} read by ${who}: DATA len ${info.data.length}, cards ${info.data[49]},${info.data[50]}`);
    else console.log(`seat ${seat} read by ${who}: ${info ? info.err : "null (denied or absent)"}`);
  }
}
