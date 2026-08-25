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
import { friendlyError, sendEr, sleep } from "@/lib/net";
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

  /** Wallet only. This takes chips out of your balance. */
  /**
   * Take a seat, and quietly acquire the key that lets you act at it.
   *
   * A session key is only ever wanted because someone is sitting down, so it
   * rides in the same transaction rather than being a second thing to approve.
   * One prompt, one signature, and nothing to find afterwards.
   *
   * Returns the session it created, or null if one already existed, so the
   * caller can put it straight into state without a round trip.
   */
  const join = useCallback(
    async (seatIndex: number, buyIn: number): Promise<SessionHandle | null> => {
      if (!tableId || !publicKey) return null;
      setBusy("join");
      try {
        const conn = getBaseConnection();

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
        return handle;
      } catch (e) {
        toast(friendlyError(e), "bad");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [tableId, sendBase, publicKey],
  );

  /** Wallet only. This puts your seat stack back into your balance. */
  const leave = useCallback(
    async (seatIndex: number) => {
      if (!table) return;
      setBusy("leave");
      try {
        await sendBase(
          async (program) =>
            new Transaction().add(await leaveTableIx(program, table, seatIndex, publicKey!)),
          "leave",
        );
        toast("Cashed out", "good");
      } catch (e) {
        toast(friendlyError(e), "bad");
      } finally {
        setBusy(null);
      }
    },
    [table, sendBase, publicKey],
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
    async (occupiedSeats: number[]) => {
      if (!tableId || !table || !session || !publicKey) return;
      // A silent return here left a button that did nothing. Say why instead.
      if (!erProgram || !erConnection) {
        toast(
          "Not connected to the game validator yet. Approve the signature request, or reload and try again.",
          "bad",
        );
        return;
      }
      setBusy("start");
      try {
        const conn = getBaseConnection();
        const program = makeProgram(conn);

        setBusy("start:funding");
        // The session key pays for all of this, so it needs a balance.
        const bal = await conn.getBalance(session.publicKey);
        if (bal < 0.004 * 1e9) {
          if (!signTransaction) throw new Error("connect a wallet first");
          const { SystemProgram } = await import("@solana/web3.js");
          const fund = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: session.publicKey,
              lamports: 0.010 * 1e9,
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
        setBusy("start:delegating");
        const sendAsSession = async (ix: Awaited<ReturnType<typeof delegateCoreIx>>, label: string) => {
          const tx = new Transaction().add(ix);
          const bh = await conn.getLatestBlockhash();
          tx.feePayer = session.publicKey;
          tx.recentBlockhash = bh.blockhash;
          tx.sign(session);
          const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
          const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
          if (conf.value.err) {
            throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`);
          }
        };
        const delegatedAlready = async (account: PublicKey) => {
          const info = await conn.getAccountInfo(account);
          return !!info && !info.owner.equals(PROGRAM_ID);
        };

        if (!(await delegatedAlready(table))) {
          try {
            await sendAsSession(
              await delegateCoreIx(program, tableId, session.publicKey),
              "delegate table",
            );
          } catch (e) {
            if (!(await delegatedAlready(table))) throw e;
          }
        }
        for (let i = 0; i < MAX_SEATS; i++) {
          const seat = seatPda(table, i);
          if (await delegatedAlready(seat)) continue;
          try {
            await sendAsSession(
              await delegateSeatIx(program, table, i, session.publicKey),
              `delegate seat ${i}`,
            );
          } catch (e) {
            if (!(await delegatedAlready(seat))) throw e;
          }
        }

        // Delegation takes a moment to reach the rollup, and the base layer
        // cannot say when: it flips owners the moment the transaction lands.
        // Ask the rollup itself whether it serves the last seat yet.
        setBusy("start:waiting");
        for (let t = 0; t < 40; t++) {
          try {
            const info = await erConnection.getAccountInfo(seatPda(table, MAX_SEATS - 1));
            if (info) break;
          } catch {
            // Not there yet.
          }
          await sleep(750);
        }

        // Lock the deck to nobody and each hand to its owner. Retried because
        // the rollup can serve reads a beat before it accepts writes.
        setBusy("start:securing");
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
        await secure(await secureDeckIx(erProgram, table, session.publicKey), "secure deck");

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
          } catch {
            unsecured.push(i);
          }
        }
        // Permissions take a couple of seconds to take effect.
        await sleep(2500);

        if (unsecured.length) {
          toast(
            `Table is live. ${unsecured.length === 1 ? "One chair is" : `${unsecured.length} chairs are`} ` +
              `still held by whoever sat there last, so ${unsecured.length === 1 ? "it sits" : "they sit"} ` +
              `out this hand. Everyone else can play.`,
            "bad",
          );
        } else {
          toast("Table is live. Cards are locked down.", "good");
        }
      } catch (e) {
        console.error("start table failed:", e);
        toast(friendlyError(e), "bad");
      } finally {
        setBusy(null);
      }
    },
    [tableId, table, session, erProgram, erConnection, publicKey, signTransaction],
  );

  /** Bring the table back to the base layer so people can cash out. */
  const pauseTable = useCallback(async () => {
    if (!table || !session) return;
    if (!erProgram || !erConnection) {
      toast("Not connected to the game validator. Retry the connection first.", "bad");
      return;
    }
    setBusy("pause");
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
        setBusy("pause:waiting");

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
            "The table could not be closed yet. Your chips are safe on the table — try again in a minute.",
            "bad",
          );
          return;
        }
        setBusy("pause");
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
      setBusy(null);
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
          setBusy("cashout:pausing");
          await pauseTable();
          onRollup = await isDelegated(conn, table);
        }

        if (onRollup) {
          // `pauseTable` has already said why and how long, so do not talk over it.
          return;
        }

        // 4. Chips back into the balance.
        setBusy("cashout:leaving");
        await leave(seatIndex);

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
            await startTable(remaining.map((s) => s!.index));
          } catch {
            // They can press Start themselves.
          }
        }
      } finally {
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

  return { join, leave, cashOut, deleteTable, startTable, pauseTable, act, busy };
}
