/**
 * Session keys: playing without a wallet prompt per action.
 *
 * A player authorises a short-lived keypair once, and every bet, salt commit and
 * salt reveal after that is signed by it silently. Without this, poker on chain
 * is unplayable.
 *
 * What a session key can do is deliberately narrow. It can act for its owner at
 * the table. It cannot join, leave, buy, sell, or move a chip between a seat
 * and a balance, because those instructions only accept the wallet. A leaked
 * session key can lose you a pot. It cannot take your chips or your SOL.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import bs58 from "bs58";
import BN from "bn.js";
import { sessionTokenPda } from "./pdas";
import { PROGRAM_ID, SESSION_PROGRAM } from "./constants";

/** How long a session lasts before the player is asked again. */
const VALIDITY_SECS = 24 * 60 * 60;
/**
 * Enough lamports for a day of betting, the crank work a client does, and the
 * delegation rent it fronts when it starts a table (refunded on undelegation).
 */
const TOP_UP_LAMPORTS = 0.05 * 1_000_000_000;
/** Renew rather than start a hand on a session about to expire. */
const RENEW_WITHIN_SECS = 60 * 60;

export interface StoredSession {
  secret: string;
  tokenPda: string;
  validUntil: number;
}

const storageKey = (wallet: PublicKey) => `solpoker:session:${wallet.toBase58()}`;

export function loadSession(wallet: PublicKey): {
  keypair: Keypair;
  tokenPda: PublicKey;
  validUntil: number;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(wallet));
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (s.validUntil - Date.now() / 1000 < RENEW_WITHIN_SECS) return null;

    const keypair = Keypair.fromSecretKey(bs58.decode(s.secret));

    // A session token is bound to the program it was made for, and the stored
    // address is only a cache of that derivation. If the program has changed
    // since, the cached token still exists on chain and still loads, but every
    // action signed with it is refused as an invalid token, with no way back
    // because the authorise button only appears when there is no session at
    // all. Re-deriving and comparing makes a redeployment heal itself.
    const expected = sessionTokenPda(keypair.publicKey, wallet);
    if (expected.toBase58() !== s.tokenPda) {
      window.localStorage.removeItem(storageKey(wallet));
      return null;
    }

    return { keypair, tokenPda: expected, validUntil: s.validUntil };
  } catch {
    return null;
  }
}

function storeSession(wallet: PublicKey, keypair: Keypair, tokenPda: PublicKey, validUntil: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    storageKey(wallet),
    JSON.stringify({
      secret: bs58.encode(keypair.secretKey),
      tokenPda: tokenPda.toBase58(),
      validUntil,
    } satisfies StoredSession),
  );
}

export function clearSession(wallet: PublicKey) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(wallet));
}

/**
 * Build the createSessionV2 instruction by hand.
 *
 * The gum SDK would do this, but it carries its own copy of Anchor, and two
 * copies of PublicKey in one bundle break instanceof checks in confusing ways.
 * The instruction is a discriminator and three optional fields, so it is
 * cheaper to encode it here than to untangle that.
 */
function createSessionV2Ix(
  sessionSigner: PublicKey,
  authority: PublicKey,
  validUntil: number,
) {
  const tokenPda = sessionTokenPda(sessionSigner, authority);

  // Taken from the session program's IDL, not guessed. Args are three options,
  // each a presence byte followed by the value.
  const disc = Buffer.from([223, 233, 108, 7, 65, 194, 235, 38]);
  const topUp = Buffer.from([1, 1]);
  const until = Buffer.concat([
    Buffer.from([1]),
    Buffer.from(new BN(validUntil).toArray("le", 8)),
  ]);
  const lamports = Buffer.concat([
    Buffer.from([1]),
    Buffer.from(new BN(TOP_UP_LAMPORTS).toArray("le", 8)),
  ]);

  return {
    ix: new TransactionInstruction({
      programId: SESSION_PROGRAM,
      keys: [
        { pubkey: tokenPda, isSigner: false, isWritable: true },
        { pubkey: sessionSigner, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc, topUp, until, lamports]),
    }),
    tokenPda,
  };
}

export interface SessionHandle {
  keypair: Keypair;
  tokenPda: PublicKey;
  validUntil: number;
}

/**
 * Get a usable session, creating one if needed.
 *
 * Creating one costs a single wallet prompt and a small SOL top-up, then the
 * table is silent for a day.
 */
export async function ensureSession(
  connection: Connection,
  wallet: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
): Promise<SessionHandle> {
  const existing = loadSession(wallet);
  if (existing) {
    // A session whose token account vanished is not a session.
    const info = await connection.getAccountInfo(existing.tokenPda);
    if (info) return existing;
    clearSession(wallet);
  }

  const keypair = Keypair.generate();
  const validUntil = Math.floor(Date.now() / 1000) + VALIDITY_SECS;
  const { ix, tokenPda } = createSessionV2Ix(keypair.publicKey, wallet, validUntil);

  const tx = new Transaction().add(ix);
  tx.feePayer = wallet;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  // Both must sign: the wallet authorises, the session key proves it exists.
  tx.partialSign(keypair);
  const signed = await signTransaction(tx);

  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  const bh = await connection.getLatestBlockhash();
  const conf = await connection.confirmTransaction(
    { signature: sig, ...bh },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`could not authorise a session key: ${JSON.stringify(conf.value.err)}`);
  }

  storeSession(wallet, keypair, tokenPda, validUntil);
  return { keypair, tokenPda, validUntil };
}

/** Does the session key have enough SOL left to keep signing? */
export async function sessionBalance(connection: Connection, session: SessionHandle) {
  return connection.getBalance(session.keypair.publicKey);
}
