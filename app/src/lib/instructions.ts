/**
 * Building the transactions.
 *
 * Split by layer, because the split is the security model. Base-layer calls
 * move chips between a balance and a seat and always need the wallet. Rollup
 * calls play the hand and take a session key.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import type { SolpokerProgram } from "./anchor";
import {
  DELEGATION_PROGRAM,
  EPHEMERAL_VAULT,
  MAGIC_PROGRAM,
  MAX_SEATS,
  ORACLE_QUEUE,
  PERMISSION_PROGRAM,
  PROGRAM_ID,
  VALIDATOR,
} from "./constants";
import {
  configPda,
  handPda,
  deckPda,
  historyPda,
  holePda,
  permissionPda,
  playerPda,
  seatAccountsMap,
  seatPda,
  tablePda,
} from "./pdas";

export type Move =
  | { fold: Record<string, never> }
  | { check: Record<string, never> }
  | { call: Record<string, never> }
  | { raiseTo: [BN] }
  | { allIn: Record<string, never> };

export const MOVES = {
  fold: { fold: {} } as Move,
  check: { check: {} } as Move,
  call: { call: {} } as Move,
  allIn: { allIn: {} } as Move,
  raiseTo: (to: number): Move => ({ raiseTo: [new BN(to)] }),
};

/** Permission accounts, identical for securing the deck and any hole account. */
const permAccounts = {
  permissionProgram: PERMISSION_PROGRAM,
  ephemeralVault: EPHEMERAL_VAULT,
  magicProgram: MAGIC_PROGRAM,
};

// ---------------------------------------------------------------- base layer

export async function initPlayerIx(program: SolpokerProgram, authority: PublicKey) {
  return program.methods.initPlayer().accounts({ authority }).instruction();
}

export async function claimFaucetIx(program: SolpokerProgram, authority: PublicKey) {
  return program.methods
    .claimFaucet()
    .accountsPartial({ player: playerPda(authority), authority })
    .instruction();
}

export interface TableParams {
  tableId: BN;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  timeoutSecs: number;
}

export async function createTableIx(
  program: SolpokerProgram,
  p: TableParams,
  creator: PublicKey,
) {
  const table = tablePda(p.tableId);
  return program.methods
    .createTable(
      p.tableId,
      new BN(p.smallBlind),
      new BN(p.bigBlind),
      new BN(p.minBuyIn),
      new BN(p.maxBuyIn),
      new BN(p.timeoutSecs),
    )
    .accountsPartial({
      config: configPda(p.tableId),
      table,
      hand: handPda(table),
      deck: deckPda(table),
      creator,
    })
    .instruction();
}

export async function createHistoryIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  return program.methods
    .createHistory()
    .accountsPartial({ table, history: historyPda(table), payer })
    .instruction();
}

export async function createSeatIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  payer: PublicKey,
) {
  return program.methods
    .createSeat(i)
    .accountsPartial({ table, seat: seatPda(table, i), payer })
    .instruction();
}

export async function createHoleIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  payer: PublicKey,
) {
  return program.methods
    .createHole(i)
    .accountsPartial({ table, hole: holePda(table, i), payer })
    .instruction();
}

/** Wallet only. This moves chips out of your balance. */
export async function joinTableIx(
  program: SolpokerProgram,
  tableId: BN,
  i: number,
  buyIn: number,
  authority: PublicKey,
) {
  const table = tablePda(tableId);
  return program.methods
    .joinTable(i, new BN(buyIn))
    .accountsPartial({
      table,
      config: configPda(tableId),
      seat: seatPda(table, i),
      player: playerPda(authority),
      authority,
    })
    .instruction();
}

/** Wallet only. This moves chips back into your balance. */
export async function leaveTableIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  authority: PublicKey,
) {
  return program.methods
    .leaveTable(i)
    .accountsPartial({
      table,
      seat: seatPda(table, i),
      player: playerPda(authority),
      authority,
    })
    .instruction();
}

export async function delegateCoreIx(
  program: SolpokerProgram,
  tableId: BN,
  payer: PublicKey,
) {
  const table = tablePda(tableId);
  return program.methods
    .delegateCore(tableId)
    .accountsPartial({
      payer,
      table,
      hand: handPda(table),
      deck: deckPda(table),
      validator: VALIDATOR,
    })
    .instruction();
}

export async function delegateSeatIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  payer: PublicKey,
) {
  return program.methods
    .delegateSeat(i)
    .accountsPartial({
      payer,
      table,
      seat: seatPda(table, i),
      hole: holePda(table, i),
      validator: VALIDATOR,
    })
    .instruction();
}

// -------------------------------------------------------------- the rollup

export async function secureDeckIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  const deck = deckPda(table);
  return program.methods
    .secureDeck()
    .accountsPartial({ deck, permission: permissionPda(deck), payer, ...permAccounts })
    .instruction();
}

export async function secureHoleIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  payer: PublicKey,
) {
  const hole = holePda(table, i);
  return program.methods
    .secureHole(i)
    .accountsPartial({
      hole,
      seat: seatPda(table, i),
      permission: permissionPda(hole),
      payer,
      ...permAccounts,
    })
    .instruction();
}

export interface SessionSigner {
  payer: PublicKey;
  authority: PublicKey;
  sessionToken: PublicKey | null;
}

export async function commitSaltIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  commitment: Uint8Array,
  signer: SessionSigner,
) {
  return program.methods
    .commitSalt(i, Array.from(commitment))
    .accountsPartial({
      payer: signer.payer,
      authority: signer.authority,
      hand: handPda(table),
      seat: seatPda(table, i),
      sessionToken: signer.sessionToken,
    })
    .instruction();
}

export async function revealSaltIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  salt: Uint8Array,
  signer: SessionSigner,
) {
  return program.methods
    .revealSalt(i, Array.from(salt))
    .accountsPartial({
      payer: signer.payer,
      authority: signer.authority,
      hand: handPda(table),
      seat: seatPda(table, i),
      sessionToken: signer.sessionToken,
    })
    .instruction();
}

export async function requestShuffleIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  return program.methods
    .requestShuffle()
    .accountsPartial({
      payer,
      hand: handPda(table),
      deck: deckPda(table),
      oracleQueue: ORACLE_QUEUE,
    })
    .instruction();
}

export async function startHandIx(
  program: SolpokerProgram,
  table: PublicKey,
  config: PublicKey,
  payer: PublicKey,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  return program.methods
    .startHand()
    .accountsPartial({
      table,
      config,
      hand: handPda(table),
      deck: deckPda(table),
      ...seatAccountsMap(seats),
      payer,
    })
    .instruction();
}

export async function dealHoleCardsIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  const holes = Array.from({ length: MAX_SEATS }, (_, i) => holePda(table, i));
  return program.methods
    .dealHoleCards()
    .accountsPartial({
      hand: handPda(table),
      deck: deckPda(table),
      hole0: holes[0],
      hole1: holes[1],
      hole2: holes[2],
      hole3: holes[3],
      hole4: holes[4],
      hole5: holes[5],
      payer,
    })
    .instruction();
}

export async function advanceStreetIx(
  program: SolpokerProgram,
  table: PublicKey,
  config: PublicKey,
  payer: PublicKey,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  return program.methods
    .advanceStreet()
    .accountsPartial({
      hand: handPda(table),
      config,
      deck: deckPda(table),
      ...seatAccountsMap(seats),
      payer,
    })
    .instruction();
}

export async function playerActionIx(
  program: SolpokerProgram,
  table: PublicKey,
  config: PublicKey,
  move: Move,
  signer: SessionSigner,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  return program.methods
    .playerAction(move as never)
    .accountsPartial({
      payer: signer.payer,
      authority: signer.authority,
      hand: handPda(table),
      config,
      ...seatAccountsMap(seats),
      sessionToken: signer.sessionToken,
    })
    .instruction();
}

/** Permissionless. The clock must not depend on any one client. */
export async function forceTimeoutIx(
  program: SolpokerProgram,
  table: PublicKey,
  config: PublicKey,
  payer: PublicKey,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  return program.methods
    .forceTimeout()
    .accountsPartial({
      hand: handPda(table),
      config,
      ...seatAccountsMap(seats),
      payer,
    })
    .instruction();
}

/**
 * Settle. The six hole accounts ride as remaining accounts in strict seat
 * order, including empty seats, because settlement re-derives each address and
 * refuses anything else. They are writable because settling wipes them.
 */
export async function settleHandIx(
  program: SolpokerProgram,
  table: PublicKey,
  config: PublicKey,
  payer: PublicKey,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  const holes = Array.from({ length: MAX_SEATS }, (_, i) => holePda(table, i));
  return program.methods
    .settleHand()
    .accountsPartial({
      table,
      config,
      hand: handPda(table),
      deck: deckPda(table),
      ...seatAccountsMap(seats),
      payer,
    })
    .remainingAccounts(
      holes.map((pubkey) => ({ pubkey, isWritable: true, isSigner: false })),
    )
    .instruction();
}

export async function commitResultsIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  return program.methods
    .commitResults()
    .accountsPartial({
      payer,
      table,
      hand: handPda(table),
      history: historyPda(table),
      programId: PROGRAM_ID,
    })
    .instruction();
}

export async function undelegateCoreIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  return program.methods
    .undelegateCore()
    .accountsPartial({ payer, table, hand: handPda(table), deck: deckPda(table) })
    .instruction();
}

export async function undelegateSeatIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  payer: PublicKey,
) {
  return program.methods
    .undelegateSeat()
    .accountsPartial({ payer, seat: seatPda(table, i), hole: holePda(table, i) })
    .instruction();
}

// ------------------------------------------------------------------ helpers

export async function isDelegated(connection: Connection, account: PublicKey) {
  const info = await connection.getAccountInfo(account);
  return info?.owner.equals(DELEGATION_PROGRAM) ?? false;
}

/** Wrap instructions into a transaction ready for a wallet to sign. */
export async function buildTx(
  connection: Connection,
  instructions: Awaited<ReturnType<typeof initPlayerIx>>[],
  feePayer: PublicKey,
  extraSigners: Keypair[] = [],
): Promise<Transaction> {
  const tx = new Transaction().add(...instructions);
  tx.feePayer = feePayer;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  if (extraSigners.length) tx.partialSign(...extraSigners);
  return tx;
}
