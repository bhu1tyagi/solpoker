/**
 * Phase 6 gate: a long automated session with players dropping out.
 *
 * Six seats, many hands, and on every hand a random subset of players simply
 * stops responding. Nobody folds for them and no client covers for them. The
 * table has to keep moving on the turn clock alone.
 *
 * Asserts after every hand that chips are conserved. The table total can only
 * change when someone joins or leaves on the base layer, and nobody does that
 * here, so it must be identical from the first hand to the last.
 *
 *   HANDS=100 npm run test:session
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Solpoker } from "../target/types/solpoker";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { getAuthToken, verifyTeeRpcIntegrity, permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";
import { createHash, randomBytes } from "node:crypto";
import { assert } from "chai";

const MAX_SEATS = 6;
const SEATED = 6;
const BUY_IN = 2_000;
const HANDS = Number(process.env.HANDS ?? 100);
/** Short clock so a stalled seat costs seconds, not half a minute. */
const TIMEOUT_SECS = 2;
/** Chance a given player ignores the whole hand. */
const DROP_RATE = 0.15;
/** Commit to the base layer every N hands, not every hand. See history.rs. */
const COMMIT_EVERY = 25;

const VALIDATOR = new PublicKey(process.env.VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const ORACLE_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const PERMISSION_PROGRAM = new PublicKey("ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1");
const MAGIC_PROGRAM = new PublicKey("Magic11111111111111111111111111111111111111");
const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe(`SolPoker Phase 6: ${HANDS}-hand session with disconnects`, () => {
  const erUrl = process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app";
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Solpoker as Program<Solpoker>;
  const connection = provider.connection;

  let erConnection: anchor.web3.Connection;
  let erProgram: Program<Solpoker>;

  const players = Array.from({ length: SEATED }, () => Keypair.generate());
  const tableId = new BN(Math.floor(Date.now() / 1000));

  const pda = (s: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(s, program.programId)[0];
  const config = pda([Buffer.from("config"), tableId.toArrayLike(Buffer, "le", 8)]);
  const table = pda([Buffer.from("table"), tableId.toArrayLike(Buffer, "le", 8)]);
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => pda([Buffer.from("seat"), table.toBuffer(), Buffer.from([i])]));
  const holes = Array.from({ length: MAX_SEATS }, (_, i) => pda([Buffer.from("hole"), table.toBuffer(), Buffer.from([i])]));
  const handPda = pda([Buffer.from("hand"), table.toBuffer()]);
  const deckPda = pda([Buffer.from("deck"), table.toBuffer()]);
  const historyPda = pda([Buffer.from("history"), table.toBuffer()]);
  const playerPda = (o: PublicKey) => pda([Buffer.from("player"), o.toBuffer()]);

  const seatAccounts = {
    seat0: seats[0], seat1: seats[1], seat2: seats[2],
    seat3: seats[3], seat4: seats[4], seat5: seats[5],
  };
  const permAccounts = { permissionProgram: PERMISSION_PROGRAM, ephemeralVault: EPHEMERAL_VAULT, magicProgram: MAGIC_PROGRAM };

  const stats = { hands: 0, timeouts: 0, drops: 0, stalls: 0, commits: 0 };

  async function retry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (!/Blockhash not found|block height exceeded|429|timed out|fetch failed|socket hang up/i.test(String(e))) throw e;
        await sleep(1500 * (i + 1));
      }
    }
    throw new Error(`${label} failed after ${tries} attempts: ${last}`);
  }

  /** Rebuild the authenticated TEE connection after it drops. */
  async function reconnect() {
    const wallet = provider.wallet as anchor.Wallet;
    const auth = await getAuthToken(erUrl, wallet.publicKey, (m: Uint8Array) =>
      Promise.resolve(nacl.sign.detached(m, wallet.payer.secretKey)));
    erConnection = new anchor.web3.Connection(`${erUrl}?token=${auth.token}`, { commitment: "confirmed" });
    erProgram = new Program<Solpoker>(program.idl as any,
      new anchor.AnchorProvider(erConnection, wallet, { commitment: "confirmed" }));
  }

  const TRANSIENT = /fetch failed|ECONNRESET|socket hang up|ETIMEDOUT|EPIPE|Blockhash not found|block height exceeded|429|50[234]|timed out/i;

  /**
   * Retry a read through network failures, rebuilding the connection.
   * A 40 minute session on a public devnet endpoint will lose its socket at
   * least once, and that is not a poker bug.
   */
  async function net<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try { return await fn(); } catch (e) {
        last = e;
        if (!TRANSIENT.test(String(e))) throw e;
        await sleep(2000 * (i + 1));
        try { await reconnect(); } catch { /* try again next round */ }
      }
    }
    throw new Error(`${label} failed after ${tries} attempts: ${last}`);
  }

  async function sendEr(tx: Transaction, signers: Keypair[], label: string) {
    tx.feePayer = signers[0].publicKey;
    const bh = await erConnection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.sign(...signers);
    const sig = await erConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await erConnection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) {
      const d = await erConnection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}\n${(d?.meta?.logMessages ?? []).join("\n")}`);
    }
    return sig;
  }

  /**
   * Run one step through network failures without double-applying it.
   *
   * Blindly retrying a send is unsafe, because the first attempt may already
   * have landed before the socket died. So each step says how to tell whether it
   * is already done, and a retry skips it if so.
   */
  async function step(done: () => Promise<boolean>, doIt: () => Promise<unknown>, label: string, tries = 5) {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        if (i > 0 && (await done())) return;
        await doIt();
        return;
      } catch (e) {
        last = e;
        if (!TRANSIENT.test(String(e))) throw e;
        await sleep(2000 * (i + 1));
        try { await reconnect(); } catch { /* next round */ }
      }
    }
    throw new Error(`${label} failed after ${tries} attempts: ${last}`);
  }

  async function tableChips(): Promise<number> {
    let total = 0;
    for (const s of seats) total += (await net(() => erProgram.account.seat.fetch(s), "fetch seat")).stack.toNumber();
    return total;
  }

  before(async function () {
    this.timeout(600_000);
    console.log(`ER: ${erUrl}`);
    console.log(`Playing ${HANDS} hands, ${SEATED} seats, ${TIMEOUT_SECS}s clock, ${Math.round(DROP_RATE * 100)}% drop rate\n`);

    for (const p of players) {
      const sig = await connection.requestAirdrop(p.publicKey, 0.08 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
    }
    await verifyTeeRpcIntegrity(erUrl);
    const wallet = provider.wallet as anchor.Wallet;
    const auth = await getAuthToken(erUrl, wallet.publicKey, (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, wallet.payer.secretKey)));
    erConnection = new anchor.web3.Connection(`${erUrl}?token=${auth.token}`, { commitment: "confirmed" });
    erProgram = new Program<Solpoker>(program.idl as any, new anchor.AnchorProvider(erConnection, wallet, { commitment: "confirmed" }));
  });

  it("seats six players and delegates the table", async function () {
    this.timeout(900_000);
    const wallet = provider.wallet.publicKey;

    for (const p of players) {
      await retry(() => program.methods.initPlayer().accounts({ authority: p.publicKey }).signers([p]).rpc({ commitment: "confirmed" }), "initPlayer");
      await retry(() => program.methods.claimFaucet().accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey }).signers([p]).rpc({ commitment: "confirmed" }), "faucet");
    }
    await retry(() => program.methods.createTable(tableId, new BN(5), new BN(10), new BN(200), new BN(5_000), new BN(TIMEOUT_SECS))
      .accountsPartial({ config, table, hand: handPda, deck: deckPda, creator: wallet }).rpc({ commitment: "confirmed" }), "createTable");
    await retry(() => program.methods.createHistory().accountsPartial({ table, history: historyPda, payer: wallet }).rpc({ commitment: "confirmed" }), "createHistory");

    for (let i = 0; i < MAX_SEATS; i++) {
      await retry(() => program.methods.createSeat(i).accountsPartial({ table, seat: seats[i], payer: wallet }).rpc({ commitment: "confirmed" }), `seat ${i}`);
      await retry(() => program.methods.createHole(i).accountsPartial({ table, hole: holes[i], payer: wallet }).rpc({ commitment: "confirmed" }), `hole ${i}`);
    }
    for (let i = 0; i < SEATED; i++) {
      await retry(() => program.methods.joinTable(i, new BN(BUY_IN))
        .accountsPartial({ table, config, seat: seats[i], player: playerPda(players[i].publicKey), authority: players[i].publicKey })
        .signers([players[i]]).rpc({ commitment: "confirmed" }), `join ${i}`);
    }

    await retry(() => program.methods.delegateCore(tableId)
      .accountsPartial({ payer: wallet, table, hand: handPda, deck: deckPda, validator: VALIDATOR })
      .rpc({ commitment: "confirmed", skipPreflight: true }), "delegateCore");
    for (let i = 0; i < MAX_SEATS; i++) {
      await retry(() => program.methods.delegateSeat(i)
        .accountsPartial({ payer: wallet, table, seat: seats[i], hole: holes[i], validator: VALIDATOR })
        .rpc({ commitment: "confirmed", skipPreflight: true }), `delegateSeat ${i}`);
    }
    await sleep(4000);

    // Lock the cards down once; permissions persist across hands.
    const kp = (provider.wallet as anchor.Wallet).payer;
    await sendEr(await erProgram.methods.secureDeck()
      .accountsPartial({ deck: deckPda, permission: permissionPdaFromAccount(deckPda), payer: kp.publicKey, ...permAccounts })
      .transaction(), [kp], "secure_deck");
    for (let i = 0; i < MAX_SEATS; i++) {
      await sendEr(await erProgram.methods.secureHole(i)
        .accountsPartial({ hole: holes[i], seat: seats[i], permission: permissionPdaFromAccount(holes[i]), payer: kp.publicKey, ...permAccounts })
        .transaction(), [kp], `secure_hole ${i}`);
    }
    console.log(`  ${SEATED} players seated with ${BUY_IN} each, table delegated and locked down`);
  });

  it(`plays ${HANDS} hands without stalling`, async function () {
    this.timeout(3_600_000);
    const kp = (provider.wallet as anchor.Wallet).payer;
    const startingChips = await tableChips();
    assert.equal(startingChips, SEATED * BUY_IN);

    for (let hand = 1; hand <= HANDS; hand++) {
      // Decide who has "dropped" for this hand. They will not sign anything.
      const online = players.map(() => Math.random() > DROP_RATE);
      // Two live players are needed for a hand to exist at all.
      while (online.filter(Boolean).length < 2) online[Math.floor(Math.random() * SEATED)] = true;
      stats.drops += online.filter((o) => !o).length;

      // Salts, from whoever is still around.
      const salts: (Buffer | null)[] = [];
      for (let i = 0; i < SEATED; i++) {
        if (!online[i]) { salts.push(null); continue; }
        const salt = randomBytes(32);
        salts.push(salt);
        await step(async () => false, async () =>
          sendEr(await erProgram.methods.commitSalt(i, [...createHash("sha256").update(salt).digest()])
            .accountsPartial({ hand: handPda, seat: seats[i], authority: players[i].publicKey }).transaction(), [players[i]], `commit ${i}`),
          `commit salt ${i}`);
      }
      for (let i = 0; i < SEATED; i++) {
        if (!salts[i]) continue;
        await step(
          async () => (await erProgram.account.seat.fetch(seats[i])).saltState === 2,
          async () => sendEr(await erProgram.methods.revealSalt(i, [...salts[i]!])
            .accountsPartial({ hand: handPda, seat: seats[i], authority: players[i].publicKey }).transaction(), [players[i]], `reveal ${i}`),
          `reveal salt ${i}`);
      }

      await step(
        async () => (await erProgram.account.hand.fetch(handPda)).shuffleState !== 0,
        async () => sendEr(await erProgram.methods.requestShuffle()
          .accountsPartial({ payer: kp.publicKey, hand: handPda, oracleQueue: ORACLE_QUEUE }).transaction(), [kp], "request_shuffle"),
        "request_shuffle");

      let h: any;
      for (let t = 0; t < 60; t++) {
        h = await net(() => erProgram.account.hand.fetch(handPda), "fetch hand");
        if (h.shuffleState === 2) break;
        await sleep(1000);
      }
      assert.equal(h.shuffleState, 2, `hand ${hand}: VRF never arrived`);

      await step(
        async () => (await erProgram.account.hand.fetch(handPda)).handNumber.toNumber() === hand,
        async () => sendEr(await erProgram.methods.startHand()
          .accountsPartial({ table, config, hand: handPda, deck: deckPda, ...seatAccounts, payer: kp.publicKey }).transaction(), [kp], "start_hand"),
        "start_hand");
      await sendEr(await erProgram.methods.dealHoleCards()
        .accountsPartial({ hand: handPda, deck: deckPda, hole0: holes[0], hole1: holes[1], hole2: holes[2], hole3: holes[3], hole4: holes[4], hole5: holes[5], payer: kp.publicKey }).transaction(), [kp], "deal");

      // Play it out. Absent players are carried by the clock alone.
      let guard = 0;
      for (;;) {
        h = await net(() => erProgram.account.hand.fetch(handPda), "fetch hand");
        if (h.toAct === 0xff) {
          if (h.street >= 4) break;
          await sendEr(await erProgram.methods.advanceStreet()
            .accountsPartial({ hand: handPda, config, deck: deckPda, ...seatAccounts, payer: kp.publicKey }).transaction(), [kp], "advance");
          continue;
        }
        const i = h.toAct;
        try {
        if (online[i]) {
          const seat = await net(() => erProgram.account.seat.fetch(seats[i]), "fetch seat");
          const owes = h.currentBet.sub(seat.committedStreet);
          await sendEr(await erProgram.methods.playerAction(owes.gtn(0) ? ({ call: {} } as any) : ({ check: {} } as any))
            .accountsPartial({ payer: players[i].publicKey, authority: players[i].publicKey, hand: handPda, config, ...seatAccounts, sessionToken: null })
            .transaction(), [players[i]], `seat ${i} act`);
        } else {
          // Nobody acts for them. Wait out the clock and let anyone force it.
          const now = Math.floor(Date.now() / 1000);
          const wait = h.deadline.toNumber() - now + 1;
          if (wait > 0) await sleep(wait * 1000);
          await sendEr(await erProgram.methods.forceTimeout()
            .accountsPartial({ hand: handPda, config, ...seatAccounts, payer: kp.publicKey }).transaction(), [kp], "force_timeout");
          stats.timeouts++;
        }
        } catch (e) {
          // Resending could double-apply, so re-read state and decide again.
          if (!TRANSIENT.test(String(e))) throw e;
          await sleep(2000);
          try { await reconnect(); } catch { /* next loop */ }
        }
        if (++guard > 80) { stats.stalls++; throw new Error(`hand ${hand} stalled`); }
      }

      await step(
        async () => (await erProgram.account.table.fetch(table)).state.waiting !== undefined,
        async () => sendEr(await erProgram.methods.settleHand()
        .accountsPartial({ table, config, hand: handPda, deck: deckPda, ...seatAccounts, payer: kp.publicKey })
          .remainingAccounts(holes.map((x) => ({ pubkey: x, isWritable: true, isSigner: false })))
          .transaction(), [kp], "settle"),
        "settle");

      const chips = await tableChips();
      assert.equal(chips, startingChips, `hand ${hand}: chips changed from ${startingChips} to ${chips}`);
      stats.hands++;

      if (hand % COMMIT_EVERY === 0 || hand === HANDS) {
        await sendEr(await erProgram.methods.commitResults()
          .accountsPartial({ payer: kp.publicKey, table, hand: handPda, history: historyPda, programId: program.programId })
          .transaction(), [kp], "commit_results");
        stats.commits++;
        console.log(`  hand ${hand}: chips ${chips}, ${stats.timeouts} timeouts so far, committed`);
      } else if (hand % 10 === 0) {
        console.log(`  hand ${hand}: chips ${chips}, ${stats.timeouts} timeouts so far`);
      }
    }

    console.log(`\n  ${stats.hands} hands played`);
    console.log(`  ${stats.drops} player-hands dropped, ${stats.timeouts} forced timeouts`);
    console.log(`  ${stats.stalls} stalls`);
    assert.equal(stats.stalls, 0, "the table must never stall");
    assert.equal(await tableChips(), startingChips, "chips must be conserved across the session");
  });

  it("recorded hands on the base layer via Magic Actions", async function () {
    this.timeout(300_000);
    // Scheduling is not execution, so read the base-layer account rather than
    // trusting the commit signature.
    let recorded: any = null;
    for (let t = 0; t < 30; t++) {
      recorded = await program.account.tableHistory.fetch(historyPda);
      if (recorded.handsRecorded.toNumber() > 0) break;
      await sleep(2000);
    }
    console.log(`  base layer recorded ${recorded.handsRecorded} commits, last hand ${recorded.lastHandNumber}`);
    assert.isAbove(recorded.handsRecorded.toNumber(), 0, "no Magic Action reached the base layer");
    assert.equal(recorded.lastHandNumber.toNumber(), HANDS, "last recorded hand should be the final one");
  });

  it("returns chips to player balances on undelegation", async function () {
    this.timeout(900_000);
    const kp = (provider.wallet as anchor.Wallet).payer;
    await sendEr(await erProgram.methods.undelegateCore()
      .accountsPartial({ payer: kp.publicKey, table, hand: handPda, deck: deckPda }).transaction(), [kp], "undelegate_core");
    for (let i = 0; i < MAX_SEATS; i++) {
      await sendEr(await erProgram.methods.undelegateSeat()
        .accountsPartial({ payer: kp.publicKey, seat: seats[i], hole: holes[i] }).transaction(), [kp], `undelegate_seat ${i}`);
    }
    for (let t = 0; t < 60; t++) {
      const info = await connection.getAccountInfo(table);
      if (info?.owner.equals(program.programId)) break;
      await sleep(1000);
    }

    let onTable = 0;
    for (const s of seats) onTable += (await program.account.seat.fetch(s)).stack.toNumber();
    assert.equal(onTable, SEATED * BUY_IN, "committed stacks must match what went in");

    let inBalances = 0;
    for (let i = 0; i < SEATED; i++) {
      await retry(() => program.methods.leaveTable(i)
        .accountsPartial({ table, seat: seats[i], player: playerPda(players[i].publicKey), authority: players[i].publicKey })
        .signers([players[i]]).rpc({ commitment: "confirmed" }), `leave ${i}`);
      inBalances += (await program.account.player.fetch(playerPda(players[i].publicKey))).chips.toNumber();
    }
    assert.equal(inBalances, SEATED * 10_000, "every faucet chip is still accounted for");
    console.log(`  all ${SEATED} players cashed out; ${inBalances} chips across balances`);
  });
});
