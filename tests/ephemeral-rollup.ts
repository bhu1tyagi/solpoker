/**
 * Phases 3 to 5: a full hand on the rollup, with hidden cards and a verifiable
 * shuffle.
 *
 * Proves, in order:
 *   - the table delegates to the TEE rollup and comes back
 *   - the deck is readable by nobody and hole cards only by their owner
 *   - salts plus VRF fix a shuffle seed nobody controls
 *   - a full hand plays out with actions signed by session keys
 *   - settlement pays the pot, reveals only showdown hands, and wipes the rest
 *   - the published hand history reproduces the exact deck
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Solpoker } from "../target/types/solpoker";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  GetCommitmentSignature,
  getAuthToken,
  verifyTeeRpcIntegrity,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import * as nacl from "tweetnacl";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { assert } from "chai";

const MAX_SEATS = 6;
const SEATED = 3;
const BUY_IN = 1_000;
const SB = new BN(5);
const BB = new BN(10);

const VALIDATOR = new PublicKey(
  process.env.VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);
// The delegated queue, since the request runs inside the rollup.
const ORACLE_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);
const PERMISSION_PROGRAM = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);
const MAGIC_PROGRAM = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);
const EPHEMERAL_VAULT = new PublicKey(
  "MagicVau1t999999999999999999999999999999999",
);
const DELEGATION_PROGRAM = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const card = (b: number) =>
  b === 0xff ? "--" : `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}`;
const hex = (b: Uint8Array | number[]) => Buffer.from(b as any).toString("hex");

describe("SolPoker Phases 3-5: private cards and a verifiable shuffle", () => {
  const erUrl =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
    "https://devnet-tee.magicblock.app";

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Solpoker as Program<Solpoker>;
  const connection = provider.connection;

  let erConnection: anchor.web3.Connection;
  let erProgram: Program<Solpoker>;
  /** One authenticated TEE connection per player, plus an unrelated snooper. */
  const asPlayer: anchor.web3.Connection[] = [];
  let asSnooper: anchor.web3.Connection;

  const players = Array.from({ length: SEATED }, () => Keypair.generate());
  const sessionKeys = Array.from({ length: SEATED }, () => Keypair.generate());
  const sessionTokens: (PublicKey | null)[] = [null, null, null];
  const snooper = Keypair.generate();
  const salts = Array.from({ length: SEATED }, () => randomBytes(32));

  const tableId = new BN(Math.floor(Date.now() / 1000));
  const pda = (s: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(s, program.programId)[0];

  const config = pda([Buffer.from("config"), tableId.toArrayLike(Buffer, "le", 8)]);
  const table = pda([Buffer.from("table"), tableId.toArrayLike(Buffer, "le", 8)]);
  const seats = Array.from({ length: MAX_SEATS }, (_, i) =>
    pda([Buffer.from("seat"), table.toBuffer(), Buffer.from([i])]),
  );
  const holes = Array.from({ length: MAX_SEATS }, (_, i) =>
    pda([Buffer.from("hole"), table.toBuffer(), Buffer.from([i])]),
  );
  const handPda = pda([Buffer.from("hand"), table.toBuffer()]);
  const deckPda = pda([Buffer.from("deck"), table.toBuffer()]);
  const playerPda = (o: PublicKey) => pda([Buffer.from("player"), o.toBuffer()]);
  const permissionPda = (account: PublicKey) => permissionPdaFromAccount(account);

  const seatAccounts = {
    seat0: seats[0], seat1: seats[1], seat2: seats[2],
    seat3: seats[3], seat4: seats[4], seat5: seats[5],
  };
  const permAccounts = {
    permissionProgram: PERMISSION_PROGRAM,
    ephemeralVault: EPHEMERAL_VAULT,
    magicProgram: MAGIC_PROGRAM,
  };

  const latencies: number[] = [];

  async function retry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (!/Blockhash not found|block height exceeded|429|timed out|fetch failed|socket hang up/i.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw new Error(`${label} failed after ${tries} attempts: ${last}`);
  }

  async function sendEr(tx: Transaction, signers: Keypair[], label: string, record = false) {
    const started = Date.now();
    tx.feePayer = signers[0].publicKey;
    const bh = await erConnection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.sign(...signers);
    const sig = await erConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    // confirmTransaction resolves for failed transactions too, so check the error.
    const conf = await erConnection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) {
      const d = await erConnection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}\n${(d?.meta?.logMessages ?? []).join("\n")}`);
    }
    const ms = Date.now() - started;
    if (record) latencies.push(ms);
    console.log(`    ${String(ms).padStart(4)}ms (ER) ${label}`);
    return sig;
  }

  /** Try to read an account over a given TEE connection. */
  async function tryRead(conn: anchor.web3.Connection, key: PublicKey) {
    try {
      const info = await conn.getAccountInfo(key);
      return info === null
        ? { allowed: false, detail: "null" }
        : { allowed: true, detail: `${info.data.length} bytes` };
    } catch (e: any) {
      return { allowed: false, detail: `error: ${e.message ?? e}` };
    }
  }

  async function teeConnection(kp: Keypair) {
    const auth = await getAuthToken(erUrl, kp.publicKey, (m: Uint8Array) =>
      Promise.resolve(nacl.sign.detached(m, kp.secretKey)),
    );
    return new anchor.web3.Connection(`${erUrl}?token=${auth.token}`, { commitment: "confirmed" });
  }

  before(async function () {
    this.timeout(300_000);
    console.log("ER:      ", erUrl);
    console.log("Program: ", program.programId.toBase58());
    console.log("Table id:", tableId.toString());

    for (const p of [...players, ...sessionKeys, snooper]) {
      const sig = await connection.requestAirdrop(p.publicKey, 0.05 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }

    await verifyTeeRpcIntegrity(erUrl);
    const wallet = provider.wallet as anchor.Wallet;
    erConnection = await teeConnection(wallet.payer);
    erProgram = new Program<Solpoker>(
      program.idl as any,
      new anchor.AnchorProvider(erConnection, wallet, { commitment: "confirmed" }),
    );
    for (const p of players) asPlayer.push(await teeConnection(p));
    asSnooper = await teeConnection(snooper);
    console.log("  TEE attested; 5 authenticated connections open");
  });

  it("sets up the table on the base layer", async function () {
    this.timeout(400_000);
    for (const p of players) {
      await retry(() => program.methods.initPlayer().accounts({ authority: p.publicKey }).signers([p]).rpc({ commitment: "confirmed" }), "initPlayer");
      await retry(() => program.methods.claimFaucet().accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey }).signers([p]).rpc({ commitment: "confirmed" }), "faucet");
    }
    await retry(() => program.methods.createTable(tableId, SB, BB, new BN(200), new BN(2_000))
      .accountsPartial({ config, table, hand: handPda, deck: deckPda, creator: provider.wallet.publicKey })
      .rpc({ commitment: "confirmed" }), "createTable");

    for (let i = 0; i < MAX_SEATS; i++) {
      await retry(() => program.methods.createSeat(i).accountsPartial({ table, seat: seats[i], payer: provider.wallet.publicKey }).rpc({ commitment: "confirmed" }), `seat ${i}`);
      await retry(() => program.methods.createHole(i).accountsPartial({ table, hole: holes[i], payer: provider.wallet.publicKey }).rpc({ commitment: "confirmed" }), `hole ${i}`);
    }
    for (let i = 0; i < SEATED; i++) {
      await retry(() => program.methods.joinTable(i, new BN(BUY_IN))
        .accountsPartial({ table, config, seat: seats[i], player: playerPda(players[i].publicKey), authority: players[i].publicKey })
        .signers([players[i]]).rpc({ commitment: "confirmed" }), `join ${i}`);
    }
    console.log(`  ${SEATED} players seated with ${BUY_IN} chips each`);
  });

  it("authorises a session key per player", async function () {
    this.timeout(300_000);
    const stm = new SessionTokenManager(provider.wallet as any, connection as any);
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    for (let i = 0; i < SEATED; i++) {
      const tokenPda = PublicKey.findProgramAddressSync(
        [Buffer.from("session_token_v2"), program.programId.toBuffer(),
         sessionKeys[i].publicKey.toBuffer(), players[i].publicKey.toBuffer()],
        stm.program.programId,
      )[0];
      const tx = await stm.program.methods
        .createSessionV2(true, expiry, new BN(0.01 * LAMPORTS_PER_SOL))
        .accounts({ targetProgram: program.programId, sessionSigner: sessionKeys[i].publicKey, feePayer: players[i].publicKey, authority: players[i].publicKey })
        .transaction();
      tx.feePayer = players[i].publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(players[i], sessionKeys[i]);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await connection.confirmTransaction(sig, "confirmed");
      sessionTokens[i] = tokenPda;
    }
    console.log("  3 session keys authorised");
  });

  it("delegates everything to the rollup", async function () {
    this.timeout(400_000);
    await retry(() => program.methods.delegateCore(tableId)
      .accountsPartial({ payer: provider.wallet.publicKey, table, hand: handPda, deck: deckPda, validator: VALIDATOR })
      .rpc({ commitment: "confirmed", skipPreflight: true }), "delegateCore");
    for (let i = 0; i < MAX_SEATS; i++) {
      await retry(() => program.methods.delegateSeat(i)
        .accountsPartial({ payer: provider.wallet.publicKey, table, seat: seats[i], hole: holes[i], validator: VALIDATOR })
        .rpc({ commitment: "confirmed", skipPreflight: true }), `delegateSeat ${i}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
    const owner = (await connection.getAccountInfo(table))?.owner;
    assert.equal(owner?.toBase58(), DELEGATION_PROGRAM);
    console.log("  table, seats and hole cards delegated");
  });

  it("locks the deck to nobody and hole cards to their owner", async function () {
    this.timeout(400_000);
    const wallet = (provider.wallet as anchor.Wallet).payer;

    let tx = await erProgram.methods.secureDeck()
      .accountsPartial({ deck: deckPda, permission: permissionPda(deckPda), payer: wallet.publicKey, ...permAccounts })
      .transaction();
    await sendEr(tx, [wallet], "secure_deck");

    for (let i = 0; i < MAX_SEATS; i++) {
      tx = await erProgram.methods.secureHole(i)
        .accountsPartial({ hole: holes[i], seat: seats[i], permission: permissionPda(holes[i]), payer: wallet.publicKey, ...permAccounts })
        .transaction();
      await sendEr(tx, [wallet], `secure_hole ${i}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  });

  it("ADVERSARIAL: nobody can read the deck, not even the table creator", async () => {
    const creator = await tryRead(erConnection, deckPda);
    const seated = await tryRead(asPlayer[0], deckPda);
    const other = await tryRead(asSnooper, deckPda);
    console.log(`  creator ${creator.allowed ? "ALLOW" : "DENY"}, seated player ${seated.allowed ? "ALLOW" : "DENY"}, outsider ${other.allowed ? "ALLOW" : "DENY"}`);
    assert.isFalse(creator.allowed, "the deck must be dealer-only");
    assert.isFalse(seated.allowed, "a seated player must not read the deck");
    assert.isFalse(other.allowed, "an outsider must not read the deck");
  });

  it("fixes a shuffle seed from player salts plus VRF", async function () {
    this.timeout(600_000);
    const wallet = (provider.wallet as anchor.Wallet).payer;

    // 1. Everyone commits to a salt nobody else has seen.
    for (let i = 0; i < SEATED; i++) {
      const commitment = createHash("sha256").update(salts[i]).digest();
      const tx = await erProgram.methods.commitSalt(i, [...commitment])
        .accountsPartial({ hand: handPda, seat: seats[i], authority: players[i].publicKey })
        .transaction();
      await sendEr(tx, [players[i]], `commit_salt ${i}`);
    }

    // 2. Everyone reveals. Commitments bind them, so no late switching.
    for (let i = 0; i < SEATED; i++) {
      const tx = await erProgram.methods.revealSalt(i, [...salts[i]])
        .accountsPartial({ hand: handPda, seat: seats[i], authority: players[i].publicKey })
        .transaction();
      await sendEr(tx, [players[i]], `reveal_salt ${i}`);
    }

    // A salt that does not match its commitment must be rejected.
    let rejected = false;
    try {
      const bogus = randomBytes(32);
      const tx = await erProgram.methods.revealSalt(0, [...bogus])
        .accountsPartial({ hand: handPda, seat: seats[0], authority: players[0].publicKey })
        .transaction();
      await sendEr(tx, [players[0]], "reveal wrong salt");
    } catch {
      rejected = true;
    }
    assert.isTrue(rejected, "a salt not matching its commitment must be rejected");
    console.log("    a mismatched salt was rejected, as it should be");

    // 3. Only now is VRF drawn, seeded from the salts so it cannot be shopped.
    const tx = await erProgram.methods.requestShuffle()
      .accountsPartial({ payer: wallet.publicKey, hand: handPda, oracleQueue: ORACLE_QUEUE })
      .transaction();
    await sendEr(tx, [wallet], "request_shuffle");

    // 4. Wait for the oracle callback.
    let hand: any;
    for (let i = 0; i < 60; i++) {
      hand = await erProgram.account.hand.fetch(handPda);
      if (hand.shuffleState === 2) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    assert.equal(hand.shuffleState, 2, "VRF callback did not arrive within 120s");

    // The seed must be exactly VRF XOR the salts.
    const expected = Buffer.from(hand.vrfRandomness);
    for (const s of salts) for (let i = 0; i < 32; i++) expected[i] ^= s[i];
    assert.equal(hex(hand.shuffleSeed), hex(expected), "seed must be VRF XOR salts");
    console.log(`  seed ${hex(hand.shuffleSeed).slice(0, 24)}... = VRF XOR ${SEATED} salts`);
  });

  it("starts the hand and deals hidden cards", async function () {
    this.timeout(300_000);
    const wallet = (provider.wallet as anchor.Wallet).payer;

    let tx = await erProgram.methods.startHand()
      .accountsPartial({ table, config, hand: handPda, deck: deckPda, ...seatAccounts, payer: wallet.publicKey })
      .transaction();
    await sendEr(tx, [wallet], "start_hand");

    tx = await erProgram.methods.dealHoleCards()
      .accountsPartial({ hand: handPda, deck: deckPda, hole0: holes[0], hole1: holes[1], hole2: holes[2], hole3: holes[3], hole4: holes[4], hole5: holes[5], payer: wallet.publicKey })
      .transaction();
    await sendEr(tx, [wallet], "deal_hole_cards");

    const hand = await erProgram.account.hand.fetch(handPda);
    assert.equal(hand.handNumber.toNumber(), 1);
    assert.notEqual(hand.toAct, 0xff);
  });

  it("ADVERSARIAL: a player reads only their own hole cards", async function () {
    this.timeout(120_000);
    const mine = await tryRead(asPlayer[0], holes[0]);
    const theirs = await tryRead(asPlayer[1], holes[0]);
    const outsider = await tryRead(asSnooper, holes[0]);
    console.log(`  own ${mine.allowed ? "ALLOW" : "DENY"}, opponent ${theirs.allowed ? "ALLOW" : "DENY"}, outsider ${outsider.allowed ? "ALLOW" : "DENY"}`);
    assert.isTrue(mine.allowed, "you must be able to see your own cards");
    assert.isFalse(theirs.allowed, "AN OPPONENT MUST NOT READ YOUR HOLE CARDS");
    assert.isFalse(outsider.allowed, "an outsider must not read hole cards");
  });

  it("ADVERSARIAL: the base layer shows no cards during a live hand", async () => {
    // While delegated, these accounts belong to the delegation program on the
    // base layer, so they cannot even be decoded as card accounts there.
    for (const key of [deckPda, ...holes]) {
      const info = await connection.getAccountInfo(key);
      assert.equal(info?.owner.toBase58(), DELEGATION_PROGRAM, `${key.toBase58()} not delegated`);
    }
    // The frozen base-layer copy predates the deal, so it holds no cards.
    const baseDeck = await program.account.deck.fetch(deckPda);
    assert.isTrue(baseDeck.cards.every((c: number) => c === 0xff),
      "base-layer deck exposed card data during a live hand");
    for (let i = 0; i < MAX_SEATS; i++) {
      const hc = await program.account.holeCards.fetch(holes[i]);
      assert.isTrue(hc.cards.every((c: number) => c === 0xff),
        `base-layer hole cards for seat ${i} exposed card data`);
    }
    console.log("  base layer holds no card data mid-hand");
  });

  it("plays to showdown with session-key actions", async function () {
    this.timeout(600_000);
    let guard = 0;
    for (;;) {
      const hand = await erProgram.account.hand.fetch(handPda);
      if (hand.toAct === 0xff) {
        if (hand.street >= 4) break;
        const tx = await erProgram.methods.advanceStreet()
          .accountsPartial({ hand: handPda, config, deck: deckPda, ...seatAccounts, payer: provider.wallet.publicKey })
          .transaction();
        await sendEr(tx, [(provider.wallet as anchor.Wallet).payer], `advance_street -> ${hand.street + 1}`);
        continue;
      }
      const i = hand.toAct;
      const seat = await erProgram.account.seat.fetch(seats[i]);
      const owes = hand.currentBet.sub(seat.committedStreet);
      const tx = await erProgram.methods.playerAction(owes.gtn(0) ? ({ call: {} } as any) : ({ check: {} } as any))
        .accountsPartial({ payer: sessionKeys[i].publicKey, authority: players[i].publicKey, hand: handPda, config, ...seatAccounts, sessionToken: sessionTokens[i] })
        .transaction();
      await sendEr(tx, [sessionKeys[i]], `seat ${i} ${owes.gtn(0) ? "call" : "check"}`, true);
      if (++guard > 30) throw new Error("hand did not terminate");
    }
    const hand = await erProgram.account.hand.fetch(handPda);
    console.log(`  board ${hand.board.map(card).join(" ")}`);
  });

  it("settles, reveals only showdown hands, and wipes the rest", async function () {
    this.timeout(300_000);
    const tx = await erProgram.methods.settleHand()
      .accountsPartial({ table, config, hand: handPda, deck: deckPda, ...seatAccounts, payer: provider.wallet.publicKey })
      .remainingAccounts(holes.map((h) => ({ pubkey: h, isWritable: true, isSigner: false })))
      .transaction();
    await sendEr(tx, [(provider.wallet as anchor.Wallet).payer], "settle_hand");

    const hand = await erProgram.account.hand.fetch(handPda);
    let total = 0;
    for (const s of seats) total += (await erProgram.account.seat.fetch(s)).stack.toNumber();
    assert.equal(total, SEATED * BUY_IN, "chips must be conserved");

    for (let i = 0; i < SEATED; i++) {
      if (hand.revealedMask & (1 << i)) {
        console.log(`  seat ${i} showed ${hand.revealed[i].map(card).join(" ")}`);
      }
    }
    // Only a seat's occupant can read its hole cards, so each player checks
    // their own. Cards sit at a fixed offset: 8 discriminator + 32 table
    // + 1 seat index + 8 hand number.
    const CARDS_AT = 8 + 32 + 1 + 8;
    for (let i = 0; i < SEATED; i++) {
      const info = await asPlayer[i].getAccountInfo(holes[i]);
      assert.isNotNull(info, `seat ${i} should still read its own account`);
      const cards = info!.data.subarray(CARDS_AT, CARDS_AT + 2);
      assert.isTrue([...cards].every((c) => c === 0xff), `seat ${i} hole cards must be wiped`);
    }
    console.log("  hole cards zeroized (checked by each owner)");
  });

  it("VERIFIER: published history reproduces the exact deck", async function () {
    this.timeout(120_000);
    const hand = await erProgram.account.hand.fetch(handPda);
    const seatData = [];
    for (let i = 0; i < SEATED; i++) {
      const s = await erProgram.account.seat.fetch(seats[i]);
      seatData.push({
        index: i,
        dealtIn: true,
        saltCommit: hex(s.saltCommit),
        salt: hex(s.salt),
        revealed: hand.revealedMask & (1 << i) ? hand.revealed[i] : null,
      });
    }
    const history = {
      handNumber: hand.handNumber.toNumber(),
      vrfRandomness: hex(hand.vrfRandomness),
      shuffleSeed: hex(hand.shuffleSeed),
      board: hand.board,
      seats: seatData,
    };
    writeFileSync("hand-history.json", JSON.stringify(history, null, 2));

    // Run the standalone verifier exactly as an outsider would.
    const out = execFileSync("node", ["tools/verify-shuffle.mjs", "hand-history.json"], { encoding: "utf8" });
    console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
    assert.include(out, "VERIFIED", "the published history must reproduce the deal");
  });

  it("undelegates with no card data reaching the base layer", async function () {
    this.timeout(600_000);
    const wallet = (provider.wallet as anchor.Wallet).payer;
    let tx = await erProgram.methods.undelegateCore()
      .accountsPartial({ payer: wallet.publicKey, table, hand: handPda, deck: deckPda }).transaction();
    const sig = await sendEr(tx, [wallet], "undelegate_core");
    // Best effort: this lookup times out often and the undelegation below is
    // confirmed by ownership returning to the program anyway.
    try { await GetCommitmentSignature(sig, erConnection); } catch { /* not fatal */ }

    for (let i = 0; i < MAX_SEATS; i++) {
      tx = await erProgram.methods.undelegateSeat()
        .accountsPartial({ payer: wallet.publicKey, seat: seats[i], hole: holes[i] }).transaction();
      await sendEr(tx, [wallet], `undelegate_seat ${i}`);
    }
    for (let t = 0; t < 40; t++) {
      const info = await connection.getAccountInfo(table);
      if (info?.owner.equals(program.programId)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const deck = await program.account.deck.fetch(deckPda);
    assert.isTrue(deck.cards.every((c: number) => c === 0xff), "no card may reach the base layer");
    for (const h of holes) {
      const hc = await program.account.holeCards.fetch(h);
      assert.isTrue(hc.cards.every((c: number) => c === 0xff));
    }
    console.log("  base layer holds no unrevealed cards after the hand");
  });

  it("reports action latency", () => {
    assert.isAbove(latencies.length, 0);
    const s = [...latencies].sort((a, b) => a - b);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    console.log(`\n  ${latencies.length} session-key actions: min ${s[0]}ms  p50 ${s[Math.floor(s.length / 2)]}ms  avg ${avg}ms  max ${s[s.length - 1]}ms`);
  });
});
