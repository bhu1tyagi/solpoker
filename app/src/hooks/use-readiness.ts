"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePlayer } from "./use-player";
import { ONBOARD_FLOOR_MICRO_USDC, PLAY_FLOOR_LAMPORTS } from "@/lib/constants";

/**
 * Whether this wallet may sit down, and if not, which step is in the way.
 *
 * One answer, shared. The gate used to work this out privately, which meant
 * the lobby had no way to ask — and the two would have drifted the moment
 * either changed. Now the gate renders the step and the lobby refuses entry
 * from the same source.
 *
 * Four things, strictly in order. Only the first unmet one is ever shown:
 *
 *   1. a wallet             nothing else can be known without it
 *   2. SOL for fees         Solana charges in SOL, not USDC
 *   3. USDC                 what chips are actually bought with
 *   4. chips                a seat takes chips, not a balance
 *
 * Chips are step four rather than part of step three because holding USDC and
 * holding chips are genuinely different states, and a player stuck between
 * them was previously told to go and get USDC they already had.
 */

export const READINESS_STEPS = [
  { title: "Connect wallet", short: "Phantom, Solflare, or any Solana wallet" },
  { title: "Network fees", short: "a little SOL covers a session" },
  { title: "Gaming capital", short: "USDC buys chips, tables from $4" },
  { title: "Buy chips", short: "a seat is taken with chips" },
] as const;

export interface Readiness {
  /** Every step done. The only state that may enter a table. */
  ready: boolean;
  /** Index of the first unmet step, or -1 when there is none. */
  active: number;
  done: boolean[];
  /**
   * The answer is not knowable yet.
   *
   * Distinct from "not ready": a wallet mid-reconnect, or balances that have
   * not arrived, would otherwise be accused of a step already taken. Nothing
   * should refuse a player while this is true.
   */
  resolving: boolean;
  lamports: number;
  microUsdc: number;
  chips: number;
}

export function useReadiness(): Readiness {
  const { connected, connecting, wallet } = useWallet();
  const { state } = usePlayer();
  const [mounted, setMounted] = useState(false);
  // Past this, whatever is known wins, so nothing can hang on a wallet that
  // never answers.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = setTimeout(() => setSettled(true), 6000);
    return () => clearTimeout(t);
  }, []);

  // autoConnect will reconnect a wallet the adapter already remembers, so a
  // returning player is briefly disconnected while being connected.
  const expectAuto = wallet !== null && !connected;

  const lamports = state?.lamports ?? 0;
  const microUsdc = state?.microUsdc ?? 0;
  const chips = state?.chips ?? 0;

  const done = [
    connected,
    connected && lamports >= PLAY_FLOOR_LAMPORTS,
    connected && (microUsdc >= ONBOARD_FLOOR_MICRO_USDC || chips > 0),
    connected && chips > 0,
  ];
  const active = done.indexOf(false);

  /*
   * Two different kinds of waiting, and only one of them may time out.
   *
   * The connect phase (mounting, the adapter reconnecting) is capped by
   * `settled`: a wallet extension that never answers must not hang the page.
   * But a CONNECTED wallet whose balances have not arrived is not a timeout
   * case — it is simply not yet known, and the cap used to convert that
   * unknown into "you hold nothing": one slow RPC read and the gate opened
   * over a funded wallet, showing 0.000 SOL. Balance-unknown now stays
   * resolving until the read lands (use-player retries it), and nothing
   * accuses anyone in the meantime.
   */
  const resolving =
    (!settled && (!mounted || connecting || expectAuto)) ||
    (mounted && connected && state === null);

  return {
    ready: active === -1,
    active,
    done,
    resolving,
    lamports,
    microUsdc,
    chips,
  };
}
