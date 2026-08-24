"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram } from "@/lib/anchor";
import { decodePlayer } from "@/lib/decode";
import { playerPda, usdcAta } from "@/lib/pdas";
import { buyChipsIx, initPlayerIx, sellChipsIx } from "@/lib/instructions";
import { GAS_FLOOR_LAMPORTS } from "@/lib/constants";
import { formatUsd, microUsdcToChips } from "@/lib/money";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";

/** Amount lives at offset 64 of an SPL token account: mint(32) + owner(32). */
const TOKEN_AMOUNT_OFFSET = 64;

function readTokenAmount(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Number(view.getBigUint64(TOKEN_AMOUNT_OFFSET, true));
}

export interface PlayerState {
  exists: boolean;
  chips: number;
  handsPlayed: number;
  /** Wallet USDC, in base units. What chips are bought with. */
  microUsdc: number;
  /** Whether the wallet has a USDC account at all. */
  hasUsdcAccount: boolean;
  /** Wallet SOL, in lamports. Not money here — postage. */
  lamports: number;
}

/**
 * The player's balances: chips on the program, USDC and SOL in the wallet.
 *
 * Chips are backed one to one by USDC in the program vault, at a rate fixed in
 * the program. Buying moves USDC in, selling pays it back out, and both live
 * only on the base layer, which is why a session key can never touch either.
 *
 * The two wallet balances answer different questions and both have to be asked.
 * USDC says how many chips are affordable; SOL says whether the transaction can
 * be sent at all. A wallet with fifty dollars and no SOL can afford five
 * hundred chips and buy none of them, and it should be told that before it
 * signs rather than after.
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
      // One round trip. `getAccountInfo` on the token account rather than
      // `getTokenAccountBalance`, which throws when the account is missing —
      // and "never held USDC" is an ordinary state, not an error.
      const [info, ataInfo, lamports] = await Promise.all([
        conn.getAccountInfo(playerPda(publicKey)),
        conn.getAccountInfo(usdcAta(publicKey)),
        conn.getBalance(publicKey),
      ]);

      const hasUsdcAccount = ataInfo !== null;
      const microUsdc = ataInfo ? readTokenAmount(new Uint8Array(ataInfo.data)) : 0;

      if (!info) {
        setState({
          exists: false,
          chips: 0,
          handsPlayed: 0,
          microUsdc,
          hasUsdcAccount,
          lamports,
        });
        return;
      }
      const p = decodePlayer(new Uint8Array(info.data));
      setState({
        exists: true,
        chips: p.chips,
        handsPlayed: p.handsPlayed,
        microUsdc,
        hasUsdcAccount,
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

        const amount = formatUsd(chips);
        toast(
          kind === "buy"
            ? `Bought ${chips.toLocaleString()} chips for ${amount}`
            : `Sold ${chips.toLocaleString()} chips for ${amount}`,
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

  /** The most chips the wallet's USDC can buy. */
  const affordable = state ? microUsdcToChips(state.microUsdc) : 0;

  /** Whether there is enough SOL to pay for a transaction at all. */
  const gasOk = (state?.lamports ?? 0) >= GAS_FLOOR_LAMPORTS;

  /**
   * Why buying is not possible right now, in words, or null if it is. Selling
   * is gated on gas alone — the chips are already yours.
   */
  const buyBlocked: string | null = !state
    ? null
    : !gasOk
      ? "Add a little SOL to this wallet — Solana charges network fees in SOL, not USDC."
      : state.microUsdc === 0
        ? "This wallet has no USDC yet. Send some here, then buy chips."
        : null;

  const sellBlocked: string | null =
    state && !gasOk
      ? "Add a little SOL to this wallet to cover the network fee."
      : null;

  return { state, refresh, buy, sell, busy, affordable, gasOk, buyBlocked, sellBlocked };
}
