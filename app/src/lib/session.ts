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
import { CLUSTER, PROGRAM_ID, SESSION_PROGRAM } from "./constants";

/** How long a session lasts before the player is asked again. */
const VALIDITY_SECS = 24 * 60 * 60;
/**
 * Enough lamports for a day of betting, the crank work a client does, and the
 * delegation rent it fronts when it starts a table (refunded on undelegation).
 */
const TOP_UP_LAMPORTS = 0.05 * 1_000_000_000;

/**
 * What authorising a session actually takes out of the wallet: the key's float,
 * the rent for its token account, and the fee.
 *
 * This number existed only inside the session program before, which meant a
 * wallet holding less than it got no warning and no readable failure — the
 * top-up transfer ran out of lamports inside a CPI and came back as
 * `custom program error: 0x1`, which tells a player nothing at all.
 */
export const SESSION_COST_LAMPORTS = TOP_UP_LAMPORTS + 2_500_000;
/** Renew rather than start a hand on a session about to expire. */
const RENEW_WITHIN_SECS = 60 * 60;

export interface StoredSession {
  secret: string;
  tokenPda: string;
  validUntil: number;
}

/**
 * Keyed by cluster as well as wallet: a session token is a PDA on one chain and
 * nothing at all on the other, so sharing a key between them means loading a
 * session that cannot possibly work and having no way to tell why.
 */
const storageKey = (wallet: PublicKey) =>
  `solpoker:session:${CLUSTER}:${wallet.toBase58()}`;

export function loadSession(wallet: PublicKey): {
  keypair: Keypair;
  tokenPda: PublicKey;
  validUntil: number;
} | null {
  if (typeof window === "undefined") return null;
  try {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey(wallet));
    } catch {
      // Blocked origin; fall through to the in-memory copy.
    }
    const s: StoredSession | undefined = raw
      ? (JSON.parse(raw) as StoredSession)
      : memorySessions.get(storageKey(wallet));
    if (!s) return null;
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

/**
 * Last resort when storage refuses.
 *
 * A session key is a funded keypair. If `localStorage.setItem` throws — Safari
 * private mode, a full quota, a blocked origin — after the session has been
 * created and topped up on chain, the only copy of that key is gone and the SOL
 * with it, and the next attempt funds another one. Keeping it in memory means
 * the tab still plays and the money is still reachable; it simply does not
 * survive a reload.
 */
const memorySessions = new Map<string, StoredSession>();

/**
 * The stored keypair regardless of how close to expiry it is.
 *
 * `loadSession` deliberately reports null once a session is inside its renewal
 * window, which is right for "may I still play with this" and wrong for "is
 * there money in here to recover".
 */
function readStoredKeypair(wallet: PublicKey): Keypair | null {
  if (typeof window === "undefined") return null;
  try {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey(wallet));
    } catch {
      // Blocked origin; fall through to the in-memory copy.
    }
    const s: StoredSession | undefined = raw
      ? (JSON.parse(raw) as StoredSession)
      : memorySessions.get(storageKey(wallet));
    return s ? Keypair.fromSecretKey(bs58.decode(s.secret)) : null;
  } catch {
    return null;
  }
}

function storeSession(wallet: PublicKey, keypair: Keypair, tokenPda: PublicKey, validUntil: number) {
  if (typeof window === "undefined") return;
  const value: StoredSession = {
    secret: bs58.encode(keypair.secretKey),
    tokenPda: tokenPda.toBase58(),
    validUntil,
  };
  memorySessions.set(storageKey(wallet), value);
  try {
    window.localStorage.setItem(storageKey(wallet), JSON.stringify(value));
  } catch {
    // Held in memory instead. See `memorySessions`.
  }
}

/**
 * Send whatever is left on an expiring session key back to its owner.
 *
 * Sessions rotate daily and each one is topped up with real SOL, so without
 * this every rotation abandons the remainder of yesterday's balance in a
 * keypair that is about to be overwritten. On devnet that was invisible. On
 * mainnet it is a slow leak of the player's own money, every single day.
 *
 * Best effort by design: it is not worth blocking a player from sitting down
 * over a few thousand lamports, and the next rotation will try again.
 */
async function sweepOldSession(
  connection: Connection,
  old: { keypair: Keypair },
  wallet: PublicKey,
): Promise<void> {
  try {
    const balance = await connection.getBalance(old.keypair.publicKey);
    // Leave the fee for the sweep itself; below that there is nothing to send.
    const fee = 5_000;
    if (balance <= fee) return;

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: old.keypair.publicKey,
        toPubkey: wallet,
        lamports: balance - fee,
      }),
    );
    tx.feePayer = old.keypair.publicKey;
    const bh = await connection.getLatestBlockhash();
    tx.recentBlockhash = bh.blockhash;
    tx.sign(old.keypair);
    const sig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  } catch {
    // Nothing to recover, or the network refused. Not worth surfacing.
  }
}

export function clearSession(wallet: PublicKey) {
  if (typeof window === "undefined") return;
  memorySessions.delete(storageKey(wallet));
  try {
    window.localStorage.removeItem(storageKey(wallet));
  } catch {
    // Nothing stored there to begin with.
  }
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

  // A session that has aged out is still a funded keypair. Recover what is left
  // of it before its only copy is overwritten. `loadSession` returns null for
  // one inside its renewal window, so the stored record is read directly.
  const expiring = readStoredKeypair(wallet);
  if (expiring) {
    await sweepOldSession(connection, { keypair: expiring }, wallet);
  }

  // Ask before spending. The session program funds the key through a CPI, and
  // a wallet that cannot cover it fails inside that CPI as
  // `custom program error: 0x1` — a System Program "negative lamports" wearing
  // someone else's error code, which reads as a bug in this program rather
  // than an empty wallet.
  const balance = await connection.getBalance(wallet);
  if (balance < SESSION_COST_LAMPORTS) {
    const need = (SESSION_COST_LAMPORTS / 1e9).toFixed(3);
    const has = (balance / 1e9).toFixed(4);
    throw new Error(
      `Playing needs about ${need} SOL in this wallet for the session key and network fees, ` +
        `and it holds ${has}. Chips are bought with USDC, but Solana charges its fees in SOL. ` +
        `Top up and try again — the SOL comes back when the session is swept.`,
    );
  }

  const keypair = Keypair.generate();
  const validUntil = Math.floor(Date.now() / 1000) + VALIDITY_SECS;
  const { ix, tokenPda } = createSessionV2Ix(keypair.publicKey, wallet, validUntil);

  // Every await here is bounded and named. This flow hung silently in the
  // wild — no throw, no toast, just an authorise button that never came back —
  // and an unbounded await cannot say which step it was. A deadline turns a
  // stall into an error that names the stage.
  const staged = async <T,>(stage: string, ms: number, p: Promise<T>): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          t = setTimeout(
            () => reject(new Error(`session authorise timed out at: ${stage}`)),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(t);
    }
  };

  const tx = new Transaction().add(ix);
  tx.feePayer = wallet;
  tx.recentBlockhash = (
    await staged("fetch blockhash", 20_000, connection.getLatestBlockhash())
  ).blockhash;
  // Both must sign: the wallet authorises, the session key proves it exists.
  tx.partialSign(keypair);
  const signed = await staged("wallet signature", 120_000, signTransaction(tx));

  // Preflight on: a doomed create should fail in one simulated round trip
  // with the program's own error, not ride the full confirmation window.
  const sig = await staged(
    "send",
    20_000,
    connection.sendRawTransaction(signed.serialize()),
  );
  // Breadcrumbs on purpose, not debug leftovers: authorisation failures
  // surface as a toast, which no automated check can read. The signature in
  // the console is what turns "the button never went away" into a lookup.
  console.log(`session: sent ${sig}`);
  const bh = await staged("fetch confirm blockhash", 20_000, connection.getLatestBlockhash());
  const conf = await staged(
    "confirm",
    90_000,
    connection.confirmTransaction({ signature: sig, ...bh }, "confirmed"),
  );
  if (conf.value.err) {
    console.error(`session: failed on chain ${sig}`, JSON.stringify(conf.value.err));
    throw new Error(`could not authorise a session key: ${JSON.stringify(conf.value.err)}`);
  }
  console.log(`session: confirmed ${sig}`);

  storeSession(wallet, keypair, tokenPda, validUntil);
  return { keypair, tokenPda, validUntil };
}

/** Does the session key have enough SOL left to keep signing? */
export async function sessionBalance(connection: Connection, session: SessionHandle) {
  return connection.getBalance(session.keypair.publicKey);
}
