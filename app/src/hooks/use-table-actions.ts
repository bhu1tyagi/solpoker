"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram, type SolpokerProgram } from "@/lib/anchor";
import {
  closeTableIx,
  isDelegated,
  commitResultsIx,
  delegateCoreIx,
  delegateSeatIx,
  joinTableIx,
  sitDownIx,
  standUpIx,
  vacateSeatIx,
  leaveTableIx,
  playerActionIx,
  secureDeckIx,
  abandonHandIx,
  releaseHoleIx,
  resetShuffleIx,
  secureHoleIx,
  sweepRakeIx,
  undelegateCoreIx,
  undelegateSeatIx,
  MOVES,
  type Move,
} from "@/lib/instructions";
import {
  DELEGATION_PROGRAM,
  MAX_SEATS,
  PROGRAM_ID,
  SHUFFLE_IDLE,
} from "@/lib/constants";
import { useTableStore } from "@/stores/table-store";
import { handPda, holePda, seatPda } from "@/lib/pdas";
import { friendlyError, sendEr, sendSolana, sleep } from "@/lib/net";
import { tombstoneTable } from "@/hooks/use-tables";
import {
  SESSION_COST_LAMPORTS,
  hasLiveSession,
  prepareSession,
  type SessionHandle,
} from "@/lib/session";
import { toast } from "@/stores/ui-store";
import type { ActionKind } from "@/components/poker/ActionBar";

/**
 * What taking a chair produced: whether it happened, and any session key that
 * had to be created to make it happen.
 */
export interface JoinResult {
  ok: boolean;
  session: SessionHandle | null;
}

/**
 * The things a player does deliberately, as opposed to the crank's background
 * work: sitting down, starting the game, betting, and cashing out.
 *
 * Note which of these need the wallet. Joining and leaving move chips between
 * your balance and the seat, so they always do. Everything inside a hand goes
 * through the session key.
 */
export function useTableActions(args: {
  erConnection: Connection | null;
  erProgram: SolpokerProgram | null;
  table: PublicKey | null;
  config: PublicKey | null;
  tableId: BN | null;
  session: Keypair | null;
  sessionToken: PublicKey | null;
}) {
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  /** Guards against a betting action being sent twice. See `act`. */
  const actInFlight = useRef(false);
  const { erConnection, erProgram, table, config, tableId, session, sessionToken } = args;

  /** Sign and send on the base layer, where the wallet is required. */
  const sendBase = useCallback(
    async (
      build: (program: SolpokerProgram, conn: Connection) => Promise<Transaction>,
      label: string,
      // Keys that are not the wallet but must still sign — a freshly minted
      // session key proving it exists, for instance. They sign first so the
      // wallet sees the finished transaction it is being asked to approve.
      extraSigners: Keypair[] = [],
    ) => {
      if (!publicKey || !signTransaction) throw new Error("connect a wallet first");
      const conn = getBaseConnection();
      const program = makeProgram(conn);
      const tx = await build(program, conn);
      const bh = await conn.getLatestBlockhash();
      tx.feePayer = publicKey;
      tx.recentBlockhash = bh.blockhash;
      if (extraSigners.length) tx.partialSign(...extraSigners);
      const signed = await signTransaction(tx);
      // Preflight on purpose. A join against a seat someone took first is
      // doomed, and with preflight skipped it does not fail until the
      // blockhash expires — the player watches a spinner for a minute to
      // learn what one simulation round trip would have said instantly.
      const sig = await conn.sendRawTransaction(signed.serialize());
      const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (conf.value.err) {
        throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`);
      }
      return sig;
    },
    [publicKey, signTransaction],
  );

  /**
   * Sign and send on the base layer with the session key: no prompt.
   *
   * Preflight is deliberately left on, unlike the rollup sends: a join
   * against a seat somebody took first is doomed, and one simulation round
   * trip says so instantly instead of after a blockhash expires.
   */
  const sendBaseAsSession = useCallback(
    async (build: (program: SolpokerProgram) => Promise<Transaction>, label: string) => {
      if (!session) throw new Error("no session key");
      const conn = getBaseConnection();
      const program = makeProgram(conn);
      const tx = await build(program);
      const bh = await conn.getLatestBlockhash();
      tx.feePayer = session.publicKey;
      tx.recentBlockhash = bh.blockhash;
      tx.sign(session);
      const sig = await conn.sendRawTransaction(tx.serialize());
      const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (conf.value.err) {
        throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`);
      }
      return sig;
    },
    [session],
  );

  /**
   * Whether the session key can sit and stand for the player, promptless.
   *
   * Three things have to hold: the key and its token exist, and the key holds
   * enough SOL to pay the fee itself. When any of them fails the wallet path
   * below still works — a prompt is worse than promptless and better than a
   * dead button.
   */
  const sessionCanSign = useCallback(async (): Promise<boolean> => {
    if (!session || !sessionToken) return false;
    try {
      const bal = await getBaseConnection().getBalance(session.publicKey);
      return bal >= 50_000;
    } catch {
      return false;
    }
  }, [session, sessionToken]);

  /**
   * Take a seat — without a prompt whenever a live session key can sign it.
   *
   * The first sit of a session still goes through the wallet, because that is
   * the transaction that creates the session key, and it rides along rather
   * than being a second thing to approve. Every sit after that, and every
   * cash-out, runs on the session key: the wallet is asked once per session,
   * not once per chair.
   *
   * Reports whether the chair was actually taken, and hands back any session
   * it created on the way so the caller can put it straight into state without
   * a round trip. The two are separate answers: a sit that used an existing
   * session creates nothing and still succeeded, and a rebuy needs to know the
   * difference before it puts the table back on the rollup.
   */
  const join = useCallback(
    async (
      seatIndex: number,
      buyIn: number,
      opts: { nested?: boolean } = {},
    ): Promise<JoinResult> => {
      if (!tableId || !publicKey) return { ok: false, session: null };
      // Inside a rebuy this is the middle of one errand, not an errand. The
      // outer action owns the phase; see `Nested` below.
      const phase = (s: string | null) => {
        if (!opts.nested) setBusy(s);
      };
      phase("join");
      try {
        const conn = getBaseConnection();

        // The promptless path: a live, funded session key signs `sit_down`.
        if (await sessionCanSign()) {
          await sendBaseAsSession(
            async (program) =>
              new Transaction().add(
                await sitDownIx(program, tableId, seatIndex, buyIn, {
                  payer: session!.publicKey,
                  authority: publicKey,
                  sessionToken,
                }),
              ),
            "sit down",
          );
          toast(`Sat down with ${buyIn.toLocaleString()} chips`, "good");
          return { ok: true, session: null };
        }

        // Checked before signing rather than discovered inside a CPI, where
        // running out of lamports comes back as `custom program error: 0x1`.
        const needSession = !(await hasLiveSession(conn, publicKey));
        if (needSession) {
          const bal = await conn.getBalance(publicKey);
          if (bal < SESSION_COST_LAMPORTS) {
            throw new Error(
              `This wallet needs about ${(SESSION_COST_LAMPORTS / 1e9).toFixed(3)} SOL to sit down and ` +
                `it holds ${(bal / 1e9).toFixed(4)}. Chips are bought with USDC, but Solana charges ` +
                `its fees in SOL. Top it up and take the seat again.`,
            );
          }
        }

        const prepared = needSession ? prepareSession(publicKey) : null;
        await sendBase(
          async (program, conn2) => {
            const tx = new Transaction();
            if (prepared) tx.add(prepared.ix);
            tx.add(await joinTableIx(program, tableId, seatIndex, buyIn, publicKey));
            tx.recentBlockhash = (await conn2.getLatestBlockhash()).blockhash;
            return tx;
          },
          "join",
          prepared ? [prepared.keypair] : [],
        );

        // Only now is the key real. Storing it before the transaction landed
        // would leave one on disk that does not exist on chain.
        const handle = prepared ? prepared.commit() : null;
        toast(`Sat down with ${buyIn.toLocaleString()} chips`, "good");
        return { ok: true, session: handle };
      } catch (e) {
        toast(friendlyError(e), "bad");
        return { ok: false, session: null };
      } finally {
        phase(null);
      }
    },
    [tableId, sendBase, publicKey, session, sessionToken, sessionCanSign, sendBaseAsSession],
  );

  /**
   * Whether an action is being run inside another one.
   *
   * `busy` is a single string and the whole table reads it — the overlay, the
   * status line, the buttons. A sub-action that sets it for itself is telling
   * the screen a story the player did not ask for: cashing out would announce
   * "pausing", then "leaving", then blank itself in its own `finally` while the
   * cash-out was still going. Nested calls narrate nothing, and the outermost
   * action owns the phase from beginning to end.
   */
  type Nested = { nested?: boolean; quiet?: boolean };

  /**
   * Put the seat stack back into the balance — promptless when the session
   * key can sign, the wallet otherwise. Either way the chips have exactly one
   * destination: the seat occupant's own balance.
   */
  const leave = useCallback(
    async (seatIndex: number, opts: Nested = {}): Promise<boolean> => {
      if (!table || !publicKey) return false;
      const phase = (s: string | null) => {
        if (!opts.nested) setBusy(s);
      };
      phase("leave");
      try {
        if (await sessionCanSign()) {
          await sendBaseAsSession(
            async (program) =>
              new Transaction().add(
                await standUpIx(program, table, seatIndex, {
                  payer: session!.publicKey,
                  authority: publicKey,
                  sessionToken,
                }),
              ),
            "stand up",
          );
        } else {
          await sendBase(
            async (program) =>
              new Transaction().add(await leaveTableIx(program, table, seatIndex, publicKey)),
            "leave",
          );
        }
        // Silent inside a rebuy, where the chips come off the seat only to go
        // straight back onto it: "Cashed out" there would announce the exact
        // opposite of what the player asked for.
        if (!opts.quiet) toast("Cashed out", "good");
        return true;
      } catch (e) {
        toast(friendlyError(e), "bad");
        return false;
      } finally {
        phase(null);
      }
    },
    [table, sendBase, publicKey, session, sessionToken, sessionCanSign, sendBaseAsSession],
  );

  /**
   * Delete a table you created, reclaiming its rent.
   *
   * Anyone still sitting is sent home with their chips first, so nothing is
   * destroyed. Only works while the table is undelegated, which account
   * ownership enforces on its own.
   */
  const deleteTable = useCallback(
    async (occupants: { seat: number; occupant: string }[]) => {
      if (!table || !config || !publicKey) return false;
      setBusy("delete");
      try {
        for (const { seat, occupant } of occupants) {
          await sendBase(
            async (program) =>
              new Transaction().add(
                await vacateSeatIx(
                  program,
                  table,
                  seat,
                  new PublicKey(occupant),
                  config,
                  publicKey,
                ),
              ),
            `vacate seat ${seat}`,
          );
        }
        // Any rake this table took has to reach the house before the table can
        // go: `close_table` refuses while it is unswept, because deleting the
        // table would destroy chips the vault is still backing. Best effort —
        // a table that never raked a pot has nothing to sweep and refuses.
        try {
          await sendBase(
            async (program) => new Transaction().add(await sweepRakeIx(program, table, publicKey)),
            "sweep rake",
          );
        } catch {
          // Nothing accrued, or somebody swept it already.
        }
        await sendBase(
          async (program) =>
            new Transaction().add(
              await closeTableIx(program, table, config, publicKey, publicKey),
            ),
          "delete table",
        );
        // Some RPC nodes echo the closed account for a while; remember the
        // delete locally so the lobby does not resurrect the table.
        if (tableId) tombstoneTable(tableId.toString());
        toast("Table deleted", "good");
        return true;
      } catch (e) {
        toast(friendlyError(e), "bad");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [table, config, tableId, publicKey, sendBase],
  );

  /**
   * Hand the table to the rollup and lock the cards down.
   *
   * Signed by the session key throughout, so starting a game is one prompt at
   * most rather than fourteen. The session key is a funded keypair and the
   * payer on these instructions is unconstrained.
   */
  const startTable = useCallback(
    async (occupiedSeats: number[], opts: Nested = {}) => {
      if (!tableId || !table || !session || !publicKey) return;
      const phase = (s: string | null) => {
        if (!opts.nested) setBusy(s);
      };
      // A silent return here left a button that did nothing. Say why instead.
      if (!erProgram || !erConnection) {
        toast(
          "Not connected to the game validator yet. Approve the signature request, or reload and try again.",
          "bad",
        );
        return;
      }
      phase("start");
      try {
        const conn = getBaseConnection();
        const program = makeProgram(conn);

        phase("start:funding");
        /*
         * Ask the house first.
         *
         * When the funder wallet is configured and holds enough, it pays the
         * delegation rent directly and the player signs nothing at all — no
         * transfer, no prompt, no 0.05 SOL leaving their wallet for something
         * they had no way to recognise as a deposit. The player-funded path
         * below stays as the fallback, so a room with no funder still works
         * exactly as it did.
         */
        let houseFunds = false;
        try {
          const res = await fetch("/api/delegate", { method: "GET", cache: "no-store" });
          houseFunds = res.ok && (await res.json()).available === true;
        } catch {
          // No answer means no house funding; the player path covers it.
        }
        /*
         * The session key pays for everything below, and the old check here is
         * why NO fresh wallet could start a table on mainnet.
         *
         * It refilled only under 0.004 SOL — but a fresh key holds its 0.012
         * float, sails past that check, and then delegation drains it: the
         * core group (table, hand, deck) costs about 0.011 in buffer rent and
         * fees, and each occupied seat's buffer then asks for 1,600,800
         * lamports the key no longer has. The failure surfaced as
         * `custom program error: 0x1` from a CPI three levels down, read on
         * chain from the failed transaction itself:
         *
         *   Transfer: insufficient lamports 1215920, need 1600800
         *
         * So the float is now sized to the start being paid for: the core
         * group plus one allowance per seat, with a cushion for a retry.
         * Delegation rent is refunded on undelegation, so this money rides
         * along rather than being spent — it comes back to the key when the
         * table returns to Solana, and home to the wallet on sweep.
         *
         * Per SEAT, not per occupied seat. The loop below delegates all six,
         * because the rollup refuses to run a hand unless every seat and hole
         * account it might touch is there — and each seat rides with its hole,
         * so one DelegateSeat transaction moves four rent buffers, not one.
         * Measured on mainnet: the core group cost 9.2M lamports and each
         * seat transaction 6.4M, so a six-seat start is ~48M. Sized for the
         * occupied seats only, this funded 25M and died on the third seat —
         * rolled back cleanly, but a start that can never finish.
         */
        const CORE_LAMPORTS = 12_000_000;
        const PER_SEAT_LAMPORTS = 7_000_000;
        const CUSHION_LAMPORTS = 4_000_000;
        const needed = CORE_LAMPORTS + MAX_SEATS * PER_SEAT_LAMPORTS + CUSHION_LAMPORTS;
        const bal = houseFunds ? needed : await conn.getBalance(session.publicKey);
        if (bal < needed) {
          if (!signTransaction) throw new Error("connect a wallet first");
          /*
           * Say what the money is before asking for it.
           *
           * The wallet shows a transfer of about 0.05 SOL and says nothing
           * else, so it reads as the price of playing a hand. It is not: it is
           * rent-exemption for the fifteen accounts the table needs on the
           * rollup, it is refunded in full when the table comes back to
           * Solana, and a player who does not know that reasonably concludes
           * the game costs fifty times what it does.
           */
          toast(
            `Putting up ${((needed - bal) / 1e9).toFixed(3)} SOL as a refundable deposit — ` +
              `Solana holds it while the table runs and returns it when the table pauses. ` +
              `It is not a fee.`,
            "info",
          );
          const { SystemProgram } = await import("@solana/web3.js");
          const fund = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: session.publicKey,
              lamports: needed - bal + 1_000_000,
            }),
          );
          const bh = await conn.getLatestBlockhash();
          fund.feePayer = publicKey;
          fund.recentBlockhash = bh.blockhash;
          const signed = await signTransaction(fund);
          const sig = await conn.sendRawTransaction(signed.serialize());
          const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
          if (conf.value.err) {
            throw new Error(`funding the session key failed: ${JSON.stringify(conf.value.err)}`);
          }
        }

        // Delegation, one account group per transaction: these carry a buffer,
        // a record and a metadata account each and do not fit together.
        //
        // Resumable on purpose. A start that dies halfway — one flaky
        // confirmation out of eight — used to leave a half-delegated table
        // that a second press could not repair: the retry tripped over its
        // own first attempt's work and threw before ever reaching the secure
        // step. Now already-delegated accounts are skipped, a failed send of
        // an already-done step is tolerated, and the truth is checked at the
        // end: either the rollup serves the table or the start failed.
        phase("start:delegating");
        /*
         * One delegation step, paid for by whoever is paying.
         *
         * The house route signs as payer on the server; the instruction takes
         * the payer as its only signer, so nothing else is needed from here.
         * The orchestration — which steps, in what order, and the rollback if
         * one fails — stays on this side, because undoing a delegation happens
         * on the rollup and needs the session key.
         */
        const houseDelegate = async (step: "core" | "seat", index?: number) => {
          const res = await fetch("/api/delegate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableId: tableId.toString(), step, index }),
          });
          if (!res.ok) {
            throw new Error((await res.json().catch(() => ({}))).error ?? `house ${step} failed`);
          }
        };
        // The same send the house route makes, from the browser: a priority
        // fee so a leader under load does not drop it first, and rebroadcast
        // until it lands or its blockhash dies. One send at zero priority is
        // what silently lost a start in production; see the note on sendBase.
        const sendAsSession = async (ix: Awaited<ReturnType<typeof delegateCoreIx>>, label: string) => {
          await sendSolana(conn, new Transaction().add(ix), {
            signers: [session],
            feePayer: session.publicKey,
            label,
          });
        };
        const delegatedAlready = async (account: PublicKey) => {
          const info = await conn.getAccountInfo(account);
          return !!info && !info.owner.equals(PROGRAM_ID);
        };

        //
        // All of it goes, or none of it does.
        //
        // These cannot share a transaction, so the sequence is not atomic on
        // its own — and it used to abort on the first failed seat with the
        // table already delegated and nothing to undo it. That is a
        // half-delegated table: core on the rollup, seats on Solana, no
        // instruction able to work across the gap, and every chip on those
        // seats unreachable until somebody noticed.
        //
        // Atomicity is not available, so the next best thing is: undo what
        // landed. On any failure every account that made it to the rollup is
        // sent straight back, leaving the table exactly as it was before the
        // button was pressed. A start that fails is then a no-op the player can
        // simply retry, rather than damage somebody has to diagnose.
        const delegatedNow: number[] = [];
        let coreDelegated = await delegatedAlready(table);

        const rollBack = async () => {
          if (!erProgram || !erConnection) return;
          const undo = async (ix: Awaited<ReturnType<typeof undelegateCoreIx>>, label: string) => {
            try {
              const tx = new Transaction().add(ix);
              await sendEr(erConnection, tx, {
                signers: [session],
                feePayer: session.publicKey,
                label,
              });
            } catch (e) {
              console.error(`rollback: ${label} failed:`, e);
            }
          };
          // Seats before the core, because `undelegate_seat` reads the table to
          // refuse a mid-hand pull and needs it still there to read.
          for (const i of delegatedNow) {
            await undo(
              await undelegateSeatIx(erProgram, table, i, session.publicKey),
              `roll back seat ${i}`,
            );
          }
          if (coreDelegated) {
            await undo(
              await undelegateCoreIx(erProgram, table, session.publicKey),
              "roll back table",
            );
          }
        };

        try {
          if (!coreDelegated) {
            try {
              if (houseFunds) {
                await houseDelegate("core");
              } else {
                await sendAsSession(
                  await delegateCoreIx(program, tableId, session.publicKey),
                  "delegate table",
                );
              }
              coreDelegated = true;
            } catch (e) {
              if (!(await delegatedAlready(table))) throw e;
              coreDelegated = true;
            }
          }
          /*
           * Six seats at once, after one look rather than six.
           *
           * This was a sequential loop and each turn of it cost two round
           * trips — a check, then a send waited out to confirmation — so a
           * start spent twelve to fifteen seconds delegating seats one after
           * another while the player watched a spinner. Nothing about them is
           * ordered: they are six independent accounts in six independent
           * transactions, and only the core has to land first.
           *
           * So the checks collapse into a single batched read, and the sends
           * go together. Wall time becomes the slowest seat instead of the sum
           * of all six.
           */
          const seatKeys = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
          const seatInfos = await conn.getMultipleAccountsInfo(seatKeys);
          const pending = seatKeys
            .map((_, i) => i)
            .filter((i) => {
              const info = seatInfos[i];
              // Owned by someone else already means already delegated.
              return !info || info.owner.equals(PROGRAM_ID);
            });

          const settled = await Promise.allSettled(
            pending.map(async (i) => {
              if (houseFunds) {
                await houseDelegate("seat", i);
              } else {
                await sendAsSession(
                  await delegateSeatIx(program, table, i, session.publicKey),
                  `delegate seat ${i}`,
                );
              }
              return i;
            }),
          );

          // Seats already delegated by this run are recorded whether or not
          // their send reported success, because the rollback has to know
          // about every account that actually moved.
          const failures: unknown[] = [];
          for (let k = 0; k < settled.length; k++) {
            const i = pending[k];
            const r = settled[k];
            if (r.status === "fulfilled") {
              delegatedNow.push(i);
            } else if (await delegatedAlready(seatKeys[i])) {
              // Landed anyway — a lost confirmation, not a failed delegation.
              delegatedNow.push(i);
            } else {
              failures.push(r.reason);
            }
          }
          if (failures.length) throw failures[0];
        } catch (e) {
          phase("start:rollback");
          console.error("delegation failed, returning the table to Solana:", e);
          await rollBack();
          throw new Error(
            "The table could not be moved to the game validator, so it has been left on Solana. Nothing was lost, so try starting again.",
          );
        }

        // Delegation takes a moment to reach the rollup, and the base layer
        // cannot say when: it flips owners the moment the transaction lands.
        // Ask the rollup itself whether it serves the last seat yet.
        //
        // Public accounts only. This used to demand all six hole accounts too,
        // and that check can never pass with players seated: the validator
        // serves a permission-gated account to its member and to nobody else —
        // that is the whole privacy design — so the starter polling another
        // player's hole reads null forever. Measured on mainnet: a start that
        // had delegated every account cleanly still waited out all thirty
        // seconds staring at the two occupied seats' holes and then rolled
        // itself back, every time. The deck stays off the list for the same
        // reason: securing locks it to nobody, and the lock outlives a pause.
        //
        // The holes are not unguarded by this. Each hole delegates in the same
        // transaction as its seat, so a seat the rollup serves vouches for its
        // hole — which is what the old check was really after, from the one
        // account it is never allowed to see.
        phase("start:waiting");
        /*
         * Including OUR OWN hole, which is the next step's first write — and
         * only ours, because ours is the only one this connection is allowed
         * to see.
         *
         * The holes went onto this list because a hole that had not landed
         * yet failed its secure, the seat was recorded unsecured, and with
         * both chairs in that state the table went live with everyone sat
         * out. But listing every occupied hole walked straight into the trap
         * the comment above describes: the validator serves a permission-
         * gated hole to its member and to nobody else, and the permission
         * exists from the moment the player sat down. So the starter polled
         * the OPPONENT'S hole, read null forever, burned the full thirty
         * seconds — and did it under a live hand, because the other player's
         * crank had long since secured the chairs and dealt. The felt said
         * "setting the table" over a running game and then announced the
         * table had been returned to Solana, which was false twice over.
         *
         * Our own hole still stands proxy for the rest: every hole delegates
         * in the same transaction as its seat, so seats served plus one hole
         * served is the whole set, observed from the only angle we have.
         */
        const mySeatNow = useTableStore.getState().mySeat;
        const mustBeThere = [
          table,
          handPda(table),
          ...Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i)),
          ...(mySeatNow >= 0 ? [holePda(table, mySeatNow)] : []),
        ];
        /*
         * The other players' cranks are not waiting for us.
         *
         * Delegation flips `delegated` true on every seated client within one
         * poll, and each of their cranks then secures chairs and deals — the
         * very work the rest of this function exists to bootstrap. A hand
         * going live mid-wait is therefore not an anomaly to wait through but
         * the finish line crossed by somebody else: the rollup is serving the
         * table, the chairs are locked, cards are out.
         */
        const handLive = () => useTableStore.getState().table?.state === 1;
        let allArrived = false;
        for (let t = 0; t < 40; t++) {
          if (handLive()) {
            allArrived = true;
            break;
          }
          try {
            // Every public account, not just the last seat. Waiting on one
            // and assuming the rest is how a table with a missing hole account
            // got as far as being declared live, and then dealt nobody in.
            const infos = await erConnection.getMultipleAccountsInfo(mustBeThere);
            if (infos.every((i) => i !== null)) {
              allArrived = true;
              break;
            }
          } catch {
            // Not there yet.
          }
          await sleep(750);
        }
        if (!allArrived) {
          phase("start:rollback");
          console.error("the rollup never served every account; returning the table to Solana");
          await rollBack();
          throw new Error(
            "The game validator did not pick the table up in time, so it has been left on Solana. Nothing was lost, so try starting again.",
          );
        }

        // Somebody else already finished the job. Securing again mid-hand
        // would at best fail noisily and at worst report healthy chairs as
        // stuck, so say the true thing and stand down.
        if (handLive()) {
          toast("Table is live. Cards are locked down.", "good");
          return;
        }

        // Lock the deck to nobody and each hand to its owner. Retried because
        // the rollup can serve reads a beat before it accepts writes.
        phase("start:securing");
        const secure = async (ix: Awaited<ReturnType<typeof secureDeckIx>>, label: string) => {
          let last: unknown;
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const tx = new Transaction().add(ix);
              await sendEr(erConnection, tx, {
                signers: [session],
                feePayer: session.publicKey,
                label,
              });
              return;
            } catch (e) {
              last = e;
              await sleep(2000);
            }
          }
          throw last;
        };
        // The deck is not optional. `start_hand` refuses without it, and a
        // failure here has to stop the start rather than leave a table that
        // knocks CardsNotSecured forever with nobody retrying.
        try {
          await secure(await secureDeckIx(erProgram, table, session.publicKey), "secure deck");
        } catch (e) {
          // Unless the failure is that we lost the race: a hand in progress
          // means another crank secured the deck and dealt while our retries
          // were sleeping. That is the outcome this whole function wants.
          if (handLive()) {
            toast("Table is live. Cards are locked down.", "good");
            return;
          }
          throw e;
        }

        // Only seats somebody is sitting in. Securing an empty one used to
        // create a permission with no members, which is readable by nobody and
        // — measured on devnet — updatable by nobody either, so whoever sat
        // there next was dealt cards they could never read, permanently. The
        // program now refuses an empty seat outright; this stops us asking.
        //
        // Failures no longer abort the loop. One seat's transaction failing
        // used to skip every seat after it, which is how a table went live with
        // world-readable hole cards. Now each seat is tried, the rest carry on,
        // and the program sits an unsecured seat out of the hand instead of
        // dealing into it.
        const unsecured: number[] = [];
        for (const i of occupiedSeats) {
          try {
            await secure(
              await secureHoleIx(erProgram, table, i, session.publicKey),
              `secure seat ${i}`,
            );
          } catch (e) {
            // A chair the chain already shows secured is not stuck — another
            // client's crank got there first and our duplicate was refused.
            // Counting it produced "this chair belongs to whoever sat there
            // last" toasts over perfectly healthy tables.
            if (useTableStore.getState().seats[i]?.cardsSecured) continue;
            // The reason was being discarded, which made this the one failure
            // in the start sequence that could not be diagnosed from a report:
            // the table said two chairs belonged to somebody else and nothing
            // anywhere said why. It is still not fatal — the others play on —
            // but it is on the record now.
            console.error(`could not secure seat ${i}:`, e);
            unsecured.push(i);
          }
        }
        // Permissions take a couple of seconds to take effect.
        await sleep(2500);

        if (unsecured.length) {
          toast(
            `Table is live. ${unsecured.length === 1 ? "One chair" : `${unsecured.length} chairs`} ` +
              `still ${unsecured.length === 1 ? "belongs" : "belong"} to whoever sat there last, so ` +
              `${unsecured.length === 1 ? "it sits" : "they sit"} out this hand. Everyone else can play.`,
            "bad",
          );
        } else {
          toast("Table is live. Cards are locked down.", "good");
        }
      } catch (e) {
        console.error("start table failed:", e);
        toast(friendlyError(e), "bad");
      } finally {
        phase(null);
      }
    },
    [tableId, table, session, erProgram, erConnection, publicKey, signTransaction],
  );

  /** Bring the table back to the base layer so people can cash out. */
  const pauseTable = useCallback(async (opts: Nested = {}) => {
    if (!table || !session) return;
    if (!erProgram || !erConnection) {
      toast("Not connected to the game validator. Retry the connection first.", "bad");
      return;
    }
    const phase = (s: string | null) => {
      if (!opts.nested) setBusy(s);
    };
    phase("pause");
    try {
      const send = async (ix: Awaited<ReturnType<typeof undelegateCoreIx>>, label: string) => {
        const tx = new Transaction().add(ix);
        await sendEr(erConnection, tx, {
          signers: [session],
          feePayer: session.publicKey,
          label,
        });
      };
      // Hand back this player's own hole-card read right before the table
      // leaves the rollup.
      //
      // A permission names one member and only that member may update it, and
      // it survives the round trip off the rollup and back. So a seat whose
      // occupant changes while the table is paused could never be re-secured:
      // the next player would be excluded from every deal, permanently, on a
      // table that looked fine. Releasing it while we still can is what keeps
      // the chair alive for whoever sits there next. Between hands the account
      // holds no cards, so making it public costs nothing.
      //
      // Only our own seat: nobody else can release theirs, which is why the
      // seat-stuck notice exists for the case where somebody simply closes
      // their tab without pausing.
      const mySeatNow = useTableStore.getState().mySeat;
      if (mySeatNow !== null && mySeatNow >= 0 && sessionToken) {
        try {
          await send(
            await releaseHoleIx(erProgram, table, mySeatNow, {
              payer: session.publicKey,
              authority: publicKey!,
              sessionToken,
            }),
            "release hole permission",
          );
        } catch {
          // Nothing to release, or a hand is still live on this seat.
        }
      }

      // Leave a fresh digest of the last hand on the base layer on the way
      // out. Best effort: a table with nothing new to record refuses this,
      // and that must not block the cash-out path.
      try {
        await send(
          await commitResultsIx(erProgram, table, session.publicKey),
          "commit results",
        );
      } catch {
        // Nothing new to record, or already recorded.
      }

      // A deck holding randomness for a hand that never started cannot be
      // published, so undelegation refuses it and the table — with every chip
      // on its seats — is stuck. That is the ordinary end of a heads-up
      // session: one player busts, the crank has already drawn the next
      // shuffle, and `start_hand` can never run again with one funded seat.
      // Clearing a drawn-but-unplayable shuffle is what makes the cash-out path
      // work, and it is read fresh from the chain rather than from the store.
      //
      // Gating it on the client's cached hand was a mistake worth naming: it
      // saved one wasted transaction on a healthy table and, when the store was
      // stale, skipped the recovery entirely. A store is least trustworthy
      // exactly when the table is stuck, which is the only time this matters.
      const handOnChain = await erProgram.account.hand
        .fetch(handPda(table))
        .catch(() => null);
      if (handOnChain && handOnChain.shuffleState !== SHUFFLE_IDLE) {
        try {
          await send(
            await resetShuffleIx(erProgram, table, session.publicKey),
            "clear stale shuffle",
          );
        } catch {
          // Not stale enough yet. Handled by the check below.
        }
      }

      // Do not take the table apart unless all of it can leave.
      //
      // Seats have to be undelegated before the core accounts, because
      // `undelegate_seat` reads the table to refuse a mid-hand pull. But the
      // deck refuses to leave while it holds randomness for a hand that never
      // started, so undelegating the seats first and *then* failing on the core
      // leaves the table split across two layers: seats on Solana, table and
      // deck on the rollup, and no instruction able to operate across the gap.
      // Checking first turns that into a message and an intact table.
      const stillHeld = await erProgram.account.hand
        .fetch(handPda(table))
        .catch(() => null);
      if (stillHeld && stillHeld.shuffleState !== SHUFFLE_IDLE) {
        // Wait it out here rather than handing the player a countdown and a
        // dead button. This is the state that looked like nothing happening:
        // the click was refused for a good reason — better a message than a
        // table split across two layers — but a toast is easy to miss, and the
        // player is left staring at a table that will not close.
        const waitFor = Math.max(0, stillHeld.deadline.toNumber() - Math.floor(Date.now() / 1000));
        toast(
          `The next hand's shuffle is still clearing. Closing the table in about ${waitFor + 5}s.`,
          "good",
        );
        phase("pause:waiting");

        // The shuffle clears itself once it is stale enough: any client may
        // call `reset_shuffle`, and this one will if nobody else does.
        for (let i = 0; i < 40; i++) {
          await sleep(3000);
          const h = await erProgram.account.hand.fetch(handPda(table)).catch(() => null);
          if (!h) break;
          if (h.shuffleState === SHUFFLE_IDLE) break;
          if (h.deadline.toNumber() < Math.floor(Date.now() / 1000)) {
            try {
              await send(
                await resetShuffleIx(erProgram, table, session.publicKey),
                "clear stale shuffle",
              );
            } catch {
              // Someone else cleared it, or it is not stale yet after all.
            }
          }
        }

        const cleared = await erProgram.account.hand.fetch(handPda(table)).catch(() => null);
        if (cleared && cleared.shuffleState !== SHUFFLE_IDLE) {
          toast(
            "The table could not be closed yet. Your chips are safe on the table, so try again in a minute.",
            "bad",
          );
          return;
        }
        phase("pause");
      }

      // Last resort, for a hand that can never settle. Undelegation refuses a
      // deck that still holds cards, so a stuck hand means nobody at the table
      // can cash out at all. This unwinds it — every contribution back to whoever
      // made it, nobody wins the pot — and only an hour past the deadline, by
      // which point a permissionless force_timeout has had the whole hour to end
      // the hand properly. Only attempted when a hand is actually in progress,
      // for the same reason as above: a healthy table should not pay for a
      // transaction that exists to refuse it.
      const liveTable = useTableStore.getState().table;
      if (liveTable?.state === 1) {
        try {
          await send(
            await abandonHandIx(erProgram, table, session.publicKey),
            "unwind stuck hand",
          );
        } catch {
          // Not stuck long enough to unwind; the hand may still finish normally.
        }
      }
      // Seats first, then the core accounts. `undelegate_seat` now carries the
      // table so the program can refuse to pull a seat off the rollup while a
      // hand is live — which means the table has to still be there to check.
      // Undelegating the core first would leave every seat unable to follow.
      //
      // Only the seats that actually went to the rollup. A table can end up
      // half-delegated — the core delegated, some seats left behind — because
      // `startTable` is deliberately tolerant of per-account failures so it can
      // resume. On the rollup a seat that was never delegated is a read-only
      // clone of the base-layer account, so asking to commit it fails with
      // `ReadonlyDataModified`.
      //
      // That mattered far more than it looks. This loop threw on the first such
      // seat, which aborted the whole pause *before* the core undelegation on
      // the line below — so the table could never come back, and every chip on
      // it stayed unreachable. The account's owner is the honest test for
      // whether there is anything to undelegate, and it is read from the base
      // layer where ownership is authoritative.
      const base = getBaseConnection();
      const seatKeys = Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i));
      const holeKeys = Array.from({ length: MAX_SEATS }, (_, i) => holePda(table, i));
      const [seatInfos, holeInfos] = await Promise.all([
        base.getMultipleAccountsInfo(seatKeys),
        base.getMultipleAccountsInfo(holeKeys),
      ]);
      let skipped = 0;
      for (let i = 0; i < MAX_SEATS; i++) {
        const onRollup = (info: (typeof seatInfos)[number]) =>
          info !== null && !info.owner.equals(PROGRAM_ID);
        // Both halves have to be on the rollup: the instruction commits the
        // pair, so one of each is as unworkable as neither.
        if (!onRollup(seatInfos[i]) || !onRollup(holeInfos[i])) {
          skipped += 1;
          continue;
        }
        try {
          await send(
            await undelegateSeatIx(erProgram, table, i, session.publicKey),
            `undelegate seat ${i}`,
          );
        } catch (e) {
          // One stubborn seat must not strand the other five, nor the table.
          console.error(`undelegate seat ${i} failed, continuing:`, e);
        }
      }
      if (skipped > 0) {
        console.log(`pause: ${skipped} seat(s) were never delegated; nothing to bring back`);
      }
      await send(await undelegateCoreIx(erProgram, table, session.publicKey), "undelegate table");

      // Seats come back one at a time, so wait for all of them before saying so.
      const conn = getBaseConnection();
      const all = [table, ...Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i))];
      for (let t = 0; t < 60; t++) {
        const infos = await conn.getMultipleAccountsInfo(all);
        if (infos.every((i) => i?.owner.equals(PROGRAM_ID))) break;
        await sleep(1000);
      }

      // Send the house its rake, now that the table can be written on Solana.
      //
      // Rake is taken at settlement, which runs on the rollup, where a
      // base-layer `Player` balance cannot be written — so it waits in
      // `table.rake_accrued` until the table comes home. Sweeping only
      // happened when a creator *deleted* a table, which meant a table that
      // was merely paused held its rake indefinitely and the house had to know
      // to go and get it. This is the moment it becomes possible, so this is
      // where it happens.
      //
      // Signed by the session key, not the wallet: `sweep_rake` is
      // permissionless and the destination is fixed in the program, so there
      // is nothing to gain by running it and no reason to spend a player's
      // prompt on the house's bookkeeping. Best effort — a table that never
      // raked a pot refuses, and that must never block a cash-out.
      try {
        const program = makeProgram(conn);
        const ix = await sweepRakeIx(program, table, session.publicKey);
        const tx = new Transaction().add(ix);
        const bh = await conn.getLatestBlockhash();
        tx.feePayer = session.publicKey;
        tx.recentBlockhash = bh.blockhash;
        tx.sign(session);
        const sig = await conn.sendRawTransaction(tx.serialize());
        await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        console.log(`swept this table's rake to the treasury: ${sig}`);
      } catch {
        // Nothing accrued, or another client swept it first. Either is fine.
      }

      toast("Table paused. You can cash out now.", "good");
    } catch (e) {
      toast(friendlyError(e), "bad");
    } finally {
      phase(null);
    }
  }, [table, session, erProgram, erConnection, sessionToken, publicKey]);

  /**
   * Cash out, without stopping the game for everyone else.
   *
   * Leaving is a base-layer move — `leave_table` writes both the seat and the
   * player balance, and `Player` is never delegated — so a seat genuinely has
   * to come off the rollup before its chips can go home. That is the custody
   * guarantee, not an oversight: it is exactly why the rollup can never reach
   * anybody's balance.
   *
   * What used to be wrong was making the player carry that. They had to press
   * "Pause table", which reads like an admin action, stops everyone, and only
   * then offers a cash out. This does the whole sequence for them:
   *
   *   1. Sit out at once, so the next hand is dealt without them. That is what
   *      `release_hole` already does — giving up the read right clears
   *      `cards_secured`, and `start_hand` builds `dealt_in` from that. The
   *      same instruction that keeps the chair alive for the next player is
   *      also the honest way to say "deal me out".
   *   2. Let the current hand finish. Nobody's pot is interrupted.
   *   3. Bring the table back to Solana.
   *   4. Move the chips into the balance.
   *   5. Put the table back on the rollup for whoever is still playing.
   *
   * Only step 3 costs anything, and it is paid once per departure rather than
   * once per hand, which is what makes this affordable at all.
   */
  const cashOut = useCallback(
    async (seatIndex: number) => {
      if (!table || !publicKey) return;
      setBusy("cashout");
      // Told to the crank before the release below, not after: the crank ticks
      // twice a second and would otherwise re-secure the seat between the two
      // statements. Written straight to the store rather than through React
      // state because it has to be true for the very next tick.
      useTableStore.getState().setLeavingSeat(seatIndex);
      try {
        const conn = getBaseConnection();
        let onRollup = await isDelegated(conn, table);

        if (onRollup) {
          // 1. Stop being dealt in. Immediate, and it survives us closing the
          //    tab, because it is on chain rather than in this component.
          if (erProgram && erConnection && session && sessionToken) {
            try {
              const tx = new Transaction().add(
                await releaseHoleIx(erProgram, table, seatIndex, {
                  payer: session.publicKey,
                  authority: publicKey,
                  sessionToken,
                }),
              );
              await sendEr(erConnection, tx, {
                signers: [session],
                feePayer: session.publicKey,
                label: "sit out",
              });
            } catch {
              // Already sitting out, or a hand is live on this seat. Either way
              // the wait below handles it.
            }
          }

          // 2. Wait out the current hand rather than cutting it short. Bounded,
          //    because a hand that never ends is a different problem and the
          //    turn clock is what solves that one.
          const liveNow = useTableStore.getState().table?.state === 1;
          if (liveNow) {
            toast("Cashing out when this hand ends.", "good");
            for (let i = 0; i < 180; i++) {
              if (useTableStore.getState().table?.state !== 1) break;
              await sleep(1000);
            }
          }

          // 3. Bring the table home.
          //
          // Nested, here and below: this is one errand from the player's side,
          // so it reads as one. The sub-actions would otherwise each announce
          // themselves and then blank `busy` on the way out, flickering the
          // overlay off three times in the middle of a cash-out.
          setBusy("cashout:pausing");
          await pauseTable({ nested: true });
          onRollup = await isDelegated(conn, table);
        }

        if (onRollup) {
          // `pauseTable` has already said why and how long, so do not talk over it.
          return;
        }

        // 4. Chips back into the balance.
        setBusy("cashout:leaving");
        await leave(seatIndex, { nested: true });

        // 4b. And the house's share, while the table is still on Solana.
        //
        // This path puts the table straight back on the rollup below, so a
        // rake left unswept here is locked away again until the next time
        // somebody pauses. Session-signed and best effort: it is bookkeeping,
        // not the player's errand, and it must never block a cash-out.
        if (session) {
          try {
            const program = makeProgram(conn);
            const tx = new Transaction().add(
              await sweepRakeIx(program, table, session.publicKey),
            );
            const bh = await conn.getLatestBlockhash();
            tx.feePayer = session.publicKey;
            tx.recentBlockhash = bh.blockhash;
            tx.sign(session);
            const sig = await conn.sendRawTransaction(tx.serialize());
            await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
            console.log(`swept this table's rake to the treasury: ${sig}`);
          } catch {
            // Nothing accrued, or somebody swept it first.
          }
        }

        // 5. Hand the table back to whoever is still sitting, so cashing out
        //    does not end their game. Best effort and deliberately last: if it
        //    fails they simply see "Start playing" again, with their chips safe
        //    on Solana either way.
        const remaining = useTableStore
          .getState()
          .seats.filter((s, i) => i !== seatIndex && s?.occupant && s.stack > 0);
        if (remaining.length >= 2 && tableId) {
          try {
            setBusy("cashout:resuming");
            await startTable(remaining.map((s) => s!.index), { nested: true });
          } catch {
            // They can press Start themselves.
          }
        }
      } finally {
        useTableStore.getState().setLeavingSeat(null);
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, tableId, publicKey, erProgram, erConnection, session, sessionToken],
  );

  /**
   * Put fresh chips on the chair you are already sitting in.
   *
   * A busted player is the one state this table had no way out of. Their seat
   * is theirs, their stack is zero, and a zero stack is not dealt in — so they
   * sat and watched, and the only button offered to them was the one that
   * leaves. The game they came for was behind a rebuy that did not exist.
   *
   * The program has no top-up instruction, and that is not an oversight: a
   * stack is set when the chair is taken and `take_seat` refuses an occupied
   * chair, which is what keeps a seat's chips accounted for through every hand
   * it plays. So a rebuy is genuinely a stand-up followed by a sit-down at the
   * same chair, and the chips travel back through the player balance — the one
   * place the rollup can never reach — on the way.
   *
   * The sequence is the cash-out's, with a sit on the end:
   *
   *   1. Sit out, so the next hand is dealt without the chair being swapped
   *      underneath it.
   *   2. Let the current hand finish. Nobody's pot is interrupted.
   *   3. Bring the table back to Solana, because balances only exist there.
   *   4. Stand up, then sit down again with the new stack.
   *   5. Put the table back on the rollup for everyone still playing.
   *
   * Same cost as a cash-out, paid for the same reason, and the player presses
   * one button.
   */
  const rebuy = useCallback(
    async (seatIndex: number, buyIn: number): Promise<JoinResult> => {
      const nothing: JoinResult = { ok: false, session: null };
      if (!table || !tableId || !publicKey) return nothing;
      setBusy("rebuy");
      // The crank must not re-secure a chair that is about to be vacated: the
      // permission it would write names an occupant who is halfway out of it.
      useTableStore.getState().setLeavingSeat(seatIndex);
      try {
        const conn = getBaseConnection();
        let onRollup = await isDelegated(conn, table);

        if (onRollup) {
          // 1. Stop being dealt in. Best effort: a seat with no chips is not
          //    being dealt in anyway, and a live hand refuses this outright.
          if (erProgram && erConnection && session && sessionToken) {
            try {
              const tx = new Transaction().add(
                await releaseHoleIx(erProgram, table, seatIndex, {
                  payer: session.publicKey,
                  authority: publicKey,
                  sessionToken,
                }),
              );
              await sendEr(erConnection, tx, {
                signers: [session],
                feePayer: session.publicKey,
                label: "sit out",
              });
            } catch {
              // Already out, or a hand is live. The wait below covers both.
            }
          }

          // 2. Never cut a hand short.
          if (useTableStore.getState().table?.state === 1) {
            toast("Buying back in when this hand ends.", "good");
            for (let i = 0; i < 180; i++) {
              if (useTableStore.getState().table?.state !== 1) break;
              await sleep(1000);
            }
          }

          // 3. Home to Solana, where the balance lives.
          setBusy("rebuy:pausing");
          await pauseTable({ nested: true });
          onRollup = await isDelegated(conn, table);
        }

        // `pauseTable` has already said why and for how long.
        if (onRollup) return nothing;

        // 4. The swap itself. If standing up fails the chair is untouched and
        //    the player still has whatever they had, so it stops here rather
        //    than trying to sit into a seat it never left.
        setBusy("rebuy:leaving");
        if (!(await leave(seatIndex, { nested: true, quiet: true }))) return nothing;

        setBusy("rebuy:sitting");
        const sat = await join(seatIndex, buyIn, { nested: true });

        // 5. Back on the rollup for whoever is still playing, exactly as a
        //    cash-out does it. Best effort: the fallback is the Start button.
        //
        //    Only when the sit landed. Resuming a table this player has just
        //    stood up from, with their chips back in their balance and no
        //    chair, would be the worst possible ending to a rebuy.
        if (sat.ok) {
          // The chair is not leaving any more, and the crank refuses to secure
          // a seat that is: holding the flag through the resume would start a
          // table with this player's own cards unsecured, which is the one
          // seat at it that must not be.
          useTableStore.getState().setLeavingSeat(null);

          // This chair counts on the strength of the sit that just landed:
          // the subscription carrying its new stack is a moment behind, and
          // waiting for it would leave the table paused with two funded
          // players sitting at it.
          const playing = useTableStore
            .getState()
            .seats.filter((s) => s?.occupant && (s.stack > 0 || s.index === seatIndex));
          if (playing.length >= 2) {
            try {
              setBusy("rebuy:resuming");
              await startTable(playing.map((s) => s!.index), { nested: true });
            } catch {
              // They can press Start themselves.
            }
          }
        }
        return sat;
      } catch (e) {
        toast(friendlyError(e), "bad");
        return nothing;
      } finally {
        useTableStore.getState().setLeavingSeat(null);
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, tableId, publicKey, erProgram, erConnection, session, sessionToken],
  );

  /**
   * Bet, signed by the session key so there is no prompt.
   *
   * RaiseTo is a street total rather than an increment, which is what the
   * program expects and what the action bar already computes.
   */
  const act = useCallback(
    async (kind: ActionKind, toTotal: number) => {
      if (!table || !config || !session || !publicKey) return;
      if (!erProgram || !erConnection) {
        toast("Not connected to the game validator. Retry the connection first.", "bad");
        return;
      }
      // A ref, not the `busy` state, because state does not settle until React
      // re-renders and two clicks can land in the same tick — a double-tap on a
      // phone, or a stuck mouse button. Both would be sent. On a raise that is
      // two bets; the second is refused on chain as `OutOfTurn`, but only after
      // the first has already committed chips the player did not mean to
      // commit twice, and the refusal surfaces as a failure they cannot
      // explain. Cheaper to never send it.
      if (actInFlight.current) return;
      actInFlight.current = true;
      try {
        const move: Move =
          kind === "fold"
            ? MOVES.fold
            : kind === "check"
              ? MOVES.check
              : kind === "call"
                ? MOVES.call
                : kind === "allin"
                  ? MOVES.allIn
                  : MOVES.raiseTo(toTotal);

        const ix = await playerActionIx(erProgram, table, config, move, {
          payer: session.publicKey,
          authority: publicKey,
          sessionToken,
        });
        const tx = new Transaction().add(ix);
        await sendEr(erConnection, tx, {
          signers: [session],
          feePayer: session.publicKey,
          label: kind,
        });
      } finally {
        actInFlight.current = false;
      }
    },
    [erProgram, erConnection, table, config, session, sessionToken, publicKey],
  );

  return { join, leave, rebuy, cashOut, deleteTable, startTable, pauseTable, act, busy };
}
