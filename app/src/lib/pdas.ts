import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  PERMISSION_PROGRAM,
  PROGRAM_ID,
  SESSION_PROGRAM,
  USDC_MINT,
} from "./constants";

const enc = (s: string) => new TextEncoder().encode(s);

const find = (seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

/** u64 little endian, the encoding every table id seed uses. */
const u64 = (n: BN) => Uint8Array.from(n.toArray("le", 8));

export const playerPda = (owner: PublicKey) =>
  find([enc("player"), owner.toBytes()]);

/** Owns the token account holding every outstanding chip's backing. */
export const vaultPda = () => find([enc("vault")]);

/**
 * A wallet's USDC account. `allowOwnerOffCurve` is on because the vault is a
 * PDA and has no private key; without it this throws on the one address that
 * matters most.
 */
export const usdcAta = (owner: PublicKey) =>
  getAssociatedTokenAddressSync(USDC_MINT, owner, true);

export const configPda = (tableId: BN) => find([enc("config"), u64(tableId)]);

export const tablePda = (tableId: BN) => find([enc("table"), u64(tableId)]);

export const seatPda = (table: PublicKey, i: number) =>
  find([enc("seat"), table.toBytes(), Uint8Array.from([i])]);

export const holePda = (table: PublicKey, i: number) =>
  find([enc("hole"), table.toBytes(), Uint8Array.from([i])]);

export const handPda = (table: PublicKey) => find([enc("hand"), table.toBytes()]);

export const deckPda = (table: PublicKey) => find([enc("deck"), table.toBytes()]);

export const historyPda = (table: PublicKey) =>
  find([enc("history"), table.toBytes()]);

/** Access-control PDA guarding a private account. Note the trailing colon. */
export const permissionPda = (account: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [enc("permission:"), account.toBytes()],
    PERMISSION_PROGRAM,
  )[0];

/** Session token, owned by the session-keys program rather than ours. */
export const sessionTokenPda = (sessionSigner: PublicKey, authority: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [
      enc("session_token_v2"),
      PROGRAM_ID.toBytes(),
      sessionSigner.toBytes(),
      authority.toBytes(),
    ],
    SESSION_PROGRAM,
  )[0];

/** All six seats and holes for a table, in index order. Settlement needs this order. */
export function tableAccounts(table: PublicKey) {
  const seats: PublicKey[] = [];
  const holes: PublicKey[] = [];
  for (let i = 0; i < 6; i++) {
    seats.push(seatPda(table, i));
    holes.push(holePda(table, i));
  }
  return {
    seats,
    holes,
    hand: handPda(table),
    deck: deckPda(table),
    history: historyPda(table),
  };
}

/** The seat_0..seat_5 account map every betting instruction takes. */
export function seatAccountsMap(seats: PublicKey[]) {
  return {
    seat0: seats[0],
    seat1: seats[1],
    seat2: seats[2],
    seat3: seats[3],
    seat4: seats[4],
    seat5: seats[5],
  };
}
