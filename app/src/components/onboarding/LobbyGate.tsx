"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { motion, useReducedMotion } from "motion/react";
import { usePlayer } from "@/hooks/use-player";
import { useUiStore } from "@/stores/ui-store";
import { READINESS_STEPS, useReadiness } from "@/hooks/use-readiness";
import { shortKey } from "@/components/primitives/Avatar";
import { ChipSpinner } from "@/components/primitives/ChipRing";
import { ChipGlyph } from "@/components/primitives/Chip";
import { Skeleton } from "@/components/primitives/Surface";
import { CheckIcon, CopyIcon, UsdcMark } from "@/components/primitives/Icons";
import { SolanaMark } from "@/components/primitives/StackCredit";
import { Button } from "@/components/primitives/Button";
import {
  ONBOARD_FLOOR_MICRO_USDC,
  PLAY_FLOOR_LAMPORTS,
} from "@/lib/constants";
import { formatSol, microUsdcToChips } from "@/lib/money";

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
 *   4. Buy chips         — a seat is taken with chips, not with a balance.
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

const fmtUsdc = (micro: number) => `$${(micro / 1e6).toFixed(2)}`;

export function LobbyGate({
  onlyWhenAsked = false,
  lockWhenSignedOut = false,
}: { onlyWhenAsked?: boolean; lockWhenSignedOut?: boolean } = {}) {
  const reduce = useReducedMotion();
  const toast = useUiStore((s) => s.toast);
  const forced = useUiStore((s) => s.gateOpen);
  const dismissed = useUiStore((s) => s.gateDismissed);
  const dismissGate = useUiStore((s) => s.dismissGate);
  const { wallets, select, connecting, connected, wallet, publicKey } =
    useWallet();
  const { refresh, buy, busy, buyBlocked } = usePlayer();

  const [mounted, setMounted] = useState(false);
  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Nothing is decided before the client is running: the wallet adapter knows
  // nothing on the server, so a server render would show step one to a player
  // who is already connected.
  useEffect(() => setMounted(true), []);

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

  const { active, done, resolving, lamports, microUsdc, chips } = useReadiness();

  /*
   * Shown while a step is unmet AND the player has not waved it away — or
   * whenever something asks for it back, which is what trying to sit down
   * does. Dismissing is deliberately cheap: a stranger should be able to look
   * around a poker room without being held at the door. What they cannot do
   * is take a seat, and that is enforced where the seat is, not here.
   *
   * `onlyWhenAsked` drops the first half entirely, for the table page. The
   * lobby is where somebody arrives to get set up, so opening unprompted there
   * is doing them a favour; a table reached from a shared link is somewhere
   * they arrived to watch a game, and greeting them with a form is the same
   * mistake the old refusal page made, in a smaller box.
   */
  /*
   * A wallet that vanishes from under a table is not something to look past.
   *
   * Everywhere else the gate is a doorman and dismissing it is deliberately
   * cheap — a stranger should be able to walk around a poker room. A table is
   * different: the player may have chips on a seat and a hand in progress, and
   * every verb on the screen needs a signature they no longer have. Browsing
   * that is not exploring, it is watching a game they cannot act in while
   * their money sits on the felt.
   *
   * So on the table page a disconnect locks the gate open: no scrim click, no
   * Escape, no way past it but connecting. It unlocks the moment a wallet is
   * back.
   */
  const locked = lockWhenSignedOut && mounted && !connected;
  const wanted = locked || (onlyWhenAsked ? forced : forced || !dismissed);
  /*
   * Somebody asked for the gate and the balances have not landed yet.
   *
   * This is not a second modal. Opening the full gate here would accuse a
   * player of steps the data cannot yet confirm, so the gate opens with its
   * rail drawn as skeletons instead: the same card, the same place, with the
   * parts it does not know yet visibly still loading. It used to be its own
   * "One moment" dialog, which meant a player walking between pages got a
   * card thrown at them every time — and with balances now remembered per
   * wallet, this state is close to unreachable anyway.
   */
  const pending = mounted && wanted && resolving;
  const open = pending || (mounted && !resolving && active !== -1 && wanted);

  /*
   * A satisfied player must not leave the flag armed behind them.
   *
   * `openGate` was only ever cleared by dismissing, so once anything opened
   * it — a seat click, the connect button — it stayed true for the rest of
   * the visit. Every later page whose balances were briefly unknown then saw
   * a gate asking to open again, which is exactly the card that kept
   * reappearing. Nothing needed, nothing armed.
   */
  useEffect(() => {
    if (!locked && !resolving && active === -1 && forced) dismissGate();
  }, [locked, resolving, active, forced, dismissGate]);

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

  // Escape closes it, like any other dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) dismissGate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, dismissGate]);

  if (!open) return null;

  const installed = wallets.filter(
    (w) =>
      w.readyState === WalletReadyState.Installed ||
      w.readyState === WalletReadyState.Loadable,
  );

  return (
    // Clicking the ground behind it closes it. The gate is a doorman, not a
    // lock: looking around costs nothing, and the refusal that matters
    // happens at the table.
    <div className="gate-scrim" onClick={locked ? undefined : dismissGate}>
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        tabIndex={-1}
        className="gate glass glass-blur"
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="gate-head">
          <h2 id="gate-title">Take a seat</h2>
          <p>
            {locked
              ? "Your wallet disconnected. Reconnect it to keep playing — your chips are safe on the table."
              : pending
                ? "Checking where you are up to."
                : "One thing at a time. This is the only step in your way."}
          </p>
        </header>

        <div className="gate-body">
          <ol className="gate-rail" aria-label="Progress">
            {/* Still reading: the rail shows its shape without claiming which
                step anyone is on. Accusing a funded wallet of holding nothing
                is the exact malfunction this replaced. */}
            {pending
              ? READINESS_STEPS.map((s) => (
                  <li key={s.title} className="gate-step is-loading">
                    <span className="gate-node" aria-hidden>
                      <ChipSpinner size={15} thickness={2} color="currentColor" />
                    </span>
                    <span className="gate-step-text">
                      <Skeleton height={11} width="52%" />
                      <Skeleton height={9} width="76%" />
                    </span>
                  </li>
                ))
              : READINESS_STEPS.map((s, i) => (
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
            {/* While the balances are still landing, the panel says nothing
                about which step is next — the rail beside it is already
                showing that it does not know yet. */}
            {pending && (
              <>
                <Skeleton height={15} width="46%" />
                <div style={{ height: 10 }} />
                <Skeleton height={11} width="82%" />
                <div style={{ height: 18 }} />
                <Skeleton height={40} />
              </>
            )}
            {!pending && active === 0 && (
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

            {!pending && active === 1 && (
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

            {!pending && active === 2 && (
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

            {/*
              The last step, and the only one that is a button rather than a
              wait. Holding USDC and holding chips are different states, and a
              player stuck between them used to be told to go and fetch USDC
              they already had.
            */}
            {!pending && active === 3 && (
              <div className="gate-buy">
                <span className="gate-buy-mark" aria-hidden>
                  <ChipGlyph size={36} />
                </span>
                <h3>Turn USDC into chips</h3>
                <p className="gate-note">
                  A cent a chip, and the same rate back out. You hold{" "}
                  <span className="num">{fmtUsdc(microUsdc)}</span>, enough for{" "}
                  <span className="num">
                    {microUsdcToChips(microUsdc).toLocaleString()}
                  </span>{" "}
                  chips.
                </p>
                <Button
                  variant="gradient"
                  size="lg"
                  loading={busy === "buy"}
                  disabled={buyBlocked !== null}
                  onClick={() => void buy(microUsdcToChips(microUsdc))}
                >
                  Buy {microUsdcToChips(microUsdc).toLocaleString()} chips
                </Button>
                {buyBlocked && (
                  <p className="gate-warn" role="status">
                    {buyBlocked}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* An offer to leave, only where leaving is possible. Locked, this
            read as a way out that quietly did nothing when pressed. */}
        {!locked && (
          <footer className="gate-foot">
            <button type="button" className="gate-skip" onClick={dismissGate}>
              Close and look around
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
