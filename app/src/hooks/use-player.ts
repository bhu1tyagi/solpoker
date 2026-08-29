"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram } from "@/lib/anchor";
import { decodePlayer } from "@/lib/decode";
import { playerPda, usdcAta } from "@/lib/pdas";
import { buyChipsIx, initPlayerIx, sellChipsIx } from "@/lib/instructions";
import { GAS_FLOOR_LAMPORTS } from "@/lib/constants";
import { formatUsd, microUsdcToChips } from "@/lib/money";
import { friendlyError } from "@/lib/net";
import { toast } from "@/stores/ui-store";

/**
 * The last balances this browser saw, per wallet.
 *
 * Balances used to start every page as unknown and be re-read from scratch,
 * which is why walking from the lobby to a table and back put a "reading your
 * wallet" card on the screen each time: nothing downstream could tell "not
 * known yet" from "not known ever". They are plain numbers and the wallet is
 * the key, so the previous answer goes up immediately and the fresh read —
 * plus the account subscriptions below — corrects it within the second.
 *
 * Held per wallet on purpose. Switching wallets must never show the previous
 * one's money, so a miss is simply a miss.
 */
const BALANCE_CACHE_KEY = "solpoker:balances";

function readBalanceCache(wallet: string): PlayerState | null {
  try {
    const all = JSON.parse(localStorage.getItem(BALANCE_CACHE_KEY) ?? "{}");
    const hit = all[wallet];
    return hit && typeof hit.lamports === "number" ? (hit as PlayerState) : null;
  } catch {
    return null;
  }
}

function writeBalanceCache(wallet: string, state: PlayerState) {
  try {
    const all = JSON.parse(localStorage.getItem(BALANCE_CACHE_KEY) ?? "{}");
    all[wallet] = state;
    localStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(all));
  } catch {
    // Storage being unavailable only costs the warm start.
  }
}

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

/*
 * After the first read, the balances keep themselves.
 *
 * "Did my deposit arrive?" is the one moment a player actually stares at these
 * numbers, and they used to move only on a reload or after an action. Three
 * account subscriptions — the player account, the USDC account, the wallet
 * itself — and a transfer sent from an exchange or a phone shows up the moment
 * it confirms, wherever on the site it is being watched.
 *
 * Shared across every mounted copy of the hook, because there are around five
 * per page (the header, the gate, readiness, the page itself) and each opening
 * its own three subscriptions would ask the endpoint the same question
 * fifteen times. One set per wallet; each hook registers to be told.
 *
 * Pushes are folded into existing state rather than creating it: until a
 * hook's first full read lands there is nothing sound to fold into, and that
 * read is retried until it does. The USDC account may not exist yet and the
 * player account may never have been made — subscribing to an address that
 * does not exist is free, and the notification that creates it is exactly the
 * news wanted.
 */
type PlayerPatch = (cur: PlayerState) => PlayerState;

const patchListeners = new Set<(patch: PlayerPatch) => void>();
let subscribedWallet: string | null = null;
let subscriptionIds: number[] = [];

function teardownBalanceSubscriptions() {
  const conn = getBaseConnection();
  for (const id of subscriptionIds) {
    void conn.removeAccountChangeListener(id).catch(() => {});
  }
  subscriptionIds = [];
  subscribedWallet = null;
}

function ensureBalanceSubscriptions(publicKey: PublicKey) {
  const wallet = publicKey.toBase58();
  if (subscribedWallet === wallet) return;
  teardownBalanceSubscriptions();
  subscribedWallet = wallet;

  const conn = getBaseConnection();
  const push = (patch: PlayerPatch) => {
    for (const l of patchListeners) l(patch);
  };

  subscriptionIds = [
    conn.onAccountChange(
      playerPda(publicKey),
      (info) => {
        try {
          const p = decodePlayer(new Uint8Array(info.data));
          push((cur) => ({
            ...cur,
            exists: true,
            chips: p.chips,
            handsPlayed: p.handsPlayed,
          }));
        } catch {
          // A half-written or foreign layout is not news.
        }
      },
      { commitment: "confirmed" },
    ),
    conn.onAccountChange(
      usdcAta(publicKey),
      (info) => {
        // A closed token account notifies once with nothing in it.
        const gone = info.lamports === 0 || info.data.length < TOKEN_AMOUNT_OFFSET + 8;
        const microUsdc = gone ? 0 : readTokenAmount(new Uint8Array(info.data));
        push((cur) => ({ ...cur, microUsdc, hasUsdcAccount: !gone }));
      },
      { commitment: "confirmed" },
    ),
    conn.onAccountChange(
      publicKey,
      (info) => push((cur) => ({ ...cur, lamports: info.lamports })),
      { commitment: "confirmed" },
    ),
  ];
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
    // Retried through network weather, because everything downstream treats
    // "no data" as an answer eventually. One swallowed failure here used to
    // leave the balances unknown for the whole visit, and the onboarding
    // gate would then open to accuse a funded wallet of holding nothing.
    for (let attempt = 0; attempt < 4; attempt++) {
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

        const fresh: PlayerState = info
          ? {
              exists: true,
              ...(() => {
                const p = decodePlayer(new Uint8Array(info.data));
                return { chips: p.chips, handsPlayed: p.handsPlayed };
              })(),
              microUsdc,
              hasUsdcAccount,
              lamports,
            }
          : {
              exists: false,
              chips: 0,
              handsPlayed: 0,
              microUsdc,
              hasUsdcAccount,
              lamports,
            };
        setState(fresh);
        writeBalanceCache(publicKey.toBase58(), fresh);
        return;
      } catch {
        // A failed read is not "no account". Wait out the weather and try
        // again; state stays as it was in the meantime.
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }, [publicKey]);

  // Warm start: whatever this wallet last held, up before the first read even
  // begins, so nothing downstream has to sit in an "unknown" state.
  useEffect(() => {
    if (!publicKey) {
      setState(null);
      return;
    }
    const cached = readBalanceCache(publicKey.toBase58());
    if (cached) setState((cur) => cur ?? cached);
  }, [publicKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Register with the shared subscriptions above. Pushes are ignored until
  // this hook's own first read has landed, so there is always a whole state
  // to patch; the last hook out tears the subscriptions down.
  useEffect(() => {
    if (!publicKey) return;
    const apply = (patch: PlayerPatch) => setState((cur) => (cur ? patch(cur) : cur));
    patchListeners.add(apply);
    ensureBalanceSubscriptions(publicKey);
    return () => {
      patchListeners.delete(apply);
      if (patchListeners.size === 0) teardownBalanceSubscriptions();
    };
  }, [publicKey]);

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
      ? "Add a little SOL to this wallet. Solana charges network fees in SOL, not USDC."
      : state.microUsdc === 0
        ? "This wallet has no USDC yet. Send some here, then buy chips."
        : null;

  const sellBlocked: string | null =
    state && !gasOk
      ? "Add a little SOL to this wallet to cover the network fee."
      : null;

  return { state, refresh, buy, sell, busy, affordable, gasOk, buyBlocked, sellBlocked };
}
