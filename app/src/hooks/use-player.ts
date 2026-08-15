"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram } from "@/lib/anchor";
import { decodePlayer } from "@/lib/decode";
import { playerPda } from "@/lib/pdas";
import { claimFaucetIx, initPlayerIx } from "@/lib/instructions";
import { FAUCET_COOLDOWN_SECS } from "@/lib/constants";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";

export interface PlayerState {
  exists: boolean;
  chips: number;
  lastFaucetTs: number;
  handsPlayed: number;
}

/**
 * The player's chip balance on the base layer.
 *
 * Chips live here, not on the rollup, and only base-layer instructions can move
 * them into or out of a seat. That separation is the reason a session key can
 * never cash you out.
 */
export function usePlayer() {
  const { publicKey, signTransaction } = useWallet();
  const [state, setState] = useState<PlayerState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setState(null);
      return;
    }
    try {
      const conn = getBaseConnection();
      const info = await conn.getAccountInfo(playerPda(publicKey));
      if (!info) {
        setState({ exists: false, chips: 0, lastFaucetTs: 0, handsPlayed: 0 });
        return;
      }
      const p = decodePlayer(new Uint8Array(info.data));
      setState({
        exists: true,
        chips: p.chips,
        lastFaucetTs: p.lastFaucetTs,
        handsPlayed: p.handsPlayed,
      });
    } catch {
      // A failed read is not "no account". Leave state as it was; the next
      // refresh will try again.
    }
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Claim the daily allowance, creating the account first if needed.
   *
   * init_player is a plain init, not init_if_needed, so calling it twice fails.
   * Check before including it rather than catching afterwards.
   */
  const claim = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    try {
      const conn = getBaseConnection();
      const program = makeProgram(conn);
      const ixs = [];
      // Decide from the chain, right now. Hook state can be stale or null
      // after a failed read, and init_player on an existing account fails
      // the whole claim with a confusing error.
      const existing = await conn.getAccountInfo(playerPda(publicKey));
      if (!existing) ixs.push(await initPlayerIx(program, publicKey));
      ixs.push(await claimFaucetIx(program, publicKey));

      const tx = new Transaction().add(...ixs);
      tx.feePayer = publicKey;
      const bh = await conn.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;

      const signed = await signTransaction(tx);
      const sig = await conn.sendRawTransaction(signed.serialize());
      const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));

      toast("Claimed 10,000 chips", "good");
      await refresh();
    } catch (e) {
      toast(friendlyError(e), "bad");
    } finally {
      setBusy(false);
    }
  }, [publicKey, signTransaction, state?.exists, refresh]);

  const now = Math.floor(Date.now() / 1000);
  const canClaim =
    !state?.exists || state.lastFaucetTs === 0 || now - state.lastFaucetTs >= FAUCET_COOLDOWN_SECS;
  const nextClaimIn = state?.lastFaucetTs
    ? Math.max(0, state.lastFaucetTs + FAUCET_COOLDOWN_SECS - now)
    : 0;

  return { state, refresh, claim, busy, canClaim, nextClaimIn };
}
