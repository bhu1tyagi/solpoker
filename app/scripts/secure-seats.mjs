#!/usr/bin/env node
/**
 * Point every occupied seat's hole-card permission at whoever is sitting in it.
 *
 * Sitting down clears that flag on chain, because a permission still naming the
 * previous occupant would let them read the next player's cards, and
 * `start_hand` refuses to deal to a seat without it. The crank does this by
 * itself now; this exists for tables that were already stuck when that landed,
 * and as a way to unwedge one by hand.
 *
 * A stuck table is worse than it looks. Once the VRF has been fulfilled the
 * deck holds randomness, and undelegating a deck that holds randomness is
 * refused, so a table that cannot start a hand also cannot be paused or
 * deleted. Securing the seats is what lets the hand run and the table come back.
 *
 * `secure_hole` is permissionless and rebuilds the member list from the seat
 * each time, so running this against a healthy table changes nothing.
 *
 *   node scripts/secure-seats.mjs
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import bs58 from "bs58";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const RPC = "https://rpc.magicblock.app/devnet";
const TEE = "https://devnet-tee.magicblock.app";
const P = new PublicKey("4f8UE9BfWnAMLpYwpxJCNFD6HEmHwNQLtmQfhKW45tZ9");
const DELEG = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");

const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);
const base = new Connection(RPC, "confirmed");
const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];

async function teeConn() {
  const res = await fetch(`${TEE}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`);
  const { challenge } = await res.json();
  const sig = nacl.sign.detached(enc(challenge), kp.secretKey);
  const login = await fetch(`${TEE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: kp.publicKey.toBase58(),
      challenge,
      signature: bs58.encode(sig),
    }),
  });
  const { token } = await login.json();
  return new Connection(`${TEE}?token=${token}`, { commitment: "confirmed" });
}

async function main() {
  const er = await teeConn();
  const program = new Program(idl, new AnchorProvider(er, new Wallet(kp), { commitment: "confirmed" }));

  // Tables live under the delegation program while they are delegated, which is
  // the only state where any of this applies.
  const disc = bs58.encode(Buffer.from([34, 100, 138, 97, 236, 129, 230, 112]));
  const delegated = await base.getProgramAccounts(DELEG, {
    filters: [{ memcmp: { offset: 0, bytes: disc } }],
  });
  if (!delegated.length) {
    console.log("no delegated tables");
    return;
  }

  for (const t of delegated) {
    const tableId = t.account.data.readBigUInt64LE(8);
    const table = pda(new TextEncoder().encode("table"), Buffer.from(new BigUint64Array([tableId]).buffer));
    if (table.toBase58() !== t.pubkey.toBase58()) continue;
    console.log(`table ${tableId}`);

    for (let i = 0; i < 6; i++) {
      const seatPda = pda(enc("seat"), table.toBuffer(), Buffer.from([i]));
      const info = await er.getAccountInfo(seatPda);
      if (!info) continue;
      const d = info.data;
      const occupied = !d.subarray(41, 73).every((b) => b === 0);
      const secured = d.length > 176 && d[176] === 1;
      if (!occupied || secured) continue;

      const hole = pda(enc("hole"), table.toBuffer(), Buffer.from([i]));
      // Note the trailing colon in the seed; it is part of the access-control
      // program's layout, not a typo.
      const permission = PublicKey.findProgramAddressSync(
        [enc("permission:"), hole.toBytes()],
        PERMISSION_PROGRAM,
      )[0];
      const ix = await program.methods
        .secureHole(i)
        .accountsPartial({
          hole,
          seat: seatPda,
          permission,
          permissionProgram: PERMISSION_PROGRAM,
          ephemeralVault: EPHEMERAL_VAULT,
          magicProgram: MAGIC_PROGRAM,
          payer: kp.publicKey,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      const bh = await er.getLatestBlockhash();
      tx.feePayer = kp.publicKey;
      tx.recentBlockhash = bh.blockhash;
      tx.sign(kp);
      const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      const conf = await er.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      console.log(`  seat ${i}: ${conf.value.err ? JSON.stringify(conf.value.err) : "secured"}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
