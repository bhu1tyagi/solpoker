/**
 * Drive a real hand on devnet through the app's own modules.
 *
 * This is the browser gate minus the browser: it uses the same instruction
 * builders, the same hand-encoded session instruction, the same crank state
 * machine and the same verifier that the UI uses. If this passes, the only
 * things left untested are React and the wallet adapter.
 *
 * Two players, because two is the smallest real table and the point is to see
 * the crank converge with more than one client wanting to act.
 *
 *   npx vitest run --config vitest.devnet.config.ts src/lib/play.devnet.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { makeProgram, type SolpokerProgram } from "./anchor";
import { decodeConfig, decodeHand, decodeHole, decodeSeat, decodeTable } from "./decode";
import {
  claimFaucetIx,
  createHistoryIx,
  createHoleIx,
  createSeatIx,
  createTableIx,
  delegateCoreIx,
  delegateSeatIx,
  initPlayerIx,
  joinTableIx,
  leaveTableIx,
  secureDeckIx,
  secureHoleIx,
  undelegateCoreIx,
  undelegateSeatIx,
} from "./instructions";
import { configPda, handPda, holePda, playerPda, seatPda, tablePda } from "./pdas";
import { ensureSession } from "./session";
import { Crank, type CrankSnapshot } from "./crank";
import { sendEr, sleep } from "./net";
import { verify } from "./verifier/verify-shuffle";
import { BASE_RPC, MAX_SEATS, SALT_REVEALED, TEE_URL } from "./constants";
import type { HandView, SeatView, TableView } from "@/stores/table-store";

const FUNDER_PATH = `${process.env.HOME}/.config/solana/id.json`;
const BUY_IN = 1_000;
const SEATED = 2;

const readFunder = async () => {
  const { readFileSync } = await import("node:fs");
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(FUNDER_PATH, "utf8"))),
  );
};

/** An auth token for the rollup, signed by a raw keypair. */
async function teeConnection(kp: Keypair): Promise<Connection> {
  const nacl = await import("tweetnacl");
  const bs58 = (await import("bs58")).default;

  const res = await fetch(`${TEE_URL}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`);
  const { challenge } = (await res.json()) as { challenge: string };
  const sig = nacl.default.sign.detached(
    new TextEncoder().encode(challenge),
    kp.secretKey,
  );
  const login = await fetch(`${TEE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: kp.publicKey.toBase58(),
      challenge,
      signature: bs58.encode(sig),
    }),
  });
  const { token } = (await login.json()) as { token: string };
  return new Connection(`${TEE_URL}?token=${token}`, { commitment: "confirmed" });
}

async function sendBase(
  conn: Connection,
  ixs: Awaited<ReturnType<typeof initPlayerIx>>[],
  signers: Keypair[],
  label: string,
) {
  const tx = new Transaction().add(...ixs);
  const bh = await conn.getLatestBlockhash();
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) {
    const d = await conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    throw new Error(`${label}: ${JSON.stringify(conf.value.err)}\n${(d?.meta?.logMessages ?? []).join("\n")}`);
  }
  return sig;
}

describe("a real hand, through the app's modules", () => {
  it("creates, seats, plays and verifies", async () => {
    const base = new Connection(BASE_RPC, "confirmed");
    const funder = await readFunder();
    const program = makeProgram(base);

    const players = [Keypair.generate(), Keypair.generate()];
    const tableId = new BN(Math.floor(Date.now() / 1000));
    const table = tablePda(tableId);
    const config = configPda(tableId);

    console.log(`  table ${tableId.toString()}`);

    // --- fund the players -------------------------------------------------
    await sendBase(
      base,
      players.map((p) =>
        SystemProgram.transfer({
          fromPubkey: funder.publicKey,
          toPubkey: p.publicKey,
          lamports: 0.09 * LAMPORTS_PER_SOL,
        }),
      ),
      [funder],
      "fund players",
    );

    // --- accounts, batched the way the create wizard does it --------------
    for (const p of players) {
      await sendBase(
        base,
        [await initPlayerIx(program, p.publicKey), await claimFaucetIx(program, p.publicKey)],
        [p],
        "init and claim",
      );
    }

    await sendBase(
      base,
      [
        await createTableIx(
          program,
          {
            tableId,
            smallBlind: 5,
            bigBlind: 10,
            minBuyIn: 200,
            maxBuyIn: 2_000,
            timeoutSecs: 15,
          },
          funder.publicKey,
        ),
        await createHistoryIx(program, table, funder.publicKey),
      ],
      [funder],
      "create table",
    );

    const seatIxs = [];
    const holeIxs = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      seatIxs.push(await createSeatIx(program, table, i, funder.publicKey));
      holeIxs.push(await createHoleIx(program, table, i, funder.publicKey));
    }
    await sendBase(base, seatIxs, [funder], "create seats");
    await sendBase(base, holeIxs, [funder], "create holes");
    console.log("  accounts created in 4 transactions");

    // --- sit down ----------------------------------------------------------
    for (let i = 0; i < SEATED; i++) {
      await sendBase(
        base,
        [await joinTableIx(program, tableId, i, BUY_IN, players[i].publicKey)],
        [players[i]],
        `join ${i}`,
      );
    }

    // --- session keys, using the app's own encoding -----------------------
    const sessions: Awaited<ReturnType<typeof ensureSession>>[] = [];
    for (const p of players) {
      const s = await ensureSession(base, p.publicKey, async (tx) => {
        tx.partialSign(p);
        return tx;
      });
      sessions.push(s);
      await sendBase(
        base,
        [
          SystemProgram.transfer({
            fromPubkey: funder.publicKey,
            toPubkey: s.keypair.publicKey,
            lamports: 0.05 * LAMPORTS_PER_SOL,
          }),
        ],
        [funder],
        "fund session key",
      );
    }
    console.log("  session keys authorised");

    // --- delegate, paid for by a session key ------------------------------
    const payer = sessions[0].keypair;
    await sendBase(
      base,
      [await delegateCoreIx(program, tableId, payer.publicKey)],
      [payer],
      "delegate core",
    );
    for (let i = 0; i < MAX_SEATS; i++) {
      await sendBase(
        base,
        [await delegateSeatIx(program, table, i, payer.publicKey)],
        [payer],
        `delegate seat ${i}`,
      );
    }
    await sleep(4000);
    console.log("  delegated, session key paid for it");

    // --- authenticated rollup connections ---------------------------------
    const erConns = await Promise.all(players.map((p) => teeConnection(p)));
    const erPrograms = erConns.map((c) => makeProgram(c));
    const dealerConn = erConns[0];
    const dealerProgram = erPrograms[0];

    // --- lock the cards down ----------------------------------------------
    const secure = async (ix: Awaited<ReturnType<typeof secureDeckIx>>, label: string) => {
      await sendEr(dealerConn, new Transaction().add(ix), {
        signers: [payer],
        feePayer: payer.publicKey,
        label,
      });
    };
    await secure(await secureDeckIx(dealerProgram, table, payer.publicKey), "secure deck");
    for (let i = 0; i < SEATED; i++) {
      await secure(await secureHoleIx(dealerProgram, table, i, payer.publicKey), `secure ${i}`);
    }
    await sleep(2500);
    console.log("  deck and hole cards secured");

    // --- privacy actually holds -------------------------------------------
    const otherRead = await erConns[1].getAccountInfo(holePda(table, 0));
    expect(otherRead, "seat 1 must not read seat 0's cards").toBeNull();
    const deckRead = await erConns[0].getAccountInfo(
      (await import("./pdas")).deckPda(table),
    );
    expect(deckRead, "nobody reads the deck").toBeNull();
    console.log("  opponent cards and the deck are unreadable");

    // --- one crank per player, exactly like two browsers ------------------
    const cranks = players.map((p, i) => {
      const cfg = configPda(tableId);
      return new Crank({
        connection: erConns[i],
        program: erPrograms[i],
        table,
        config: cfg,
        session: sessions[i].keypair,
        sessionToken: sessions[i].tokenPda,
        wallet: p.publicKey,
        mySeat: i,
        captureReady: () => true,
        onError: (e, step) => console.log(`    [seat ${i}] ${step}: ${String(e).slice(0, 160)}`),
      });
    });

    const snapshot = async (conn: Connection, seat: number): Promise<CrankSnapshot> => {
      const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
      const infos = await conn.getMultipleAccountsInfo(
        [table, handPda(table), ...seats, holePda(table, seat)],
        "processed",
      );
      return {
        table: infos[0] ? decodeTable(new Uint8Array(infos[0].data), table.toBase58()) : null,
        hand: infos[1] ? decodeHand(new Uint8Array(infos[1].data)) : null,
        seats: seats.map((_, i) =>
          infos[2 + i] ? decodeSeat(new Uint8Array(infos[2 + i]!.data)) : null,
        ),
        myHoleHandNumber: infos[8] ? decodeHole(new Uint8Array(infos[8].data)).handNumber : 0,
      };
    };

    // Play until the hand settles. Both cranks run, racing and recovering.
    let settled: CrankSnapshot | null = null;
    let lastLog = "";
    /**
     * Salts have to be collected while the hand is live. Settlement clears the
     * salt state and the next hand's commit overwrites the bytes, so reading
     * them afterwards finds nothing to verify.
     */
    const saltBuffer = new Map<number, { commit: string; salt: string }>();
    /** Settlement resets the dealt-in mask too, so remember it while it lasts. */
    let dealtInSeen = 0;
    for (let round = 0; round < 220; round++) {
      for (let i = 0; i < SEATED; i++) {
        const snap = await snapshot(erConns[i], i);

        if (i === 0) {
          const line = `state ${snap.table?.state} hand ${snap.hand?.handNumber} street ${snap.hand?.street} toAct ${snap.hand?.toAct} shuffle ${snap.hand?.shuffleState}`;
          if (line !== lastLog) {
            console.log(`    ${line}`);
            lastLog = line;
          }
          // Grab salts and the dealt-in mask while they are still there.
          if (snap.table?.state === 1) dealtInSeen |= snap.hand?.dealtIn ?? 0;
          for (let s = 0; s < MAX_SEATS; s++) {
            const seat = snap.seats[s];
            if (seat?.saltState === SALT_REVEALED && !saltBuffer.has(s)) {
              saltBuffer.set(s, { commit: seat.saltCommit, salt: seat.salt });
            }
          }
        }

        // A settled hand: back to waiting, at showdown, with a result.
        if (
          snap.table?.state === 0 &&
          snap.hand &&
          snap.hand.handNumber > 0 &&
          snap.hand.street >= 4 &&
          snap.hand.resultHash !== "0".repeat(64)
        ) {
          settled = snap;
          break;
        }

        await cranks[i].tick(snap);

        // The crank never bets. A real client's player does that, so here the
        // simplest legal action stands in for one.
        if (snap.hand && snap.hand.toAct === i && snap.table?.state === 1) {
          const seat = snap.seats[i];
          const owed = Math.max(0, snap.hand.currentBet - (seat?.committedStreet ?? 0));
          const { playerActionIx, MOVES } = await import("./instructions");
          const ix = await playerActionIx(
            erPrograms[i],
            table,
            config,
            owed > 0 ? MOVES.call : MOVES.check,
            {
              payer: sessions[i].keypair.publicKey,
              authority: players[i].publicKey,
              sessionToken: sessions[i].tokenPda,
            },
          );
          try {
            await sendEr(erConns[i], new Transaction().add(ix), {
              signers: [sessions[i].keypair],
              feePayer: sessions[i].keypair.publicKey,
              label: owed > 0 ? "call" : "check",
            });
          } catch (e) {
            console.log(`    [seat ${i}] action: ${String(e).slice(0, 120)}`);
          }
        }
      }
      if (settled) break;
      await sleep(600);
    }

    expect(settled, "the hand must reach a settlement").not.toBeNull();
    const hand = settled!.hand!;
    console.log(`  hand ${hand.handNumber} settled, board ${hand.board.join(",")}`);

    // --- chips are conserved ----------------------------------------------
    const total = settled!.seats.reduce((a, s) => a + (s?.stack ?? 0), 0);
    expect(total, "chips must be conserved").toBe(SEATED * BUY_IN);

    // --- your own cards were readable, and only by you --------------------
    const mine = await erConns[0].getAccountInfo(holePda(table, 0));
    expect(mine, "you can always read your own hole account").not.toBeNull();

    // --- the shuffle verifies ---------------------------------------------
    const record = {
      handNumber: hand.handNumber,
      vrfRandomness: hand.vrfRandomness,
      shuffleSeed: hand.shuffleSeed,
      board: hand.board,
      seats: Array.from({ length: MAX_SEATS }, (_, i) => {
        const s = saltBuffer.get(i);
        return {
          index: i,
          dealtIn: (dealtInSeen & (1 << i)) !== 0,
          saltCommit: s?.commit ?? "",
          salt: s?.salt ?? null,
          revealed: hand.revealedMask & (1 << i) ? hand.revealed[i] : null,
        };
      }).filter((s) => s.dealtIn || s.salt),
    };

    const result = verify(record);
    if (!result.ok) {
      console.log("  verifier problems:", result.problems);
      // Say where the cards really sit, so a mismatch names its own cause.
      const deck = result.deck;
      console.log("  dealtIn seen:", dealtInSeen.toString(2));
      console.log("  board positions in deck:", hand.board.map((c) => deck.indexOf(c)));
      for (let i = 0; i < MAX_SEATS; i++) {
        if (hand.revealedMask & (1 << i)) {
          console.log(`  seat ${i} positions:`, hand.revealed[i].map((c) => deck.indexOf(c)));
        }
      }
    }
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    console.log(`  verified: deck matches the published seed ${result.seed.slice(0, 16)}...`);

    // A tampered salt must be caught, or the check means nothing.
    const tampered = structuredClone(record);
    if (tampered.seats[0].salt) {
      tampered.seats[0].salt = "ff".repeat(32);
      expect(verify(tampered).ok).toBe(false);
      console.log("  a tampered salt is rejected");
    }

    // --- cash out ----------------------------------------------------------
    await sendEr(dealerConn, new Transaction().add(await undelegateCoreIx(dealerProgram, table, payer.publicKey)), {
      signers: [payer],
      feePayer: payer.publicKey,
      label: "undelegate core",
    });
    for (let i = 0; i < MAX_SEATS; i++) {
      await sendEr(
        dealerConn,
        new Transaction().add(await undelegateSeatIx(dealerProgram, table, i, payer.publicKey)),
        { signers: [payer], feePayer: payer.publicKey, label: `undelegate seat ${i}` },
      );
    }

    const all = [table, ...Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i))];
    for (let t = 0; t < 60; t++) {
      const infos = await base.getMultipleAccountsInfo(all);
      if (infos.every((i) => i?.owner.equals(program.programId))) break;
      await sleep(1000);
    }

    let cashedOut = 0;
    for (let i = 0; i < SEATED; i++) {
      await sendBase(
        base,
        [await leaveTableIx(program, table, i, players[i].publicKey)],
        [players[i]],
        `leave ${i}`,
      );
      const info = await base.getAccountInfo(playerPda(players[i].publicKey));
      cashedOut += (await import("./decode")).decodePlayer(new Uint8Array(info!.data)).chips;
    }
    expect(cashedOut, "every faucet chip is still accounted for").toBe(SEATED * 10_000);
    console.log(`  both players cashed out, ${cashedOut} chips across balances`);
  }, 900_000);
});
