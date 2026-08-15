"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram } from "@/lib/anchor";
import { decodePlayer } from "@/lib/decode";
import { playerPda } from "@/lib/pdas";
import { buyChipsIx, initPlayerIx, sellChipsIx } from "@/lib/instructions";
import { LAMPORTS_PER_CHIP } from "@/lib/constants";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";

export interface PlayerState {
  exists: boolean;
  chips: number;
  handsPlayed: number;
  /** Wallet SOL, in lamports, for pricing a purchase. */
  lamports: number;
}

/**
 * The player's balances: chips on the program, SOL in the wallet.
 *
 * Chips are backed one to one by SOL in the program vault, at a rate fixed in
 * the program. Buying moves SOL in, selling pays it back out, and both live
 * only on the base layer, which is why a session key can never touch either.
 */
export function usePlayer() {
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<PlayerState | null>(null);
  const [busy, setBusy] = useState<"buy" | "sell" | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setState(null);
      return;
    }
    try {
      const conn = getBaseConnection();
      const [info, lamports] = await Promise.all([
        conn.getAccountInfo(playerPda(publicKey)),
        conn.getBalance(publicKey),
      ]);
      if (!info) {
        setState({ exists: false, chips: 0, handsPlayed: 0, lamports });
        return;
      }
      const p = decodePlayer(new Uint8Array(info.data));
      setState({
        exists: true,
        chips: p.chips,
        handsPlayed: p.handsPlayed,
        lamports,
      });
    } catch {
      // A failed read is not "no account". Leave state as it was; the next
      // refresh will try again.
    }
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = useCallback(
    async (kind: "buy" | "sell", chips: number) => {
      if (!publicKey || !signTransaction || chips <= 0) return;
      setBusy(kind);
      try {
        const conn = getBaseConnection();
        const program = makeProgram(conn);
        const ixs = [];
        // Decide from the chain, right now. init_player on an existing
        // account fails the whole transaction with a confusing error.
        const existing = await conn.getAccountInfo(playerPda(publicKey));
        if (!existing) ixs.push(await initPlayerIx(program, publicKey));
        ixs.push(
          kind === "buy"
            ? await buyChipsIx(program, publicKey, chips)
            : await sellChipsIx(program, publicKey, chips),
        );

        const tx = new Transaction().add(...ixs);
        tx.feePayer = publicKey;
        const bh = await conn.getLatestBlockhash();
        tx.recentBlockhash = bh.blockhash;

        const signed = await signTransaction(tx);
        const sig = await conn.sendRawTransaction(signed.serialize());
        const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));

        const sol = (chips * LAMPORTS_PER_CHIP) / 1e9;
        toast(
          kind === "buy"
            ? `Bought ${chips.toLocaleString()} chips for ${sol} SOL`
            : `Sold ${chips.toLocaleString()} chips for ${sol} SOL`,
          "good",
        );
        await refresh();
      } catch (e) {
        toast(friendlyError(e), "bad");
      } finally {
        setBusy(null);
      }
    },
    [publicKey, signTransaction, refresh],
  );

  const buy = useCallback((chips: number) => send("buy", chips), [send]);
  const sell = useCallback((chips: number) => send("sell", chips), [send]);

  /** The most chips the wallet can afford, leaving some SOL for fees. */
  const affordable = state
    ? Math.max(0, Math.floor((state.lamports - 0.01 * 1e9) / LAMPORTS_PER_CHIP))
    : 0;

  return { state, refresh, buy, sell, busy, affordable };
}
