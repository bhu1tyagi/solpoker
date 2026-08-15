/**
 * Anchor program handles.
 *
 * The IDL is vendored into the app rather than imported from target/, which is
 * gitignored and would not exist on a fresh clone or a deploy build. Re-copy it
 * after any anchor build.
 */

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import idl from "./idl/solpoker.json";
import type { Solpoker } from "./idl/solpoker";

export type SolpokerProgram = Program<Solpoker>;

/**
 * A wallet that cannot sign, for read-only program handles.
 *
 * Anchor requires a wallet to build a provider even when only fetching
 * accounts. Signing throws rather than failing quietly, so a mistake surfaces
 * as an error instead of a mystery.
 */
class ReadOnlyWallet implements Wallet {
  constructor(readonly payer: Keypair = Keypair.generate()) {}
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    throw new Error("this program handle is read only");
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    throw new Error("this program handle is read only");
  }
}

export function makeProgram(
  connection: Connection,
  wallet?: Wallet,
): SolpokerProgram {
  const provider = new AnchorProvider(connection, wallet ?? new ReadOnlyWallet(), {
    commitment: connection.commitment ?? "confirmed",
    skipPreflight: true,
  });
  return new Program(idl as Solpoker, provider);
}

/** The IDL's account coder, for decoding raw account bytes off a subscription. */
export function makeCoder(program: SolpokerProgram) {
  return program.coder.accounts;
}
