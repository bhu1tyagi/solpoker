/**
 * Phase 3 gate, a full hand played on the devnet Ephemeral Rollup.
 *
 * Cards are FACE UP here. The deck and hole cards live in ordinary public PDAs,
 * so anyone can read them. That is the honest state of the project at this phase:
 * hiding them is Phase 4's job, and the real-time loop is worth proving first.
 *
 * What this does prove:
 *   - table, seats, hand, deck and hole cards delegate to the ER and come back
 *   - a complete hand plays out preflop through showdown on the ER
 *   - betting actions are signed by a SESSION KEY, with no wallet prompt per action
 *   - chips are conserved across the whole hand
 *   - measured per-action latency, which is the number the gate asks for
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { Solpoker } from "../target/types/solpoker";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import {
  GetCommitmentSignature,
  getAuthToken,
  verifyTeeRpcIntegrity,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { assert } from "chai";

const MAX_SEATS = 6;
const SEATED = 3;
const FAUCET_AMOUNT = 10_000;
const BUY_IN = 1_000;

const SMALL_BLIND = new BN(5);
const BIG_BLIND = new BN(10);

// Pinned so a table always lands on the same rollup.
const VALIDATOR = new PublicKey(
  process.env.VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo",
);

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const card = (b: number) =>
  b === 0xff ? "--" : `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}`;

describe("SolPoker Phase 3, full hand on the ephemeral rollup", () => {
  const baseUrl =
    process.env.ANCHOR_PROVIDER_URL || "https://rpc.magicblock.app/devnet";
  const erUrl =
    process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
    "https://devnet-tee.magicblock.app";

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Solpoker as Program<Solpoker>;
  const connection = provider.connection;

  // The table is pinned to the TEE validator, so the ER endpoint is the TEE one
  // and every RPC call needs a signed auth token. Phase 3 still plays face up, 
  // no EphemeralPermission is created, so the accounts are readable by anyone who
  // authenticates. Phase 4 is what actually makes cards secret.
  let erConnection: anchor.web3.Connection;
  let erProgram: Program<Solpoker>;

  const players = Array.from({ length: SEATED }, () => Keypair.generate());
  // One session key per player: authorised once, then signs every action.
  const sessionKeys = Array.from({ length: SEATED }, () => Keypair.generate());
  const sessionTokens: (PublicKey | null)[] = [null, null, null];

  const tableId = new BN(Math.floor(Date.now() / 1000));
  const seed = Buffer.alloc(32, 7); // fixed so the deal is reproducible

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];

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
  const playerPda = (o: PublicKey) =>
    pda([Buffer.from("player"), o.toBuffer()]);

  const seatAccounts = {
    seat0: seats[0],
    seat1: seats[1],
    seat2: seats[2],
    seat3: seats[3],
    seat4: seats[4],
    seat5: seats[5],
  };

  /** Latency samples for every action sent to the ER. */
  const actionLatencies: number[] = [];

  async function sendEr(
    tx: Transaction,
    signers: Keypair[],
    label: string,
    record = false,
  ) {
    const started = Date.now();
    tx.feePayer = signers[0].publicKey;
    const bh = await erConnection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.sign(...signers);
    const sig = await erConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });
    // confirmTransaction resolves for FAILED transactions too, so the error has
    // to be checked explicitly or a broken instruction looks like a success.
    const conf = await erConnection.confirmTransaction(
      { signature: sig...bh },
      "confirmed",
    );
    if (conf.value.err) {
      const detail = await erConnection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      throw new Error(
        `${label} failed: ${JSON.stringify(conf.value.err)}\n` +
          (detail?.meta?.logMessages ?? []).join("\n"),
      );
    }
    const ms = Date.now() - started;
    if (record) actionLatencies.push(ms);
    console.log(`    ${String(ms).padStart(4)}ms (ER) ${label}`);
    return sig;
  }

  /**
   * Retry a base-layer call through transient devnet RPC failures.
   *
   * Devnet regularly returns "Blockhash not found" under load. Without this the
   * setup can abort halfway through creating accounts, and every later failure
   * points at a missing account rather than the flake that caused it.
   */
  async function retry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
        const transient =
          /Blockhash not found|block height exceeded|429|Too many requests|timed out|fetch failed|socket hang up/i.test(
            String(e),
          );
        if (!transient) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw new Error(`${label} failed after ${tries} attempts: ${last}`);
  }

  async function seatStacks(): Promise<number[]> {
    const out: number[] = [];
    for (const s of seats) {
      const a = await erProgram.account.seat.fetch(s);
      out.push(a.stack.toNumber());
    }
    return out;
  }

  before(async function () {
    this.timeout(300_000);
    console.log("Base layer:", baseUrl);
    console.log("ER:        ", erUrl);
    console.log("Program:   ", program.programId.toBase58());
    console.log("Table id:  ", tableId.toString());

    for (const p of [...players...sessionKeys]) {
      const sig = await connection.requestAirdrop(
        p.publicKey,
        0.05 * LAMPORTS_PER_SOL,
      );
      await connection.confirmTransaction(sig, "confirmed");
    }

    // Attest the enclave, then authenticate to it with a signed challenge.
    await verifyTeeRpcIntegrity(erUrl);
    const wallet = provider.wallet as anchor.Wallet;
    const auth = await getAuthToken(erUrl, wallet.publicKey, (m: Uint8Array) =>
      Promise.resolve(nacl.sign.detached(m, wallet.payer.secretKey)),
    );
    erConnection = new anchor.web3.Connection(`${erUrl}?token=${auth.token}`, {
      commitment: "confirmed",
    });
    erProgram = new Program<Solpoker>(
      program.idl as any,
      new anchor.AnchorProvider(erConnection, wallet, {
        commitment: "confirmed",
      }),
    );
    console.log("  TEE attestation OK, ER authenticated");
  });

  it("sets up players, table, seats and hole-card accounts on the base layer", async function () {
    this.timeout(300_000);

    for (const p of players) {
      await retry(() => program.methods
        .initPlayer()
        .accounts({ authority: p.publicKey })
        .signers([p])
        .rpc({ commitment: "confirmed" }), "initPlayer");
      await retry(() => program.methods
        .claimFaucet()
        .accountsPartial({ player: playerPda(p.publicKey), authority: p.publicKey })
        .signers([p])
        .rpc({ commitment: "confirmed" }), "claimFaucet");
    }

    await retry(() => program.methods
      .createTable(tableId, SMALL_BLIND, BIG_BLIND, new BN(200), new BN(2_000))
      .accountsPartial({
        config,
        table,
        hand: handPda,
        deck: deckPda,
        creator: provider.wallet.publicKey,
      })
      .rpc({ commitment: "confirmed" }), "createTable");

    // create_seat and create_hole are idempotent, so a retry is always safe.
    for (let i = 0; i < MAX_SEATS; i++) {
      await retry(() => program.methods
        .createSeat(i)
        .accountsPartial({ table, seat: seats[i], payer: provider.wallet.publicKey })
        .rpc({ commitment: "confirmed" }), `createSeat ${i}`);
      await retry(() => program.methods
        .createHole(i)
        .accountsPartial({ table, hole: holes[i], payer: provider.wallet.publicKey })
        .rpc({ commitment: "confirmed" }), `createHole ${i}`);
    }

    for (let i = 0; i < SEATED; i++) {
      await retry(() => program.methods
        .joinTable(i, new BN(BUY_IN))
        .accountsPartial({
          table,
          config,
          seat: seats[i],
          player: playerPda(players[i].publicKey),
          authority: players[i].publicKey,
        })
        .signers([players[i]])
        .rpc({ commitment: "confirmed" }), `joinTable ${i}`);
    }

    // Verify every account exists before anything downstream depends on it, so a
    // partial setup fails here rather than as a confusing error three tests later.
    for (let i = 0; i < MAX_SEATS; i++) {
      await program.account.seat.fetch(seats[i]);
      await program.account.holeCards.fetch(holes[i]);
    }
    console.log(`  ${SEATED} players seated with ${BUY_IN} chips each; all 6 seats + hole accounts verified`);
  });

  it("creates a session key per player so actions need no wallet prompt", async function () {
    this.timeout(300_000);
    const stm = new SessionTokenManager(
      provider.wallet as any,
      connection as any,
    );
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);

    for (let i = 0; i < SEATED; i++) {
      const tokenPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from("session_token_v2"),
          program.programId.toBuffer(),
          sessionKeys[i].publicKey.toBuffer(),
          players[i].publicKey.toBuffer(),
        ],
        stm.program.programId,
      )[0];

      const tx = await stm.program.methods
        .createSessionV2(true, expiry, new BN(0.01 * LAMPORTS_PER_SOL))
        .accounts({
          targetProgram: program.programId,
          sessionSigner: sessionKeys[i].publicKey,
          feePayer: players[i].publicKey,
          authority: players[i].publicKey,
        })
        .transaction();

      tx.feePayer = players[i].publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.sign(players[i], sessionKeys[i]);
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });
      await connection.confirmTransaction(sig, "confirmed");
      sessionTokens[i] = tokenPda;
    }
    console.log(`  ${SEATED} session keys authorised, 1h expiry`);
  });

  it("delegates the table's PDAs to the ephemeral rollup", async function () {
    this.timeout(300_000);

    await program.methods
      .delegateCore(tableId)
      .accountsPartial({
        payer: provider.wallet.publicKey,
        table,
        hand: handPda,
        deck: deckPda,
        validator: VALIDATOR,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    for (let i = 0; i < MAX_SEATS; i++) {
      await program.methods
        .delegateSeat(i)
        .accountsPartial({
          payer: provider.wallet.publicKey,
          table,
          seat: seats[i],
          hole: holes[i],
          validator: VALIDATOR,
        })
        .rpc({ commitment: "confirmed", skipPreflight: true });
    }

    // Let the delegation propagate to the rollup.
    await new Promise((r) => setTimeout(r, 4000));

    const owner = (await connection.getAccountInfo(table))?.owner;
    assert.equal(
      owner?.toBase58(),
      "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
      "base-layer owner should be the delegation program once delegated",
    );
    console.log("  table + 6 seats + hole cards delegated to the ER");
  });

  it("starts a hand and deals face-up hole cards on the ER", async function () {
    this.timeout(300_000);

    let tx = await erProgram.methods
      .startHand([...seed])
      .accountsPartial({
        table,
        config,
        hand: handPda,
        deck: deckPda...seatAccounts,
        payer: provider.wallet.publicKey,
      })
      .transaction();
    await sendEr(tx, [(provider.wallet as anchor.Wallet).payer], "start_hand");

    tx = await erProgram.methods
      .dealHoleCards()
      .accountsPartial({
        hand: handPda,
        deck: deckPda,
        hole0: holes[0],
        hole1: holes[1],
        hole2: holes[2],
        hole3: holes[3],
        hole4: holes[4],
        hole5: holes[5],
        payer: provider.wallet.publicKey,
      })
      .transaction();
    await sendEr(tx, [(provider.wallet as anchor.Wallet).payer], "deal_hole_cards");

    const hand = await erProgram.account.hand.fetch(handPda);
    assert.equal(hand.handNumber.toNumber(), 1);
    assert.notEqual(hand.toAct, 0xff, "someone must be to act preflop");

    for (let i = 0; i < SEATED; i++) {
      const h = await erProgram.account.holeCards.fetch(holes[i]);
      console.log(
        `  seat ${i}: ${card(h.cards[0])} ${card(h.cards[1])}  (face up in Phase 3)`,
      );
      assert.notEqual(h.cards[0], 0xff);
    }

    const stacks = await seatStacks();
    console.log(`  blinds posted, stacks now ${stacks.slice(0, SEATED)}`);
  });

  it("plays the hand to showdown with session-key-signed actions", async function () {
    this.timeout(600_000);

    let guard = 0;
    for (;;) {
      const hand = await erProgram.account.hand.fetch(handPda);

      if (hand.toAct === 0xff) {
        if (hand.street >= 4) break; // showdown
        const tx = await erProgram.methods
          .advanceStreet()
          .accountsPartial({
            hand: handPda,
            config,
            deck: deckPda...seatAccounts,
            payer: provider.wallet.publicKey,
          })
          .transaction();
        await sendEr(
          tx,
          [(provider.wallet as anchor.Wallet).payer],
          `advance_street -> ${hand.street + 1}`,
        );
        const after = await erProgram.account.hand.fetch(handPda);
        const board = after.board.filter((c) => c !== 0xff).map(card).join(" ");
        console.log(`      board: ${board}`);
        if (after.toAct === 0xff && after.street >= 4) break;
        continue;
      }

      const seatIndex = hand.toAct;
      if (seatIndex >= SEATED) throw new Error(`unexpected seat ${seatIndex}`);

      // Everyone calls/checks so the hand reaches showdown rather than folding out.
      const seat = await erProgram.account.seat.fetch(seats[seatIndex]);
      const owes = hand.currentBet.sub(seat.committedStreet);
      const move = owes.gtn(0) ? { call: {} } : { check: {} };

      const tx = await erProgram.methods
        .playerAction(move as any)
        .accountsPartial({
          payer: sessionKeys[seatIndex].publicKey,
          authority: players[seatIndex].publicKey,
          hand: handPda,
          config...seatAccounts,
          sessionToken: sessionTokens[seatIndex],
        })
        .transaction();

      // Signed only by the session key, the player's wallet is not involved.
      await sendEr(
        tx,
        [sessionKeys[seatIndex]],
        `seat ${seatIndex} ${owes.gtn(0) ? "call" : "check"} (session key)`,
        true,
      );

      if (++guard > 30) throw new Error("hand did not terminate");
    }

    const hand = await erProgram.account.hand.fetch(handPda);
    console.log(
      `  reached showdown, board: ${hand.board.map(card).join(" ")}`,
    );
    assert.isTrue(hand.board.every((c) => c !== 0xff), "board should be complete");
  });

  it("settles the hand, paying pots and wiping all card data", async function () {
    this.timeout(300_000);

    const tx = await erProgram.methods
      .settleHand()
      .accountsPartial({
        table,
        config,
        hand: handPda,
        deck: deckPda...seatAccounts,
        payer: provider.wallet.publicKey,
      })
      .remainingAccounts(
        holes.map((h) => ({ pubkey: h, isWritable: true, isSigner: false })),
      )
      .transaction();
    await sendEr(tx, [(provider.wallet as anchor.Wallet).payer], "settle_hand");

    const after = await seatStacks();
    const total = after.reduce((a, b) => a + b, 0);
    console.log(`  stacks after settlement: ${after.slice(0, SEATED)}`);
    assert.equal(
      total,
      SEATED * BUY_IN,
      "chips at the table must be conserved across the hand",
    );

    // Cards must be gone before anything can commit them to the base layer.
    const deck = await erProgram.account.deck.fetch(deckPda);
    assert.isTrue(
      deck.cards.every((c) => c === 0xff),
      "deck must be zeroized at hand end",
    );
    for (let i = 0; i < MAX_SEATS; i++) {
      const h = await erProgram.account.holeCards.fetch(holes[i]);
      assert.isTrue(
        h.cards.every((c) => c === 0xff),
        `hole cards for seat ${i} must be zeroized`,
      );
    }
    console.log("  deck and all hole cards zeroized");

    const t = await erProgram.account.table.fetch(table);
    assert.deepEqual(Object.keys(t.state)[0], "waiting");
  });

  it("commits and undelegates back to the base layer", async function () {
    this.timeout(600_000);

    let tx = await erProgram.methods
      .undelegateCore()
      .accountsPartial({
        payer: provider.wallet.publicKey,
        table,
        hand: handPda,
        deck: deckPda,
      })
      .transaction();
    const sig = await sendEr(
      tx,
      [(provider.wallet as anchor.Wallet).payer],
      "undelegate_core",
    );
    await GetCommitmentSignature(sig, erConnection);

    for (let i = 0; i < MAX_SEATS; i++) {
      tx = await erProgram.methods
        .undelegateSeat()
        .accountsPartial({
          payer: provider.wallet.publicKey,
          seat: seats[i],
          hole: holes[i],
        })
        .transaction();
      await sendEr(
        tx,
        [(provider.wallet as anchor.Wallet).payer],
        `undelegate_seat ${i}`,
      );
    }

    // Wait for ownership to return to the program on the base layer.
    for (let tries = 0; tries < 40; tries++) {
      const info = await connection.getAccountInfo(table);
      if (info?.owner.equals(program.programId)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const owner = (await connection.getAccountInfo(table))?.owner;
    assert.equal(owner?.toBase58(), program.programId.toBase58());

    // Nothing card-shaped may have ridden the commit back to the public layer.
    const deck = await program.account.deck.fetch(deckPda);
    assert.isTrue(
      deck.cards.every((c) => c === 0xff),
      "no card data may reach the base layer",
    );
    console.log("  undelegated; base-layer deck contains no card data");
  });

  it("reports measured action latency", () => {
    assert.isAbove(actionLatencies.length, 0, "no actions were measured");
    const sorted = [...actionLatencies].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const avg = Math.round(
      actionLatencies.reduce((a, b) => a + b, 0) / actionLatencies.length,
    );
    const p50 = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `\n  ${actionLatencies.length} session-key actions on the ER\n` +
        `  min ${min}ms   p50 ${p50}ms   avg ${avg}ms   max ${max}ms\n` +
        `  (send -> 'confirmed' round trip from this machine)`,
    );
  });
});
