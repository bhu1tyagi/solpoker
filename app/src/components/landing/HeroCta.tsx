"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/primitives/Button";
import { ArrowRightIcon } from "@/components/primitives/Icons";

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
    <Button href="/lobby" variant="gradient" size="xl">
      {ready ? "Go to the lobby" : "Connect wallet"}
      <ArrowRightIcon size={18} />
    </Button>
  );
}
