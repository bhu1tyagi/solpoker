"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { nameMessage } from "@/lib/profile-name";

/**
 * One player's record, and the way they change their name.
 *
 * The figures are optional in the same way every other stored figure in this
 * app is: no database, an unreachable route, a wallet that has never played,
 * and the hook settles on nulls with `stored` false. A null is never rendered
 * as a zero, and the profit figures carry their own count so the page can say
 * how many hands they actually cover.
 */

/** One day the wallet played, with every figure cumulative to that day. */
export interface SeriesPoint {
  /** Epoch millis, midnight UTC. */
  at: number;
  /** Null until a day whose hands carry contributions; profit needs both halves. */
  net: number | null;
  won: number;
  lost: number;
  rake: number;
  hands: number;
  handsWon: number;
  showdowns: number;
}

export interface Profile {
  wallet: string;
  displayName: string | null;
  stored: boolean;
  handsPlayed: number | null;
  handsWon: number | null;
  showdowns: number | null;
  tablesPlayed: number | null;
  firstHandAt: number | null;
  lastHandAt: number | null;
  wonChips: number | null;
  rakeChips: number | null;
  biggestPotChips: number | null;
  netChips: number | null;
  profitHands: number | null;
  wonAmountChips: number | null;
  lostAmountChips: number | null;
  biggestWinChips: number | null;
  biggestLossChips: number | null;
  series: SeriesPoint[];
}

export type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

/**
 * Claim a name. Resolves to an error worth showing, or null when it worked —
 * and also null when the player simply declined the signature, which is a
 * choice rather than a failure and needs no message.
 */
export type Rename = (
  pubkey: PublicKey,
  signMessage: SignMessage | undefined,
  name: string,
) => Promise<string | null>;

export function useProfile(wallet: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);

  const pull = useCallback(async () => {
    if (!wallet) {
      setProfile(null);
      setLoaded(true);
      return;
    }
    try {
      // no-store on the client too: a refresh straight after a rename must
      // not be answered from the browser's copy of the previous name.
      const res = await fetch(`/api/profile?wallet=${encodeURIComponent(wallet)}`, {
        cache: "no-store",
      });
      if (res.ok) setProfile((await res.json()) as Profile);
    } catch {
      // The page has an honest empty state for exactly this.
    } finally {
      setLoaded(true);
    }
  }, [wallet]);

  useEffect(() => {
    setLoaded(false);
    void pull();
  }, [pull]);

  /**
   * Claim a name.
   *
   * The wallet signs the exact text the server will rebuild, so what the
   * player approves in their wallet is what the server checks — no session is
   * created and nothing else becomes possible as a result of signing it.
   *
   * Returns an error string rather than throwing: renaming yourself is not an
   * exceptional event, and every failure here has something specific worth
   * telling the player.
   */
  const rename = useCallback(
    async (
      pubkey: PublicKey,
      signMessage: SignMessage | undefined,
      name: string,
    ): Promise<string | null> => {
      if (!signMessage) {
        return "This wallet cannot sign messages, so it cannot set a name.";
      }
      const issuedAt = Date.now();
      const message = nameMessage(pubkey.toBase58(), name.trim(), issuedAt);
      let signature: string;
      try {
        signature = bs58.encode(
          await signMessage(new TextEncoder().encode(message)),
        );
      } catch {
        // Declining the signature is a normal thing to do, not a failure.
        return null;
      }
      try {
        const res = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            wallet: pubkey.toBase58(),
            name: name.trim(),
            issuedAt,
            signature,
          }),
        });
        const body = await res.json();
        if (!res.ok) return String(body.error ?? "That name could not be saved.");
        setProfile((p) => (p ? { ...p, displayName: body.displayName } : p));
        return null;
      } catch {
        return "The network dropped that. Try again.";
      }
    },
    [],
  );

  return { profile, loaded, refresh: pull, rename };
}
