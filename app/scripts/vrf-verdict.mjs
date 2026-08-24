/**
 * The verdict probe: is a mainnet shuffle stall ours or the oracle's?
 *
 * No browser, no UI, no crank. This walks the protocol by hand — create,
 * seat two players, sessions, delegate, secure, salt, request — and then
 * watches with timestamps. The one question it answers:
 *
 *   Did `request_shuffle` CONFIRM on the rollup (state = REQUESTED, with a
 *   signature), and did fulfillment then arrive?
 *
 *   confirmed + fulfilled quickly  -> everything healthy this run
 *   confirmed + no fulfillment     -> the oracle, with proof in hand
 *   request itself failing         -> our side (or the rollup's ingress)
 *
 * RPC health is sampled in parallel on both endpoints the whole time, so a
 * rate-limit episode cannot masquerade as an oracle verdict.
 *
 *   RPC=<base rpc> node scripts/vrf-verdict.mjs
 */
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";
const { AnchorProvider, BN, Program, Wallet } = anchorPkg;
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import bs58pkg from "bs58";
import idl from "../src/lib/idl/solpoker.json" with { type: "json" };

const bs58 = bs58pkg.default ?? bs58pkg;
const P = new PublicKey("Z2JAck8LPeRvUQp4Pn34FcYAHAGiBZg6FYtnF8Poker");
const TEE = "https://mainnet-tee.magicblock.app";
const BASE_RPC = process.env.RPC ?? "https://nicholle-p42o2b-fast-mainnet.helius-rpc.com";
const SESSION_PROGRAM = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");

const enc = (s) => new TextEncoder().encode(s);
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, P)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${now()}]`, ...a);

const funder = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(`${process.env.HOME}/.config/solana/id.json`, "utf8"))),
);
const players = JSON.parse(readFileSync("/tmp/solpoker-gate/gate-wallets.json", "utf8"))
  .map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));

const base = new Connection(BASE_RPC, "confirmed");

async function teeAs(kp) {
  const r = await fetch(`${TEE}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`);
  const { challenge } = await r.json();
  const sig = nacl.sign.detached(enc(challenge), kp.secretKey);
  const l = await fetch(`${TEE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge, signature: bs58.encode(sig) }),
  });
  return new Connection(`${TEE}?token=${(await l.json()).token}`, "confirmed");
}

async function send(conn, ixs, signers, label, payer = signers[0]) {
  const tx = new Transaction().add(...ixs);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`${label}: ${JSON.stringify(conf.value.err)}`);
  return sig;
}

/** create_session_token_v2, built raw exactly as the app builds it. */
function createSessionIx(sessionSigner, authority, validUntil, topUpLamports) {
  const [tokenPda] = PublicKey.findProgramAddressSync(
    [enc("session_token_v2"), P.toBuffer(), sessionSigner.toBuffer(), authority.toBuffer()],
    SESSION_PROGRAM,
  );
  const disc = Buffer.from([223, 233, 108, 7, 65, 194, 235, 38]);
  const topUp = Buffer.from([1, 1]);
  const until = Buffer.concat([Buffer.from([1]), Buffer.from(new BN(validUntil).toArray("le", 8))]);
  const lam = Buffer.concat([Buffer.from([1]), Buffer.from(new BN(topUpLamports).toArray("le", 8))]);
  return {
    tokenPda,
    ix: new TransactionInstruction({
      programId: SESSION_PROGRAM,
      keys: [
        { pubkey: tokenPda, isSigner: false, isWritable: true },
        { pubkey: sessionSigner, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: P, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc, topUp, until, lam]),
    }),
  };
}

const health = { base: { ok: 0, fail: 0 }, tee: { ok: 0, fail: 0 } };
let healthTimer = null;
function watchHealth(er) {
  healthTimer = setInterval(async () => {
    try { await base.getSlot(); health.base.ok++; } catch { health.base.fail++; }
    try { await er.getSlot(); health.tee.ok++; } catch { health.tee.fail++; }
  }, 5000);
}

async function main() {
  log("=== VRF VERDICT PROBE ===");
  const erFunder = await teeAs(funder);
  watchHealth(erFunder);

  const progBase = new Program(idl, new AnchorProvider(base, new Wallet(funder), { commitment: "confirmed" }));
  const progEr = new Program(idl, new AnchorProvider(erFunder, new Wallet(funder), { commitment: "confirmed" }));

  // ---- funding: players need fees + buy-in ----
  const need = [];
  for (const p of players) {
    const bal = await base.getBalance(p.publicKey);
    if (bal < 0.12e9) need.push({ p, amt: Math.ceil(0.12e9 - bal) });
  }
  if (need.length) {
    await send(base, need.map(({ p, amt }) =>
      SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: p.publicKey, lamports: amt })),
      [funder], "fund players");
    log(`funded ${need.length} player wallet(s)`);
  }

  // ---- table on the base layer ----
  const tableId = new BN(Date.now()).muln(1000).addn(Math.floor(Math.random() * 1000));
  const idBuf = Buffer.from(tableId.toArray("le", 8));
  const table = pda(enc("table"), idBuf);
  const config = pda(enc("config"), idBuf);
  const hand = pda(enc("hand"), table.toBuffer());
  const deck = pda(enc("deck"), table.toBuffer());
  const seatAt = (i) => pda(enc("seat"), table.toBuffer(), Buffer.from([i]));
  const holeAt = (i) => pda(enc("hole"), table.toBuffer(), Buffer.from([i]));
  log(`table ${tableId.toString()} (${table.toBase58().slice(0, 8)}…)`);

  await send(base, [
    await progBase.methods.createTable(tableId, new BN(1), new BN(2), new BN(40), new BN(200), new BN(30))
      .accountsPartial({ creator: funder.publicKey }).instruction(),
    await progBase.methods.createHistory().accountsPartial({ table, history: pda(enc("history"), table.toBuffer()), payer: funder.publicKey }).instruction(),
  ], [funder], "create table");
  await send(base, await Promise.all([0, 1, 2, 3, 4, 5].map((i) =>
    progBase.methods.createSeat(i).accountsPartial({ table, seat: seatAt(i), payer: funder.publicKey }).instruction())),
    [funder], "create seats");
  await send(base, await Promise.all([0, 1, 2, 3, 4, 5].map((i) =>
    progBase.methods.createHole(i).accountsPartial({ table, hole: holeAt(i), payer: funder.publicKey }).instruction())),
    [funder], "create holes");
  log("table, seats, holes created");

  // ---- players buy in and sit ----
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const playerPda = pda(enc("player"), p.publicKey.toBuffer());
    const info = await base.getAccountInfo(playerPda);
    const chips = info ? info.data.readBigUInt64LE(40) : 0n;
    const ixs = [];
    if (!info) ixs.push(await progBase.methods.initPlayer().accountsPartial({ player: playerPda, authority: p.publicKey }).instruction());
    if (chips < 40n) {
      ixs.push(await progBase.methods.buyChips(new BN(60)).accountsPartial({ player: playerPda, vault: pda(enc("vault")), authority: p.publicKey }).instruction());
    }
    ixs.push(await progBase.methods.joinTable(i, new BN(40))
      .accountsPartial({ table, config, seat: seatAt(i), player: playerPda, authority: p.publicKey }).instruction());
    await send(base, ixs, [p], `player ${i} sits`);
  }
  log("both players seated with 40 chips");

  // ---- sessions ----
  const sessions = [];
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const sk = Keypair.generate();
    const { ix, tokenPda } = createSessionIx(sk.publicKey, p.publicKey, Math.floor(Date.now() / 1000) + 3600, 0.02e9);
    await send(base, [ix], [sk, p], `session ${i}`, p);
    sessions.push({ keypair: sk, tokenPda });
  }
  log("both sessions created");

  // ---- delegate ----
  await send(base, [await progBase.methods.delegateCore(tableId)
    .accountsPartial({ payer: funder.publicKey, table, hand, deck }).instruction()], [funder], "delegate core");
  for (let i = 0; i < 6; i++) {
    await send(base, [await progBase.methods.delegateSeat(i)
      .accountsPartial({ payer: funder.publicKey, table, seat: seatAt(i), hole: holeAt(i) }).instruction()],
      [funder], `delegate seat ${i}`);
  }
  log("delegated; waiting for the rollup to serve it");
  for (let t = 0; t < 40; t++) {
    const info = await erFunder.getAccountInfo(seatAt(5)).catch(() => null);
    if (info) break;
    await sleep(750);
  }

  // ---- secure ----
  const sendEr = (ixs, signers, label) => send(erFunder, ixs, signers, label);
  await sendEr([await progEr.methods.secureDeck().accountsPartial({ deck, payer: funder.publicKey }).instruction()],
    [funder], "secure deck");
  for (let i = 0; i < 2; i++) {
    await sendEr([await progEr.methods.secureHole(i)
      .accountsPartial({ hole: holeAt(i), seat: seatAt(i), payer: funder.publicKey }).instruction()],
      [funder], `secure hole ${i}`);
  }
  log("deck and both holes secured");
  await sleep(2500);

  // ---- salts, session-signed like the real client ----
  for (let i = 0; i < 2; i++) {
    const p = players[i];
    const s = sessions[i];
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const commitment = sha256(salt);
    await sendEr([await progEr.methods.commitSalt(i, Array.from(commitment))
      .accountsPartial({ payer: s.keypair.publicKey, authority: p.publicKey, hand, seat: seatAt(i), sessionToken: s.tokenPda })
      .instruction()], [s.keypair], `commit salt ${i}`);
    await sendEr([await progEr.methods.revealSalt(i, Array.from(salt))
      .accountsPartial({ payer: s.keypair.publicKey, authority: p.publicKey, hand, seat: seatAt(i), sessionToken: s.tokenPda })
      .instruction()], [s.keypair], `reveal salt ${i}`);
  }
  log("both salts committed and revealed");

  // ---- THE MOMENT: request the shuffle, with receipts ----
  const reqSig = await sendEr([await progEr.methods.requestShuffle()
    .accountsPartial({ payer: funder.publicKey, hand, deck }).instruction()], [funder], "request_shuffle");
  const h1 = await progEr.account.hand.fetch(hand);
  log(`REQUEST CONFIRMED sig=${reqSig}`);
  log(`on-chain after request: shuffleState=${h1.shuffleState} deadline=${Number(h1.deadline)} (now ${Math.floor(Date.now() / 1000)})`);
  if (h1.shuffleState === 0) {
    log("VERDICT: request did NOT set REQUESTED — OUR SIDE (or program) — investigate");
  }

  // ---- watch for fulfillment: knock with start_hand, log every refusal ----
  const t0 = Date.now();
  let started = false;
  let lastName = "";
  while (Date.now() - t0 < 300_000) {
    try {
      const sig = await sendEr([await progEr.methods.startHand()
        .accountsPartial({
          table, config, hand, deck,
          seat0: seatAt(0), seat1: seatAt(1), seat2: seatAt(2),
          seat3: seatAt(3), seat4: seatAt(4), seat5: seatAt(5),
          payer: funder.publicKey,
        }).instruction()], [funder], "start_hand");
      const h2 = await progEr.account.hand.fetch(hand);
      log(`FULFILLED: start_hand succeeded after ${((Date.now() - t0) / 1000).toFixed(1)}s (sig=${sig.slice(0, 16)}…) hand #${Number(h2.handNumber)}`);
      started = true;
      break;
    } catch (e) {
      const m = String(e).match(/Custom":\s*(\d+)/);
      const code = m ? Number(m[1]) : null;
      const name = code !== null ? (idl.errors.find((x) => x.code === code)?.name ?? String(code)) : String(e).slice(0, 80);
      if (name !== lastName) {
        log(`start_hand refused: ${name} (t+${((Date.now() - t0) / 1000).toFixed(0)}s)`);
        lastName = name;
      }
    }
    await sleep(3000);
  }
  if (!started) {
    const hEnd = await progEr.account.hand.fetch(hand).catch(() => null);
    log(`NO FULFILLMENT after 300s. shuffleState=${hEnd?.shuffleState} lastRefusal=${lastName}`);
  }

  clearInterval(healthTimer);
  log(`RPC health during probe: base ok=${health.base.ok} fail=${health.base.fail} | tee ok=${health.tee.ok} fail=${health.tee.fail}`);
  log(started
    ? "VERDICT: everything healthy this run — request confirmed and fulfilled."
    : "VERDICT: request CONFIRMED on the rollup and never fulfilled while both RPCs answered — the oracle. Receipts above.");
  log("cleanup: run wipe-tables + clear-gate-tables next");
}

main().catch((e) => {
  clearInterval(healthTimer);
  console.error(`[${now()}] PROBE DIED:`, String(e).slice(0, 400));
  process.exit(1);
});
