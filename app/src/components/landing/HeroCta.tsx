"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/primitives/Button";
import { ArrowRightIcon } from "@/components/primitives/Icons";
import { useUiStore } from "@/stores/ui-store";

/**
 * The hero's primary CTA, aware of wallet state.
 *
 * A stranger sees "Connect wallet"; a returning player with a session sees
 * "Go to the lobby", because telling someone to connect a wallet that is
 * already connected reads as a page that does not know them. Both go to the
 * same place: the gate at /lobby decides what, if anything, still stands in
 * the way.
 *
 * Mount-guarded so the server render and the first client paint agree; the
 * label can only change after hydration, when the adapter actually knows.
 */
export function HeroCta() {
  const { connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ready = mounted && connected;
  return (
    // "Connect wallet" must land with the gate open — it is the wallet
    // picker — even for someone who dismissed it on an earlier visit. A
    // connected player is just going to the room, and the gate can stay
    // however they left it.
    <Button
      href="/lobby"
      variant="gradient"
      size="xl"
      onClick={ready ? undefined : () => useUiStore.getState().openGate()}
    >
      {ready ? "Go to the lobby" : "Connect wallet"}
      <ArrowRightIcon size={18} />
    </Button>
  );
}
