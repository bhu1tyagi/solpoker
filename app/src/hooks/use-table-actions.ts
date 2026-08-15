"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram, type SolpokerProgram } from "@/lib/anchor";
import {
  closeTableIx,
  commitResultsIx,
  delegateCoreIx,
  delegateSeatIx,
  joinTableIx,
  vacateSeatIx,
  leaveTableIx,
  playerActionIx,
  secureDeckIx,
  secureHoleIx,
  undelegateCoreIx,
  undelegateSeatIx,
  MOVES,
  type Move,
} from "@/lib/instructions";
import { DELEGATION_PROGRAM, MAX_SEATS, PROGRAM_ID } from "@/lib/constants";
import { seatPda } from "@/lib/pdas";
import { friendlyError, sendEr, sleep } from "@/lib/net";
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
  const { erConnection, erProgram, table, config, tableId, session, sessionToken } = args;

  /** Sign and send on the base layer, where the wallet is required. */
  const sendBase = useCallback(
    async (
      build: (program: SolpokerProgram, conn: Connection) => Promise<Transaction>,
      label: string,
    ) => {
      if (!publicKey || !signTransaction) throw new Error("connect a wallet first");
      const conn = getBaseConnection();
      const program = makeProgram(conn);
      const tx = await build(program, conn);
      const bh = await conn.getLatestBlockhash();
      tx.feePayer = publicKey;
      tx.recentBlockhash = bh.blockhash;
      const signed = await signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (conf.value.err) {
        throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`);
      }
      return sig;
    },
    [publicKey, signTransaction],
  );

  /** Wallet only. This takes chips out of your balance. */
  const join = useCallback(
    async (seatIndex: number, buyIn: number) => {
      if (!tableId) return;
      setBusy("join");
      try {
        await sendBase(
          async (program, conn) => {
            const tx = new Transaction().add(
              await joinTableIx(program, tableId, seatIndex, buyIn, publicKey!),
            );
            tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
            return tx;
          },
          "join",
        );
        toast(`Sat down with ${buyIn.toLocaleString()} chips`, "good");
      } catch (e) {
        toast(friendlyError(e), "bad");
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
        await sendBase(
          async (program) =>
            new Transaction().add(
              await closeTableIx(program, table, config, publicKey, publicKey),
            ),
          "delete table",
        );
        toast("Table deleted", "good");
        return true;
      } catch (e) {
        toast(friendlyError(e), "bad");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [table, config, publicKey, sendBase],
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
        if (bal < 0.05 * 1e9) {
          if (!signTransaction) throw new Error("connect a wallet first");
          const { SystemProgram } = await import("@solana/web3.js");
          const fund = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: session.publicKey,
              lamports: 0.08 * 1e9,
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

        await sendAsSession(
          await delegateCoreIx(program, tableId, session.publicKey),
          "delegate table",
        );
        for (let i = 0; i < MAX_SEATS; i++) {
          await sendAsSession(
            await delegateSeatIx(program, table, i, session.publicKey),
            `delegate seat ${i}`,
          );
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
        await secure(await secureDeckIx(erProgram, table, session.publicKey), "secure deck");
        for (let i = 0; i < MAX_SEATS; i++) {
          await secure(
            await secureHoleIx(erProgram, table, i, session.publicKey),
            `secure seat ${i}`,
          );
        }
        // Permissions take a couple of seconds to take effect.
        await sleep(2500);

        toast("Table is live. Cards are locked down.", "good");
      } catch (e) {
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
      await send(await undelegateCoreIx(erProgram, table, session.publicKey), "undelegate table");
      for (let i = 0; i < MAX_SEATS; i++) {
        await send(
          await undelegateSeatIx(erProgram, table, i, session.publicKey),
          `undelegate seat ${i}`,
        );
      }

      // Seats come back one at a time, so wait for all of them before saying so.
      const conn = getBaseConnection();
      const all = [table, ...Array.from({ length: MAX_SEATS }, (_, i) => seatPda(table, i))];
      for (let t = 0; t < 60; t++) {
        const infos = await conn.getMultipleAccountsInfo(all);
        if (infos.every((i) => i?.owner.equals(PROGRAM_ID))) break;
        await sleep(1000);
      }
      toast("Table paused. You can cash out now.", "good");
    } catch (e) {
      toast(friendlyError(e), "bad");
    } finally {
      setBusy(null);
    }
  }, [table, session, erProgram, erConnection]);

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
    },
    [erProgram, erConnection, table, config, session, sessionToken, publicKey],
  );

  return { join, leave, deleteTable, startTable, pauseTable, act, busy };
}
