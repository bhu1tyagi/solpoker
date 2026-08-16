#!/usr/bin/env node
/**
 * Remove every table, wherever it is in its lifecycle.
 *
 * Everything here rides on the permissionless design: a stuck hand can be
 * driven to settlement with the clock alone, an idle table can be undelegated
 * by anyone once its cards are wiped, a game-stale seat can be sent home with
 * its chips by anyone, and a stale husk can be closed with the rent going to
 * its creator. Nobody's chips move anywhere except back to their own balance.
 *
 *   node scripts/wipe-tables.mjs
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
const kp = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);
const base = new Connection(RPC, "confirmed");
const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const retry = async (fn, tries = 5) => {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
};

async function teeConn() {
  const res = await fetch(`${TEE}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`);
  const { challenge } = await res.json();
  const sig = nacl.sign.detached(enc(challenge), kp.secretKey);
  const login = await fetch(`${TEE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge, signature: bs58.encode(sig) }),
  });
  const { token } = await login.json();
  return new Connection(`${TEE}?token=${token}`, { commitment: "confirmed" });
}

const send = async (conn, ix, label) => {
  const tx = new Transaction().add(ix);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`${label}: ${JSON.stringify(conf.value.err)}`);
};

const dv = (d) => new DataView(d.buffer, d.byteOffset, d.byteLength);

async function main() {
  const er = await teeConn();
  const baseProgram = new Program(idl, new AnchorProvider(base, new Wallet(kp), { commitment: "confirmed" }));
  const erProgram = new Program(idl, new AnchorProvider(er, new Wallet(kp), { commitment: "confirmed" }));

  const disc = bs58.encode(Buffer.from([34, 100, 138, 97, 236, 129, 230, 112]));
  const [own, del] = await Promise.all([
    retry(() => base.getProgramAccounts(P, { filters: [{ memcmp: { offset: 0, bytes: disc } }] })),
    retry(() => base.getProgramAccounts(DELEG, { filters: [{ memcmp: { offset: 0, bytes: disc } }] })),
  ]);
  const candidates = [...own, ...del].filter((a) => {
    const d = a.account.data;
    if (d.length < 16) return false;
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(dv(d).getBigUint64(8, true));
    return pda(enc("table"), b).equals(a.pubkey);
  });
  console.log(`${candidates.length} tables to remove`);

  for (const a of candidates) {
    const d = a.account.data;
    const tableId = Number(dv(d).getBigUint64(8, true));
    const table = a.pubkey;
    const config = new PublicKey(d.subarray(16, 48));
    const hand = pda(enc("hand"), table.toBuffer());
    const deck = pda(enc("deck"), table.toBuffer());
    const seats = Array.from({ length: 6 }, (_, i) => pda(enc("seat"), table.toBuffer(), Buffer.from([i])));
    const holes = Array.from({ length: 6 }, (_, i) => pda(enc("hole"), table.toBuffer(), Buffer.from([i])));
    const delegated = a.account.owner.equals(DELEG);
    console.log(`\ntable ${tableId} ${delegated ? "(delegated)" : ""}`);

    try {
      if (delegated) {
        // A hand may be stuck mid-flight. The clock can finish it without any
        // player: time out whoever is to act until the street closes, turn the
        // streets, settle. All permissionless.
        const seatMap = { seat0: seats[0], seat1: seats[1], seat2: seats[2], seat3: seats[3], seat4: seats[4], seat5: seats[5] };
        for (let guard = 0; guard < 60; guard++) {
          const hi = await er.getAccountInfo(hand).catch(() => null);
          const ti = await er.getAccountInfo(table).catch(() => null);
          if (!hi || !ti) break;
          const state = ti.data[249];
          const toAct = hi.data[70];
          const street = hi.data[48];
          if (state === 0) break;
          if (toAct !== 0xff) {
            const deadline = Number(dv(new Uint8Array(hi.data)).getBigInt64(74, true));
            const wait = deadline - Math.floor(Date.now() / 1000) + 2;
            if (wait > 0) await sleep(Math.min(wait, 35) * 1000);
            await send(er, await erProgram.methods.forceTimeout()
              .accountsPartial({ hand, config, ...seatMap, payer: kp.publicKey }).instruction(), "timeout").catch(() => {});
          } else if (street < 4) {
            await send(er, await erProgram.methods.advanceStreet()
              .accountsPartial({ hand, config, deck, ...seatMap, payer: kp.publicKey }).instruction(), "advance").catch(() => {});
          } else {
            await send(er, await erProgram.methods.settleHand()
              .accountsPartial({ table, config, hand, deck, ...seatMap, payer: kp.publicKey })
              .remainingAccounts(holes.map((h) => ({ pubkey: h, isWritable: true, isSigner: false })))
              .instruction(), "settle").catch(() => {});
          }
          await sleep(1000);
        }

        await send(er, await erProgram.methods.undelegateCore()
          .accountsPartial({ payer: kp.publicKey, table, hand, deck }).instruction(), "undelegate core");
        for (let i = 0; i < 6; i++) {
          await send(er, await erProgram.methods.undelegateSeat()
            .accountsPartial({ payer: kp.publicKey, seat: seats[i], hole: holes[i] }).instruction(), `undelegate seat ${i}`);
        }
        const all = [table, ...seats];
        for (let t = 0; t < 60; t++) {
          const infos = await base.getMultipleAccountsInfo(all);
          if (infos.every((i) => i?.owner.equals(P))) break;
          await sleep(1000);
        }
        console.log("  brought back to the base layer");
      }

      // Send everyone home with their chips. Creator when it is ours, the
      // staleness rule otherwise.
      const fresh = await retry(() => base.getAccountInfo(table));
      for (let i = 0; i < 6; i++) {
        const occ = fresh.data.subarray(48 + i * 32, 80 + i * 32);
        if (occ.every((b) => b === 0)) continue;
        const occupant = new PublicKey(occ);
        await send(base, await baseProgram.methods.vacateSeat(i).accountsPartial({
          table,
          config,
          hand,
          seat: seats[i],
          player: pda(enc("player"), occupant.toBuffer()),
          payer: kp.publicKey,
        }).instruction(), `vacate ${i}`)
          .then(() => console.log(`  seat ${i}: chips returned to ${occupant.toBase58().slice(0, 6)}`))
          .catch((e) => console.log(`  seat ${i}: ${String(e).slice(0, 110)}`));
      }

      const cfgInfo = await retry(() => base.getAccountInfo(config));
      const creator = cfgInfo && cfgInfo.data.length >= 48
        ? new PublicKey(cfgInfo.data.subarray(16, 48))
        : kp.publicKey;
      await send(base, await baseProgram.methods.closeTable().accountsPartial({
        table,
        config,
        hand,
        deck,
        history: pda(enc("history"), table.toBuffer()),
        payer: kp.publicKey,
        creator,
      }).remainingAccounts(
        [...seats, ...holes].map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })),
      ).instruction(), "close");
      console.log("  deleted");
    } catch (e) {
      console.log(`  left in place: ${String(e).slice(0, 130)}`);
    }
  }

  const after = await retry(() =>
    base.getProgramAccounts(P, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }),
  );
  const afterDel = await retry(() =>
    base.getProgramAccounts(DELEG, { filters: [{ memcmp: { offset: 0, bytes: disc } }] }),
  );
  const remaining = [...after, ...afterDel].filter((a) => {
    const d = a.account.data;
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(dv(d).getBigUint64(8, true));
    return pda(enc("table"), b).equals(a.pubkey);
  });
  console.log(`\n${remaining.length} table(s) remain`);
}

await main();
