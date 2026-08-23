// Prints one line: the mainnet-tee VRF queue's nonzero byte count.
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58pkg from "bs58";
const bs58 = bs58pkg.default ?? bs58pkg;
const Q = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8"))));
const enc = (s) => new TextEncoder().encode(s);
const url = "https://mainnet-tee.magicblock.app";
const r = await fetch(url + "/auth/challenge?pubkey=" + kp.publicKey.toBase58());
const { challenge } = await r.json();
const sig = nacl.sign.detached(enc(challenge), kp.secretKey);
const l = await fetch(url + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge, signature: bs58.encode(sig) }) });
const c = new Connection(url + "?token=" + (await l.json()).token, "confirmed");
const d = (await c.getAccountInfo(Q)).data;
console.log(d.filter((b) => b !== 0).length);
