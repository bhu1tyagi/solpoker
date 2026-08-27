"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { motion, useReducedMotion } from "motion/react";
import { usePlayer } from "@/hooks/use-player";
import { useUiStore } from "@/stores/ui-store";
import { shortKey } from "@/components/primitives/Avatar";
import { ChipSpinner } from "@/components/primitives/ChipRing";
import { CheckIcon, CopyIcon, UsdcMark } from "@/components/primitives/Icons";
import { SolanaMark } from "@/components/primitives/StackCredit";
import { Button } from "@/components/primitives/Button";
import {
  ONBOARD_FLOOR_MICRO_USDC,
  PLAY_FLOOR_LAMPORTS,
} from "@/lib/constants";
import { formatSol } from "@/lib/money";

/**
 * The readiness gate, straight off the ladder in the design system's
 * ONBOARDING reference: a rail on the left showing where the player is in
 * the journey, ONE gate on the right showing only the step that currently
 * blocks them. Never a checklist of failures.
 *
 * Three steps, evaluated strictly in order:
 *
 *   1. Connect wallet    — the only HARD gate. Nobody enters without it.
 *   2. Network fees      — a little SOL. PLAY_FLOOR_LAMPORTS is the floor.
 *   3. Gaming capital    — USDC for chips. $4 is the smallest buy-in.
 *
 * Steps 2 and 3 are skippable ("look around first"), because a connected
 * player browsing an empty balance harms nobody, and imprisoning them in a
 * modal until they wire money reads as exactly the kind of pressure this
 * product refuses to apply. The skip is remembered for the session.
 *
 * The rail nodes: checkmark = done, chip spinner = the active step (it is
 * always genuinely waiting — for an approval or for a deposit to land),
 * dim number = not yet. The spinner is the chip ring because this product
 * has no generic spinners.
 *
 * While a funding step is active the wallet balances are polled every few
 * seconds, so a deposit made on a phone or an exchange shows up here
 * without a refresh. That is what makes "this screen will notice" true.
 */

const POLL_MS = 4000;
/** How long the gate will wait for the wallet and balances before committing. */
const RESOLVE_CAP_MS = 5000;
const SKIP_KEY = "pk-gate-skip";

const STEPS = [
  { title: "Connect wallet", short: "Phantom, Solflare, or any Solana wallet" },
  { title: "Network fees", short: "a little SOL covers a session" },
  { title: "Gaming capital", short: "USDC for chips, tables from $4" },
] as const;

const fmtUsdc = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

export function LobbyGate() {
  const reduce = useReducedMotion();
  const toast = useUiStore((s) => s.toast);
  const { wallets, select, connecting, connected, wallet, publicKey } =
    useWallet();
  const { state, refresh } = usePlayer();

  const [mounted, setMounted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  /*
   * Whether an autoConnect is coming.
   *
   * WalletProvider records the chosen wallet under this key and reconnects to
   * it on the next load. Reading it directly is what tells us, on the FIRST
   * render, that "not connected" means "not connected YET" — the adapter
   * cannot tell us that itself, because the reconnect is asynchronous and
   * everything looks disconnected while it runs.
   *
   * Without this the gate flashed "Connect a wallet" at returning players for
   * a second before deciding they were already connected.
   */
  const [expectAuto, setExpectAuto] = useState(false);

  /*
   * A hard cap on waiting. A locked wallet never finishes connecting and an
   * unreachable RPC never returns balances; either would otherwise hold the
   * gate closed forever behind an empty page. After this the gate commits to
   * whatever is actually known.
   */
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setMounted(true);
    setSkipped(sessionStorage.getItem(SKIP_KEY) === "1");
    try {
      setExpectAuto(!!localStorage.getItem("walletName"));
    } catch {
      // Storage blocked. Fall through to showing the gate promptly.
    }
    const t = setTimeout(() => setSettled(true), RESOLVE_CAP_MS);
    return () => clearTimeout(t);
  }, []);

  // Selection IS the connect request. The provider runs with autoConnect,
  // and its own machinery connects the newly selected adapter after it has
  // re-subscribed to that adapter's events. Calling connect() from here was
  // tried first and lost a race: the adapter's "connect" event could fire
  // before the provider was listening, connect() would resolve, and the
  // context would sit disconnected forever. The stock modal works because it
  // only selects; so does this.
  //
  // A decline never rejects anything we can catch, so it is inferred: the
  // connecting flag falling with no connection while a request is pending.
  const wasConnecting = useRef(false);
  useEffect(() => {
    if (connecting) {
      wasConnecting.current = true;
      setDeclined(false);
      return;
    }
    if (wasConnecting.current && !connected && pendingWallet) {
      setDeclined(true);
      setPendingWallet(null);
    }
    wasConnecting.current = false;
  }, [connecting, connected, pendingWallet]);

  const lamports = state?.lamports ?? 0;
  const microUsdc = state?.microUsdc ?? 0;
  const solOk = lamports >= PLAY_FLOOR_LAMPORTS;
  const usdcOk = microUsdc >= ONBOARD_FLOOR_MICRO_USDC;

  const done = [connected, connected && solOk, connected && usdcOk];
  const active = done.indexOf(false);

  /*
   * Decide nothing until the answer is actually knowable.
   *
   * Three things can still be in flight on first paint, and each one would
   * make the gate accuse a perfectly ready player of a step they have done:
   *
   *   connecting              the wallet is mid-handshake
   *   expectAuto && !connected  a stored wallet is about to reconnect
   *   connected && !state     balances have not been read yet, so "no SOL"
   *                           is an absence of data, not a shortfall
   *
   * Past the cap, whatever is known wins, so nothing can hang.
   */
  const resolving =
    !settled &&
    (!mounted ||
      connecting ||
      (expectAuto && !connected) ||
      (connected && state === null));

  const open = mounted && !resolving && active !== -1 && !(connected && skipped);

  // Deposits land from outside this tab; poll while a funding step shows.
  useEffect(() => {
    if (!open || !connected) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [open, connected, refresh]);

  // The page behind the gate must not scroll under it.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Focus moves into the dialog when it opens.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open, active]);

  const skip = useCallback(() => {
    sessionStorage.setItem(SKIP_KEY, "1");
    setSkipped(true);
  }, []);

  if (!open) return null;

  const installed = wallets.filter(
    (w) =>
      w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable,
  );

  return (
    <div className="gate-scrim">
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        tabIndex={-1}
        className="gate glass glass-blur"
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="gate-head">
          <h2 id="gate-title">Take a seat</h2>
          <p>One thing at a time. This is the only step in your way.</p>
        </header>

        <div className="gate-body">
          <ol className="gate-rail" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className={
                  done[i]
                    ? "gate-step is-done"
                    : i === active
                      ? "gate-step is-active"
                      : "gate-step"
                }
                aria-current={i === active ? "step" : undefined}
              >
                <span className="gate-node" aria-hidden>
                  {done[i] ? (
                    <CheckIcon size={14} />
                  ) : i === active ? (
                    <ChipSpinner size={15} thickness={2} color="currentColor" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="gate-step-text">
                  <strong>{s.title}</strong>
                  <span>{s.short}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="gate-panel">
            {active === 0 && (
              <>
                <h3>Connect a wallet</h3>
                <p className="gate-note">
                  Connecting is read-only. Nothing moves until you approve it.
                </p>

                {installed.length > 0 ? (
                  <ul className="gate-wallets">
                    {installed.map((w) => {
                      const busy =
                        connecting && wallet?.adapter.name === w.adapter.name;
                      return (
                        <li key={w.adapter.name}>
                          <button
                            type="button"
                            className="gate-wallet"
                            disabled={connecting}
                            onClick={() => {
                              setDeclined(false);
                              setPendingWallet(w.adapter.name);
                              select(w.adapter.name);
                            }}
                          >
                            {/* Wallet icons are data: URIs served by the
                                adapter itself, not remote fetches. */}
                            <img src={w.adapter.icon} alt="" width={26} height={26} />
                            <span>{w.adapter.name}</span>
                            {busy ? (
                              <ChipSpinner size={16} thickness={2} />
                            ) : (
                              <span className="gate-wallet-hint">Detected</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="gate-install">
                    <p>
                      No Solana wallet found in this browser. Install one, come
                      back, and this screen will notice.
                    </p>
                    <div className="gate-install-row">
                      <Button
                        href="https://phantom.com/download"
                        variant="ghost"
                        size="lg"
                      >
                        Get Phantom
                      </Button>
                      <Button
                        href="https://solflare.com/download"
                        variant="ghost"
                        size="lg"
                      >
                        Get Solflare
                      </Button>
                    </div>
                  </div>
                )}

                {declined && (
                  <p className="gate-declined" role="status">
                    The connection was declined in the wallet. Approve it there
                    to continue.
                  </p>
                )}
              </>
            )}

            {active === 1 && (
              <FundStep
                mark={<SolanaMark size={30} />}
                title="Add SOL for fees"
                sub="Every table action costs Solana a tiny fee"
                have={(lamports / 1e9).toFixed(3)}
                need={formatSol(PLAY_FLOOR_LAMPORTS)}
                pct={(lamports / PLAY_FLOOR_LAMPORTS) * 100}
                address={publicKey?.toBase58() ?? ""}
                warn={null}
              />
            )}

            {active === 2 && (
              <FundStep
                mark={<UsdcMark size={36} />}
                title="Add USDC for chips"
                sub={`1 chip = 1 cent. Tables from ${fmtUsdc(ONBOARD_FLOOR_MICRO_USDC)}`}
                have={fmtUsdc(microUsdc)}
                need={fmtUsdc(ONBOARD_FLOOR_MICRO_USDC)}
                pct={(microUsdc / ONBOARD_FLOOR_MICRO_USDC) * 100}
                address={publicKey?.toBase58() ?? ""}
                warn="USDC on Solana only. Other networks will not arrive."
              />
            )}
          </div>
        </div>

        {connected && (
          <footer className="gate-foot">
            <button type="button" className="gate-skip" onClick={skip}>
              Skip for now, I just want to look around
            </button>
          </footer>
        )}
      </motion.div>
    </div>
  );
}

/**
 * A funding step as a PROCESS, not a paragraph: what to send, where to send
 * it, how far along it is, and proof the screen is watching.
 *
 *   token mark + one-line job        (what)
 *   QR code + copyable address       (where — scan from a phone or exchange
 *                                     app, or copy on desktop)
 *   big have-of-need + gradient bar  (how far)
 *   chip-ring "watching" row         (the 4s balance poll, made visible;
 *                                     the deposit arriving IS the next click)
 *
 * The QR is dark-on-light on a card-face white tile: scanners want a light
 * ground, and light objects on the felt is already this product's language.
 */
function FundStep({
  mark,
  title,
  sub,
  have,
  need,
  pct,
  address,
  warn,
}: {
  mark: React.ReactNode;
  title: string;
  sub: string;
  have: string;
  need: string;
  pct: number;
  address: string;
  warn: string | null;
}) {
  const toast = useUiStore((st) => st.toast);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1800);
      },
      () => toast("Could not reach the clipboard", "bad"),
    );
  }, [address, toast]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!address) return;
    let dead = false;
    // The raw base58 address, not a payment URI: exchange scanners and
    // wallet apps all read a bare address, and a solana: URI is exactly the
    // kind of cleverness that fails inside an exchange's withdraw screen.
    void import("qrcode").then((QR) =>
      QR.toDataURL(address, {
        margin: 1,
        width: 240,
        color: { dark: "#0A0A0B", light: "#F5F3EE" },
      }).then((url) => {
        if (!dead) setQr(url);
      }),
    );
    return () => {
      dead = true;
    };
  }, [address]);

  return (
    <div className="gate-fund">
      <div className="gate-fund-head">
        <span className="gate-fund-mark" aria-hidden>
          {mark}
        </span>
        <div>
          <h3>{title}</h3>
          <p className="gate-fund-sub">{sub}</p>
        </div>
      </div>

      <div className="gate-fund-meter">
        <p className="gate-fund-readout">
          <span className="num gate-fund-have">{have}</span>
          <span className="gate-fund-need">of {need}</span>
        </p>
        <div
          className="gate-meter-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(100, pct))}
        >
          <span
            className="solana-gradient"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      <div className="gate-deposit">
        <div className="gate-deposit-row">
        {qr && (
          <span className="gate-qr">
            <img src={qr} alt={`QR code for wallet address ${address}`} />
          </span>
        )}
        <div className="gate-deposit-info">
          <span className="label">Your wallet</span>
          <span className="gate-address-row">
            <span className="chain gate-deposit-key" title={address}>
              {address ? shortKey(address) : ""}
            </span>
            {/*
              The confirmation happens where the eye already is: the copy
              glyph becomes a tick for a moment, then offers itself again. No
              toast for success — feedback two corners away for a one-inch
              action is noise. Failure still gets words, because a tick that
              lies would be worse than either.
            */}
            <button
              type="button"
              className={copied ? "gate-copy-icon is-copied" : "gate-copy-icon"}
              aria-label={copied ? "Copied" : "Copy full address"}
              title={copied ? "Copied" : "Copy address"}
              onClick={copy}
            >
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            </button>
          </span>
          <p className="gate-watching">
            <ChipSpinner size={13} thickness={2} />
            Watching for your deposit
          </p>
        </div>
        </div>
        {warn && <p className="gate-warn">{warn}</p>}
      </div>
    </div>
  );
}
