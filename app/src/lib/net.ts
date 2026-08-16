/**
 * Talking to the rollup without losing the thread.
 *
 * Two lessons from the long session runs, both baked in here:
 *
 * 1. confirmTransaction resolves for failed transactions too. With preflight
 *    skipped, a broken instruction looks exactly like a working one unless you
 *    check the error and pull the logs.
 * 2. Blindly retrying a send can apply it twice, because the first attempt may
 *    have landed before the socket died. So a retryable step says how to tell
 *    whether it is already done, and a retry checks that first.
 */

import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { ANCHOR_ERRORS, ERROR_MESSAGES, ERROR_NAMES, RACE_LOST } from "./constants";

/** Failures worth retrying. Everything else is a real error and should surface. */
export const TRANSIENT =
  /fetch failed|Failed to fetch|ECONNRESET|socket hang up|ETIMEDOUT|EPIPE|Blockhash not found|block height exceeded|\b429\b|\b50[234]\b|timed out|NetworkError|Load failed/i;

export const isTransient = (e: unknown) => TRANSIENT.test(String(e));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The program error name behind a failure, if there is one. */
export function errorName(e: unknown): string | null {
  const s = String(e);
  const coded = s.match(/custom program error: 0x([0-9a-f]+)/i);
  if (coded) {
    const code = parseInt(coded[1], 16);
    const name = ERROR_NAMES[code] ?? ANCHOR_ERRORS[code];
    if (name) return name;
  }
  // confirmTransaction reports {"InstructionError":[0,{"Custom":6030}]}, and
  // the log fetch that would name it is best effort. Parse the code directly
  // so a lost race is recognised even when the logs never arrive.
  const custom = s.match(/"Custom"\s*:\s*(\d+)/);
  if (custom) {
    const code = Number(custom[1]);
    const name = ERROR_NAMES[code] ?? ANCHOR_ERRORS[code];
    if (name) return name;
  }
  const anchorCode = (e as { error?: { errorCode?: { number?: number } } })?.error
    ?.errorCode?.number;
  if (anchorCode && ERROR_NAMES[anchorCode]) return ERROR_NAMES[anchorCode];
  for (const name of Object.values(ERROR_NAMES)) {
    if (s.includes(name)) return name;
  }
  return null;
}

/** Something a player should read, rather than a stack trace. */
export function friendlyError(e: unknown): string {
  const name = errorName(e);
  if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name];
  if (name) return name;
  if (isTransient(e)) return "Network hiccup. Retrying.";
  const s = String(e);
  return s.length > 140 ? `${s.slice(0, 140)}...` : s;
}

/**
 * Did we simply lose a race?
 *
 * Every shared step of a hand is something any player may do, so two clients
 * trying at once is the normal case. The loser gets a specific error back and
 * must treat it as success, not as a failure worth showing anyone.
 */
export function isRaceLost(e: unknown): boolean {
  const name = errorName(e);
  if (name && RACE_LOST.has(name)) return true;
  return ER_RACE.test(String(e));
}

/**
 * Races the rollup reports rather than the program.
 *
 * `InvalidWritableAccount` is the rollup saying an account is not writable
 * here, which is what a seat looks like for the moment either side of
 * delegation. Every client cranks the same steps, so hitting that window is
 * routine and the next tick succeeds. It was reaching players as a wall of
 * red text about a failure that had already fixed itself.
 */
const ER_RACE =
  /already been processed|AlreadyProcessed|InvalidWritableAccount|ExternalAccountLamportSpend|AccountBorrowFailed/i;

/** Retry a read through transient failures. Safe because reads do not mutate. */
export async function net<T>(
  fn: () => Promise<T>,
  label: string,
  opts: { tries?: number; onRetry?: () => Promise<void> } = {},
): Promise<T> {
  const tries = opts.tries ?? 5;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      await sleep(1500 * (i + 1));
      if (opts.onRetry) {
        try {
          await opts.onRetry();
        } catch {
          // Try again on the next round.
        }
      }
    }
  }
  throw new Error(`${label} failed after ${tries} attempts: ${last}`);
}

/**
 * Run one step through network failures without double-applying it.
 *
 * `done` is the whole point: a retry asks whether the work already landed
 * before trying again. Without it, a send that succeeded on the wire but failed
 * on the way back would be applied twice.
 */
export async function step(
  done: () => Promise<boolean>,
  doIt: () => Promise<unknown>,
  label: string,
  opts: { tries?: number; onRetry?: () => Promise<void> } = {},
): Promise<void> {
  const tries = opts.tries ?? 4;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      if (i > 0 && (await done())) return;
      await doIt();
      return;
    } catch (e) {
      last = e;
      if (isRaceLost(e)) return;
      if (!isTransient(e)) throw e;
      await sleep(1500 * (i + 1));
      if (opts.onRetry) {
        try {
          await opts.onRetry();
        } catch {
          // Try again on the next round.
        }
      }
    }
  }
  throw new Error(`${label} failed after ${tries} attempts: ${last}`);
}

export interface SendOptions {
  /** Extra keypairs that must sign, e.g. a session key. */
  signers?: Keypair[];
  /** Wallet signer, when the transaction needs the actual wallet. */
  signTransaction?: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  /** Whose signature pays. Must match the first signer. */
  feePayer: Parameters<Transaction["add"]> extends never ? never : import("@solana/web3.js").PublicKey;
  label: string;
}

/**
 * Sign and send on the rollup, then verify it actually succeeded.
 *
 * Preflight is skipped because it costs a round trip we cannot spare, which
 * means the error only shows up afterwards. Hence the explicit err check and
 * the log fetch.
 */
export async function sendEr(
  connection: Connection,
  tx: Transaction,
  opts: SendOptions,
): Promise<string> {
  const bh = await connection.getLatestBlockhash();
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = opts.feePayer;

  if (opts.signTransaction) tx = await opts.signTransaction(tx);
  if (opts.signers?.length) tx.partialSign(...opts.signers);

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    preflightCommitment: "processed",
  });

  const conf = await connection.confirmTransaction(
    { signature: sig, ...bh },
    "processed",
  );
  if (conf.value.err) {
    let logs = "";
    try {
      const detail = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      logs = (detail?.meta?.logMessages ?? []).join("\n");
    } catch {
      // No logs available, the error code alone will have to do.
    }
    throw new Error(
      `${opts.label} failed: ${JSON.stringify(conf.value.err)}\n${logs}`,
    );
  }
  return sig;
}
