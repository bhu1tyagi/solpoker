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
  TREASURY_AUTHORITY,
  USDC_MINT,
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
  usdcAta,
  vaultPda,
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

/** Wallet only: USDC leaves the wallet and chips appear, fully backed. */
export async function buyChipsIx(
  program: SolpokerProgram,
  authority: PublicKey,
  chips: number,
) {
  const vault = vaultPda();
  return program.methods
    .buyChips(new BN(chips))
    .accountsPartial({
      player: playerPda(authority),
      vault,
      usdcMint: USDC_MINT,
      vaultAta: usdcAta(vault),
      buyerAta: usdcAta(authority),
      authority,
    })
    .instruction();
}

/** Wallet only: chips leave the balance and the vault pays USDC back. */
export async function sellChipsIx(
  program: SolpokerProgram,
  authority: PublicKey,
  chips: number,
) {
  const vault = vaultPda();
  return program.methods
    .sellChips(new BN(chips))
    .accountsPartial({
      player: playerPda(authority),
      vault,
      usdcMint: USDC_MINT,
      vaultAta: usdcAta(vault),
      sellerAta: usdcAta(authority),
      authority,
    })
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

/**
 * `join_table`, signable by the session key: sitting down without a prompt.
 *
 * The chips still move only between this player's own balance and a seat
 * assigned to them — the program pins both ends to the session's authority —
 * but a browser-held key may now commit balance into play. That trade was
 * made deliberately; see the program's `sit_down` for the reasoning.
 */
export async function sitDownIx(
  program: SolpokerProgram,
  tableId: BN,
  i: number,
  buyIn: number,
  signer: SessionSigner,
) {
  const table = tablePda(tableId);
  return program.methods
    .sitDown(i, new BN(buyIn))
    .accountsPartial({
      payer: signer.payer,
      authority: signer.authority,
      table,
      config: configPda(tableId),
      seat: seatPda(table, i),
      player: playerPda(signer.authority),
      sessionToken: signer.sessionToken,
    })
    .instruction();
}

/**
 * `leave_table`, signable by the session key: the promptless cash-out.
 *
 * Safe outright — the chips can only go from the occupant's seat to the
 * occupant's own balance, so the key that signs it could at most stand its
 * own player up.
 */
export async function standUpIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  signer: SessionSigner,
) {
  return program.methods
    .standUp(i)
    .accountsPartial({
      payer: signer.payer,
      authority: signer.authority,
      table,
      seat: seatPda(table, i),
      player: playerPda(signer.authority),
      sessionToken: signer.sessionToken,
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

/**
 * Send a seated player home with their chips, so the table can be closed.
 *
 * Creator only, and the chips go to the occupant's own balance, so this can
 * remove someone from a table but never take anything from them.
 */
export async function vacateSeatIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  occupant: PublicKey,
  config: PublicKey,
  /** The creator at any time, or anyone once the table is game-stale. */
  payer: PublicKey,
) {
  return program.methods
    .vacateSeat(i)
    .accountsPartial({
      table,
      config,
      hand: handPda(table),
      seat: seatPda(table, i),
      player: playerPda(occupant),
      payer,
    })
    .instruction();
}

/**
 * Move a table's accrued rake into the house's balance.
 *
 * Base layer only: settlement takes the rake on the rollup, where a `Player`
 * balance cannot be written, so it waits on the table until the table comes
 * back. `close_table` refuses while any is unswept — deleting the table would
 * destroy chips the vault is still backing — so this runs before a delete.
 *
 * Permissionless, and the destination is fixed to the treasury, so whoever is
 * tidying the table can run it.
 */
export async function sweepRakeIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  return program.methods
    .sweepRake()
    .accountsPartial({ table, treasury: playerPda(TREASURY_AUTHORITY), payer })
    .instruction();
}

/**
 * Delete a table you created and reclaim its rent.
 *
 * Every seat must be empty first, so nothing with chips in it can be deleted.
 * The seat and hole accounts ride as remaining accounts because naming all
 * eighteen in one context overflows the BPF stack frame.
 */
export async function closeTableIx(
  program: SolpokerProgram,
  table: PublicKey,
  config: PublicKey,
  creator: PublicKey,
  payer: PublicKey = creator,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  const holes = Array.from({ length: MAX_SEATS }, (_, i) => holePda(table, i));
  return program.methods
    .closeTable()
    .accountsPartial({
      table,
      config,
      hand: handPda(table),
      deck: deckPda(table),
      history: historyPda(table),
      payer,
      creator,
    })
    .remainingAccounts(
      [...seats, ...holes].map((pubkey) => ({
        pubkey,
        isWritable: true,
        isSigner: false,
      })),
    )
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

/**
 * Give up your own hole-card read right, so the next player to take this seat
 * can be secured.
 *
 * Without this, a seat whose occupant changes while the table is paused is dead
 * for the life of the table: the permission still names whoever left, only a
 * member may update one, so nobody can point it at the new player and
 * `start_hand` excludes them from every deal. Called as part of standing up,
 * signed by the session key so it costs no extra prompt.
 */
export async function releaseHoleIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  signer: SessionSigner,
) {
  const hole = holePda(table, i);
  return program.methods
    .releaseHole(i)
    .accountsPartial({
      hole,
      seat: seatPda(table, i),
      permission: permissionPda(hole),
      payer: signer.payer,
      authority: signer.authority,
      sessionToken: signer.sessionToken,
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

/**
 * Unwind a hand that can never finish, refunding every contribution.
 *
 * The break-glass, and the last thing to reach for. It only works an hour past
 * the hand's deadline, by which point `force_timeout` has had the whole hour to
 * end the hand properly and did not. Nobody wins the pot; every seat gets back
 * exactly what it put in, and the table returns to waiting so people can stand
 * up and cash out.
 */
export async function abandonHandIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
  const holes = Array.from({ length: MAX_SEATS }, (_, i) => holePda(table, i));
  return program.methods
    .abandonHand()
    .accountsPartial({
      table,
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

/**
 * Undelegate one seat.
 *
 * The table comes along so the program can refuse while a hand is live. Pulling
 * a seat — any seat, including an empty one — off the rollup mid-hand freezes
 * the table, because every instruction that drives a hand takes all six seats
 * as writable. Note the ordering consequence: seats must now be undelegated
 * *before* the core accounts, since once the table has left the rollup it is no
 * longer there to be checked. See `pauseTable`.
 */
export async function undelegateSeatIx(
  program: SolpokerProgram,
  table: PublicKey,
  i: number,
  payer: PublicKey,
) {
  return program.methods
    .undelegateSeat()
    .accountsPartial({
      payer,
      table,
      seat: seatPda(table, i),
      hole: holePda(table, i),
    })
    .instruction();
}

/**
 * Clear a shuffle request the VRF oracle never answered.
 *
 * Permissionless and time-gated. Without it an unfulfilled request left the
 * table with no way forward and no way out: it could not start a hand, could
 * not settle, and could not undelegate, so every chip on its seats stayed
 * there.
 */
export async function resetShuffleIx(
  program: SolpokerProgram,
  table: PublicKey,
  payer: PublicKey,
) {
  return program.methods
    .resetShuffle()
    .accountsPartial({
      payer,
      table,
      hand: handPda(table),
      deck: deckPda(table),
    })
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
