"use client";

import { useMemo, useEffect } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { Buffer } from "buffer";
import { BASE_RPC } from "@/lib/constants";
import { ToastViewport } from "@/components/primitives/Toast";
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  // web3.js v1 and anchor both expect Buffer to exist globally.
  useEffect(() => {
    if (typeof window !== "undefined" && !window.Buffer) {
      (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    }
  }, []);

  // Wallet standard discovers installed wallets, so no adapter list is needed.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={BASE_RPC} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
          <ToastViewport />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
