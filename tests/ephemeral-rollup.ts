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

  /**
   * @param conn Which authenticated connection to send over. The enclave decides
   *   what a transaction may load from the token on the *connection*, not from
   *   who signed it, so anything touching a private account has to go over that
   *   member's own connection.
   */
  async function sendEr(
    tx: Transaction,
    signers: Keypair[],
    label: string,
    record = false,
    conn: anchor.web3.Connection = erConnection,
  ) {
    const started = Date.now();
    tx.feePayer = signers[0].publicKey;
    const bh = await conn.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.sign(...signers);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    // confirmTransaction resolves for failed transactions too, so check the error.
    const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) {
      const d = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
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
      await retry(() => program.methods.buyChips(new anchor.BN(10_000)).accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey }).signers([p]).rpc({ commitment: "confirmed" }), "buy chips");
    }
    await retry(() => program.methods.createTable(tableId, SB, BB, new BN(200), new BN(2_000), new BN(30))
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

    // Occupied seats only. An empty seat used to be locked to an empty member
    // list, which is readable by nobody and updatable by nobody, so whoever sat
    // there next was dealt cards they could never read. The program refuses it
    // now, and this loop is what the shipped client does too.
    for (let i = 0; i < SEATED; i++) {
      tx = await erProgram.methods.secureHole(i)
        .accountsPartial({ hole: holes[i], seat: seats[i], permission: permissionPda(holes[i]), payer: wallet.publicKey, ...permAccounts })
        .transaction();
      await sendEr(tx, [wallet], `secure_hole ${i}`);
    }
    await new Promise((r) => setTimeout(r, 2500));
  });

  it("SECURITY: refuses to lock an empty seat to nobody", async () => {
    // The seat that wedged a devnet table. A permission created while the seat
    // is empty names no member, and the enclave will only accept an update from
    // a member, so nobody can ever point it at the next occupant.
    const wallet = (provider.wallet as anchor.Wallet).payer;
    // Seats 0..SEATED-1 are taken, so this one never was.
    const empty = SEATED;
    assert.isBelow(empty, MAX_SEATS, "this test needs at least one empty seat");
    let refused = false;
    try {
      const tx = await erProgram.methods.secureHole(empty)
        .accountsPartial({ hole: holes[empty], seat: seats[empty], permission: permissionPda(holes[empty]), payer: wallet.publicKey, ...permAccounts })
        .transaction();
      await sendEr(tx, [wallet], `secure_hole ${empty}`);
    } catch (e) {
      refused = /SeatEmpty|0x1775/.test(String(e));
    }
    assert.isTrue(refused, "SECURITY: securing an empty seat must be refused");
    console.log(`    seat ${empty} is empty, and locking it was refused`);
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

    // 1. Everyone commits to a salt nobody else has seen. Signed by the session
    // key, which is what a client actually does: two wallet prompts per hand
    // would be as unplayable as one per bet.
    for (let i = 0; i < SEATED; i++) {
      const commitment = createHash("sha256").update(salts[i]).digest();
      const tx = await erProgram.methods.commitSalt(i, [...commitment])
        .accountsPartial({
          payer: sessionKeys[i].publicKey,
          authority: players[i].publicKey,
          hand: handPda,
          seat: seats[i],
          sessionToken: sessionTokens[i],
        })
        .transaction();
      await sendEr(tx, [sessionKeys[i]], `commit_salt ${i}`);
    }

    // 2. Everyone reveals. Commitments bind them, so no late switching.
    for (let i = 0; i < SEATED; i++) {
      const tx = await erProgram.methods.revealSalt(i, [...salts[i]])
        .accountsPartial({
          payer: sessionKeys[i].publicKey,
          authority: players[i].publicKey,
          hand: handPda,
          seat: seats[i],
          sessionToken: sessionTokens[i],
        })
        .transaction();
      await sendEr(tx, [sessionKeys[i]], `reveal_salt ${i}`);
    }

    // A session key is scoped to its own player. Seat 1's key must not be able
    // to speak for seat 0, or a session would be a licence to grief the table.
    let wrongSeat = false;
    try {
      const tx = await erProgram.methods.commitSalt(0, [...randomBytes(32)])
        .accountsPartial({
          payer: sessionKeys[1].publicKey,
          authority: players[0].publicKey,
          hand: handPda,
          seat: seats[0],
          sessionToken: sessionTokens[1],
        })
        .transaction();
      await sendEr(tx, [sessionKeys[1]], "commit_salt for someone else's seat");
    } catch {
      wrongSeat = true;
    }
    assert.isTrue(wrongSeat, "a session key must not act for another player");
    console.log("    a session key could not act for another player");

    // A salt that does not match its commitment must be rejected. Signed by the
    // wallet directly, so this also covers the no-session path.
    let rejected = false;
    try {
      const bogus = randomBytes(32);
      const tx = await erProgram.methods.revealSalt(0, [...bogus])
        .accountsPartial({
          payer: players[0].publicKey,
          authority: players[0].publicKey,
          hand: handPda,
          seat: seats[0],
          sessionToken: null,
        })
        .transaction();
      await sendEr(tx, [players[0]], "reveal wrong salt");
    } catch {
      rejected = true;
    }
    assert.isTrue(rejected, "a salt not matching its commitment must be rejected");
    console.log("    a mismatched salt was rejected, as it should be");

    // 3. Only now is VRF drawn, seeded from the salts so it cannot be shopped.
    const tx = await erProgram.methods.requestShuffle()
      .accountsPartial({ payer: wallet.publicKey, hand: handPda, deck: deckPda, oracleQueue: ORACLE_QUEUE })
      .transaction();
    await sendEr(tx, [wallet], "request_shuffle");

    // 4. Fulfillment is deliberately invisible: the randomness lands on the
    // private deck, so the public hand only ever says "requested". If the
    // seed or VRF output were readable here, anyone could recompute the deck
    // before the deal. The seed assertion moves to after settlement, where
    // publishing it is the point.
    const hand: any = await erProgram.account.hand.fetch(handPda);
    assert.equal(hand.shuffleState, 1, "the public state should say requested");
    assert.isTrue(hand.vrfRandomness.every((b: number) => b === 0),
      "MID-HAND LEAK: vrf randomness must not be public before settlement");
    assert.isTrue(hand.shuffleSeed.every((b: number) => b === 0),
      "MID-HAND LEAK: the shuffle seed must not be public before settlement");
    console.log("  randomness requested; nothing derivable is public");
  });

  it("starts the hand and deals hidden cards", async function () {
    this.timeout(300_000);
    const wallet = (provider.wallet as anchor.Wallet).payer;

    // Clients cannot see the callback land, so they knock until the door
    // opens: start_hand is refused with ShuffleNotReady until then.
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
      try {
        const tx = await erProgram.methods.startHand()
          .accountsPartial({ table, config, hand: handPda, deck: deckPda, ...seatAccounts, payer: wallet.publicKey })
          .transaction();
        await sendEr(tx, [wallet], "start_hand");
        started = true;
      } catch (e) {
        if (!/ShuffleNotReady/.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    assert.isTrue(started, "VRF callback did not arrive within 120s");

    const tx = await erProgram.methods.dealHoleCards()
      .accountsPartial({ hand: handPda, deck: deckPda, hole0: holes[0], hole1: holes[1], hole2: holes[2], hole3: holes[3], hole4: holes[4], hole5: holes[5], payer: wallet.publicKey })
      .transaction();
    await sendEr(tx, [wallet], "deal_hole_cards");

    const hand = await erProgram.account.hand.fetch(handPda);
    assert.equal(hand.handNumber.toNumber(), 1);
    assert.notEqual(hand.toAct, 0xff);
    // Still nothing derivable in public while the hand runs.
    assert.isTrue(hand.shuffleSeed.every((b: number) => b === 0),
      "MID-HAND LEAK: seed must stay private through the deal");

    // Undelegating mid-hand would commit live cards to the public base layer.
    // It must be refused for anyone, not just avoided by polite clients.
    let refusedCore = false;
    try {
      const t = await erProgram.methods.undelegateCore()
        .accountsPartial({ payer: wallet.publicKey, table, hand: handPda, deck: deckPda })
        .transaction();
      await sendEr(t, [wallet], "undelegate_core mid-hand");
    } catch {
      refusedCore = true;
    }
    assert.isTrue(refusedCore, "SECURITY: mid-hand undelegate_core must be refused");
    let refusedSeat = false;
    try {
      const t = await erProgram.methods.undelegateSeat()
        .accountsPartial({ payer: wallet.publicKey, table, seat: seats[0], hole: holes[0] })
        .transaction();
      await sendEr(t, [wallet], "undelegate_seat mid-hand");
    } catch {
      refusedSeat = true;
    }
    assert.isTrue(refusedSeat, "SECURITY: mid-hand undelegate_seat must be refused");
    console.log("    mid-hand undelegation refused for deck and hole cards");
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

    // Settlement publishes the randomness and seed for the verifier, and the
    // seed must be exactly VRF XOR the salts everyone committed to.
    const expected = Buffer.from(hand.vrfRandomness);
    for (const s of salts) for (let i = 0; i < 32; i++) expected[i] ^= s[i];
    assert.equal(hex(hand.shuffleSeed), hex(expected), "seed must be VRF XOR salts");
    console.log(`  seed ${hex(hand.shuffleSeed).slice(0, 24)}... = VRF XOR ${SEATED} salts, published at settle`);

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

    // Hand seat 0's read right back before the table leaves the rollup, which
    // is what `pauseTable` does in the client and the whole reason a chair can
    // survive changing hands. A permission names one member, only that member
    // may update one, and it outlives the trip off the rollup and back — so
    // released now or never. Sent over seat 0's own connection, because the
    // enclave decides what a transaction may load from the token on the
    // connection rather than from who signed it.
    const rel = await erProgram.methods.releaseHole(0)
      .accountsPartial({
        hole: holes[0], seat: seats[0], permission: permissionPda(holes[0]),
        payer: players[0].publicKey, authority: players[0].publicKey,
        sessionToken: null, ...permAccounts,
      })
      .transaction();
    await sendEr(rel, [players[0]], "release_hole 0 by its occupant", false, asPlayer[0]);
    const releasedSeat = await erProgram.account.seat.fetch(seats[0]);
    assert.isFalse(releasedSeat.cardsSecured, "releasing must clear cards_secured");
    let tx = await erProgram.methods.undelegateCore()
      .accountsPartial({ payer: wallet.publicKey, table, hand: handPda, deck: deckPda }).transaction();
    // Seats first: undelegate_seat reads the table to refuse a mid-hand pull,
    // so the table must still be delegated when they go.
    for (let i = 0; i < MAX_SEATS; i++) {
      const st = await erProgram.methods.undelegateSeat()
        .accountsPartial({ payer: wallet.publicKey, table, seat: seats[i], hole: holes[i] }).transaction();
      await sendEr(st, [wallet], `undelegate_seat ${i}`);
    }
    const sig = await sendEr(tx, [wallet], "undelegate_core");
    // Best effort: this lookup times out often and the undelegation below is
    // confirmed by ownership returning to the program anyway.
    try { await GetCommitmentSignature(sig, erConnection); } catch { /* not fatal */ }
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

  /**
   * The one path nothing exercised: a seat that changes hands across a pause.
   *
   * A hole account is pre-funded for its `EphemeralPermission` exactly once, at
   * `create_hole`, and a delegated PDA cannot be topped up. So if that rent is
   * not returned when the account leaves the rollup, the second delegation has
   * nothing to pay with and `secure_hole` fails for the new occupant — who is
   * then excluded from the deal and sits out every hand, permanently, on a
   * table that otherwise looks healthy.
   *
   * The deal gate makes that failure *safe* rather than a leak, which is why it
   * was acceptable to ship without knowing. It is not acceptable not to know.
   */
  it("HANDOVER: releasing the read right keeps the chair alive for the next player", async function () {
    this.timeout(600_000);
    const wallet = (provider.wallet as anchor.Wallet).payer;
    const leaving = players[0];
    const arriving = snooper; // funded, and has never sat anywhere

    // Do not assume the previous test finished. Undelegation is several
    // transactions against a public devnet endpoint and one of them can time
    // out; if the table is still on the rollup, custody cannot move and this
    // would fail with `AccountOwnedByWrongProgram` for a reason that has
    // nothing to do with what it is testing. Wait for the handover to be
    // possible, and finish the undelegation ourselves if it is still pending.
    const onBaseLayer = async () => {
      const info = await connection.getAccountInfo(table);
      return info?.owner.equals(program.programId) ?? false;
    };
    if (!(await onBaseLayer())) {
      for (let i = 0; i < MAX_SEATS; i++) {
        try {
          const st = await erProgram.methods.undelegateSeat()
            .accountsPartial({ payer: wallet.publicKey, table, seat: seats[i], hole: holes[i] })
            .transaction();
          await sendEr(st, [wallet], `undelegate_seat ${i} (retry)`);
        } catch { /* already off the rollup */ }
      }
      try {
        const core = await erProgram.methods.undelegateCore()
          .accountsPartial({ payer: wallet.publicKey, table, hand: handPda, deck: deckPda })
          .transaction();
        await sendEr(core, [wallet], "undelegate_core (retry)");
      } catch { /* already off the rollup */ }
      for (let t = 0; t < 60 && !(await onBaseLayer()); t++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    assert.isTrue(await onBaseLayer(), "the table has to be on the base layer to change hands");

    // The table is on the base layer now, so custody can move.
    await retry(() => program.methods.leaveTable(0)
      .accountsPartial({ table, seat: seats[0], player: playerPda(leaving.publicKey), authority: leaving.publicKey })
      .signers([leaving]).rpc({ commitment: "confirmed" }), "leave seat 0");

    await retry(() => program.methods.initPlayer()
      .accountsPartial({ player: playerPda(arriving.publicKey), authority: arriving.publicKey })
      .signers([arriving]).rpc({ commitment: "confirmed" }), "init arriving player").catch(() => {});
    await retry(() => program.methods.buyChips(new BN(BUY_IN))
      .accountsPartial({ player: playerPda(arriving.publicKey), authority: arriving.publicKey })
      .signers([arriving]).rpc({ commitment: "confirmed" }), "arriving buys chips");
    await retry(() => program.methods.joinTable(0, new BN(BUY_IN))
      .accountsPartial({ table, config, seat: seats[0], player: playerPda(arriving.publicKey), authority: arriving.publicKey })
      .signers([arriving]).rpc({ commitment: "confirmed" }), "arriving joins seat 0");

    const seatNow = await program.account.seat.fetch(seats[0]);
    assert.isFalse(seatNow.cardsSecured, "taking a seat must clear the stale permission flag");

    // Re-delegate and try to point the permission at the new occupant.
    await retry(() => program.methods.delegateCore(tableId)
      .accountsPartial({ payer: wallet.publicKey, table, hand: handPda, deck: deckPda, validator: VALIDATOR })
      .rpc({ commitment: "confirmed" }), "re-delegate core");
    for (let i = 0; i < MAX_SEATS; i++) {
      await retry(() => program.methods.delegateSeat(i)
        .accountsPartial({ payer: wallet.publicKey, table, seat: seats[i], hole: holes[i], validator: VALIDATOR })
        .rpc({ commitment: "confirmed" }), `re-delegate seat ${i}`);
    }
    for (let t = 0; t < 40; t++) {
      try { if (await erConnection.getAccountInfo(seats[0])) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 750));
    }

    // Diagnose before asserting: the two candidate causes look identical from
    // the error alone. Either the permission still names the old member (a
    // privacy problem), or it was destroyed with the rollup state and the hole
    // account has no lamports left to create another (a rent problem, because
    // the account is pre-funded for exactly one permission and cannot be topped
    // up while delegated).
    try {
      const permInfo = await erConnection.getAccountInfo(permissionPda(holes[0]));
      const holeInfo = await erConnection.getAccountInfo(holes[0]);
      console.log(
        `    permission on rollup: ${permInfo ? permInfo.lamports + " lamports, " + permInfo.data.length + " bytes" : "GONE"}`,
      );
      console.log(
        `    hole account lamports: ${holeInfo ? holeInfo.lamports : "?"} (needs rent for one permission to re-create)`,
      );
    } catch (e) {
      console.log(`    probe failed: ${String(e).slice(0, 90)}`);
    }

    let secured = false;
    let why = "";
    try {
      const tx = await erProgram.methods.secureHole(0)
        .accountsPartial({ hole: holes[0], seat: seats[0], permission: permissionPda(holes[0]), payer: wallet.publicKey, ...permAccounts })
        .transaction();
      await sendEr(tx, [wallet], "secure_hole 0 after handover");
      secured = true;
    } catch (e) {
      why = String(e).split("\n")[0];
    }

    console.log(
      secured
        ? "    seat 0 changed hands across a pause and was re-secured for its new occupant"
        : `    seat 0 could NOT be re-secured: ${why.slice(0, 100)}`,
    );

    const after = await erProgram.account.seat.fetch(seats[0]);

    // With the release done, the chair lives: the permission was public when
    // the new player arrived, so anyone could point it at them.
    assert.isTrue(
      secured,
      "after its occupant released it, a seat re-taken across a pause must be securable",
    );
    assert.isTrue(after.cardsSecured, "the new occupant's seat must be marked secured");

    // And the safety net is still the safety net. `start_hand` builds
    // `dealt_in` from `cards_secured`, so had this failed the seat would sit
    // out rather than be dealt cards its previous occupant could read. A dead
    // chair is a bad table; a readable chair is a stolen pot.
    console.log("    the read right moved with the chair, and the deal gate still guards it");
  });

  it("reports action latency", () => {
    assert.isAbove(latencies.length, 0);
    const s = [...latencies].sort((a, b) => a - b);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    console.log(`\n  ${latencies.length} session-key actions: min ${s[0]}ms  p50 ${s[Math.floor(s.length / 2)]}ms  avg ${avg}ms  max ${s[s.length - 1]}ms`);
  });
});
