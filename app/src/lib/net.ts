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
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { ANCHOR_ERRORS, ERROR_MESSAGES, ERROR_NAMES, RACE_LOST } from "./constants";

/** Failures worth retrying. Everything else is a real error and should surface. */
export const TRANSIENT =
  /fetch failed|Failed to fetch|ECONNRESET|socket hang up|ETIMEDOUT|EPIPE|Blockhash not found|block height exceeded|\b429\b|\b50[234]\b|timed out|NetworkError|Load failed/i;

export const isTransient = (e: unknown) => TRANSIENT.test(String(e));

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How long to wait before trying again: exponential, with jitter.
 *
 * The jitter is the part that matters and the part that was missing. Retries
 * were spaced 1.5s, 3s, 4.5s — the same delays, to the millisecond, in every
 * browser. A rate limit refuses several clients at once by definition, so they
 * would all back off together and then all return together, re-creating the
 * burst that got them refused and keeping the limit tripped. Spreading the
 * returns is what breaks that cycle, and it costs nothing.
 *
 * Doubling from 400ms rather than climbing by 1.5s: a genuine blip clears in
 * well under a second, and five linear retries made a reader wait fifteen
 * seconds to find that out. This reaches the same number of attempts in six.
 */
export function backoff(attempt: number): number {
  const base = Math.min(400 * 2 ** attempt, 8_000);
  // ±25%, so no two clients come back at the same moment.
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** The program error name behind a failure, if there is one. */
export function errorName(e: unknown): string | null {
  const s = String(e);

  // Anchor prints the name of the error it raised, and that is the only
  // unambiguous signal: error numbers are per-program and collide. The session
  // key crate's InvalidToken is 6001, exactly the same number as our own
  // InsufficientChips, so an expired session used to be reported to players as
  // "Not enough chips for that", which sent them looking in the wrong place
  // entirely. The name in the logs is never wrong.
  const named = s.match(/Error Code:\s*([A-Za-z][A-Za-z0-9]*)/);
  if (named) return named[1];

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

/**
 * The two layers disagree about who owns an account, which is what a table
 * looks like from the rollup while delegation is mid-flight or mid-rollback.
 */
const WRONG_LAYER =
  /ReadonlyDataModified|AccountOwnedByWrongProgram|ConstraintOwner|AccountNotInitialized/i;

/**
 * Is this the two layers mid-handover, rather than anything wrong?
 *
 * Every seated client cranks continuously, including through the seconds a
 * table spends moving between Solana and the rollup. During those seconds every
 * send fails this way — not because anything broke, but because the accounts are
 * in transit and will be fine on the other side. It is the ordinary shape of a
 * cash-out, and a player who starts one should not be handed a stack of red
 * toasts for their trouble. The console still gets all of it.
 */
export function isWrongLayer(e: unknown): boolean {
  return WRONG_LAYER.test(errorName(e) ?? "") || WRONG_LAYER.test(String(e));
}

/** Something a player should read, rather than a stack trace. */
export function friendlyError(e: unknown): string {
  const name = errorName(e);
  if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name];
  // Checked before the bare-name fallthrough on purpose. errorName resolves
  // AccountOwnedByWrongProgram from Anchor's numeric 3007 even when the text
  // never contains the name — so the branch below that matches on the raw
  // string never saw it, and a toast read `commit: AccountOwnedByWrongProgram`
  // during the seconds a failed start took to roll back.
  if (WRONG_LAYER.test(name ?? "") || WRONG_LAYER.test(String(e))) {
    return "This table is part-way between Solana and the game validator. It usually settles by itself in a moment; if it keeps happening, pause the table to bring it back.";
  }
  if (name) return name;
  if (isTransient(e)) return "Network hiccup. Retrying.";
  const s = String(e);
  // `0x1` is the System Program's "this would leave a negative balance",
  // surfaced through whatever CPI attempted the transfer — so it arrives
  // wearing the calling program's error code and reads like an internal fault.
  // It is almost always an empty wallet, and saying so is more use than a hex
  // number nobody can look up.
  if (/custom program error: 0x1\b/.test(s) || /insufficient lamports/i.test(s)) {
    return "Not enough SOL in this wallet to cover the network fee. Chips are bought with USDC, but Solana charges fees in SOL.";
  }
  if (/User rejected|rejected the request|declined/i.test(s)) {
    return "Cancelled in your wallet.";
  }
  if (/blockhash not found|block height exceeded|expired/i.test(s)) {
    return "That took too long to confirm. Try again.";
  }
  // Nothing recognised. A player gets a sentence; the raw text goes to the
  // console, where it is useful.
  //
  // This used to fall through to the first 140 characters of whatever was
  // thrown, which is how `{"InstructionError":[0,"ReadonlyDataModified"]}`
  // ended up in a toast. A player cannot act on that, and it reads as the
  // thing being broken rather than one step having failed.
  console.error("unmapped error:", e);
  return "Something went wrong. Nothing was charged. Try again.";
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
      await sleep(backoff(i));
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

/* ------------------------------------------------------------------ */
/* Landing a transaction on SOLANA.                                    */
/*                                                                     */
/* The rollup is a private validator with no fee market and no packet  */
/* loss, so `sendEr` below can send once and wait. The base layer is a */
/* public chain, and everything this file did there — one send, no     */
/* priority fee, no rebroadcast — is the shape of a transaction that   */
/* mainnet is free to drop on the floor without a trace.               */
/*                                                                     */
/* It did exactly that, in production, on 2026-08-30. The house funder */
/* sent DelegateCore, the RPC returned signature 3dW6zeGq…, and the    */
/* transaction was never included in any block: null from              */
/* getSignatureStatuses with searchTransactionHistory, null from       */
/* getTransaction, on two independent endpoints. The route waited its  */
/* 30 seconds, reported "core did not confirm", returned 502, and the  */
/* client correctly rolled a start back that had never begun. Nothing  */
/* was broken and nothing was lost — the table simply could not start, */
/* and pressing the button again would have rolled the same dice.      */
/* ------------------------------------------------------------------ */

/**
 * Compute budget for a base-layer instruction.
 *
 * Measured from landed mainnet transactions rather than guessed: DelegateCore
 * consumed 125,027 and 149,027 units on its two recorded runs, DelegateSeat
 * between 77,291 and 140,292. 200,000 clears the worst of those with room and
 * is also what the runtime would have assumed anyway — stating it is what
 * makes the fee below a known quantity rather than a multiple of a default.
 */
const BASE_CU_LIMIT = 200_000;

/**
 * What we are willing to pay to be scheduled, in micro-lamports per unit.
 *
 * Every base-layer transaction this app has ever sent paid 5,000 lamports —
 * the bare signature fee, with no priority fee at all. That is not free; it is
 * last in the queue. A leader under load drops from the bottom, and a
 * zero-priority transaction is the bottom by definition, which is why one can
 * vanish on a chain whose recent prioritization fees read zero: that statistic
 * reports what got in, not what was turned away.
 *
 * The floor costs 200,000 x 20,000 / 1e6 = 4,000 lamports — call it 0.000004
 * SOL, against the 0.047 SOL of refundable rent the same transaction parks.
 * The ceiling exists so a fee spike somewhere else on the chain can never turn
 * one delegation into a meaningful cost.
 */
const MIN_CU_PRICE = 20_000;
const MAX_CU_PRICE = 250_000;

/**
 * Ask the chain what the accounts we are about to write are going for.
 *
 * Best effort by design: this runs on the path of a player pressing a button,
 * and a slow or missing answer must cost the send nothing. No answer means the
 * floor, which is already far above where we were.
 */
async function computeUnitPrice(
  connection: Connection,
  writable: PublicKey[],
): Promise<number> {
  try {
    const recent = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: writable.slice(0, 128),
    });
    const fees = recent.map((f) => f.prioritizationFee).sort((a, b) => a - b);
    if (fees.length === 0) return MIN_CU_PRICE;
    // The 75th percentile: enough to sit above three quarters of recent
    // traffic for these accounts without bidding against the outliers.
    const p75 = fees[Math.min(fees.length - 1, Math.floor(fees.length * 0.75))];
    return Math.max(MIN_CU_PRICE, Math.min(MAX_CU_PRICE, p75));
  } catch {
    return MIN_CU_PRICE;
  }
}

/** How often the same signed bytes go back out while we wait. */
const REBROADCAST_MS = 2_000;
/** How often we ask whether the blockhash is dead yet. */
const HEIGHT_CHECK_MS = 5_000;

export interface SolanaSendOptions {
  /** Extra keypairs that must sign, e.g. the funder or a session key. */
  signers?: Keypair[];
  /** Wallet signer, when the transaction needs the actual wallet. */
  signTransaction?: <T extends Transaction>(tx: T) => Promise<T>;
  feePayer: PublicKey;
  label: string;
  /** Override the measured default when an instruction is known to be heavier. */
  computeUnits?: number;
  /** Stop waiting after this long even if the blockhash is still alive. */
  timeoutMs?: number;
}

/**
 * Sign, send, and keep sending until Solana has it or the blockhash is dead.
 *
 * Three things this does that a bare `sendRawTransaction` does not:
 *
 *   - It bids. See the note on MIN_CU_PRICE.
 *   - It rebroadcasts. The same signed bytes go out every couple of seconds,
 *     so a dropped packet costs two seconds instead of the whole start. The
 *     signature is fixed at signing time, so this cannot double-apply: every
 *     resend is a duplicate of one transaction, and the chain accepts it once.
 *   - It knows the difference between "not yet" and "never". Waiting a flat
 *     thirty seconds cannot tell a slow confirmation from a transaction that
 *     can no longer land, so both were reported the same way. The blockhash's
 *     own `lastValidBlockHeight` is the honest deadline, and past it the
 *     transaction is genuinely dead rather than merely late.
 *
 * The transaction is modified in place: the compute budget instructions go on
 * the front of the one you passed in.
 */
export async function sendSolana(
  connection: Connection,
  tx: Transaction,
  opts: SolanaSendOptions,
): Promise<string> {
  const writable = tx.instructions
    .flatMap((ix) => ix.keys)
    .filter((k) => k.isWritable)
    .map((k) => k.pubkey);

  const price = await computeUnitPrice(connection, writable);
  // Prepended, not appended: the runtime reads the compute budget before it
  // runs anything, and an instruction cannot raise its own limit halfway.
  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: opts.computeUnits ?? BASE_CU_LIMIT,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = opts.feePayer;

  let signed = tx;
  if (opts.signTransaction) signed = await opts.signTransaction(tx);
  if (opts.signers?.length) signed.partialSign(...opts.signers);
  const raw = signed.serialize();

  // maxRetries 0 on purpose: rebroadcasting is this loop's job, and leaving
  // the RPC to do it as well means two schedules nobody is watching. One
  // broadcaster that can be reasoned about beats two that cannot.
  const send = () =>
    connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

  const sig = await send();
  const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
  let lastSend = Date.now();
  let lastHeightCheck = Date.now();
  let expired = false;

  for (;;) {
    const { value } = await connection.getSignatureStatus(sig);
    if (value?.err) {
      throw new Error(`${opts.label} failed: ${JSON.stringify(value.err)}`);
    }
    if (
      value?.confirmationStatus === "confirmed" ||
      value?.confirmationStatus === "finalized"
    ) {
      return sig;
    }

    // Checked after the status read, so a transaction that landed on the very
    // last valid block is still reported as landed rather than as expired.
    if (expired) {
      throw new Error(
        `${opts.label} was not accepted before its blockhash expired (${sig}) — ` +
          `the network dropped it, so nothing happened and it is safe to retry`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`${opts.label} did not confirm in time (${sig})`);
    }

    if (Date.now() - lastSend >= REBROADCAST_MS) {
      lastSend = Date.now();
      // A resend that fails is not news; the next one is two seconds away.
      await send().catch(() => {});
    }
    if (Date.now() - lastHeightCheck >= HEIGHT_CHECK_MS) {
      lastHeightCheck = Date.now();
      try {
        expired = (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight;
      } catch {
        // Keep waiting on the clock instead.
      }
    }
    await sleep(700);
  }
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
