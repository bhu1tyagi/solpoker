"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/primitives/Button";
import { Wordmark } from "@/components/primitives/Logo";
import { shortKey } from "@/components/primitives/Avatar";
import { useUiStore } from "@/stores/ui-store";

/**
 * The marketing header.
 *
 * Deliberately separate from TopBar, which is the in-room chrome: TopBar
 * carries the balance, the stack and cash-out, none of which belong on a page
 * a stranger is reading. Merging them would produce a component that is half
 * wallet state and half nav, and every change to either half would risk the
 * other.
 *
 * NAV RULE: only routes that resolve. Tournaments is listed because the route
 * now exists as an honest placeholder page; High Stakes still is not, and a
 * nav link to a 404 costs more trust than an absent link does.
 */

const NAV = [
  { href: "/lobby", label: "Lobby" },
  // { href: "/tournaments", label: "Tournaments" },  hidden until it runs
  { href: "/rewards", label: "Rewards" },
  { href: "/profile", label: "Profile" },
  { href: "/trust", label: "How it works" },
] as const;

/**
 * The connected-wallet pill. Lives in the top right of every marketing page,
 * so wallet state is never a mystery: green dot, short address, and a small
 * menu with the two things a player actually does with it here.
 *
 * Mount-guarded because the adapter knows nothing on the server; rendering
 * the CTA first and swapping after hydration would flash, so until mounted
 * the slot renders the CTA that both states share a footprint with.
 */
function WalletSlot() {
  const { connected, publicKey, disconnect } = useWallet();
  const toast = useUiStore((s) => s.toast);
  const openGate = useUiStore((s) => s.openGate);
  const [mounted, setMounted] = useState(false);
  const [menu, setMenu] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !connected || !publicKey) {
    return (
      // The gate at /lobby is the wallet picker, and openGate un-dismisses
      // it. Without the click, a player who had closed the gate to look
      // around pressed this button, the router "navigated" to the page they
      // were already on, and nothing visibly happened — a connect button
      // that appeared to be broken.
      <Button
        href="/lobby"
        variant="gradient"
        size="lg"
        className="site-cta-link"
        onClick={openGate}
      >
        Connect wallet
      </Button>
    );
  }

  const address = publicKey.toBase58();
  return (
    <div className="wallet-pill-wrap">
      <button
        type="button"
        className="wallet-pill"
        aria-expanded={menu}
        aria-haspopup="menu"
        onClick={() => setMenu((v) => !v)}
      >
        <span className="wallet-pill-dot" aria-hidden />
        <span className="chain">{shortKey(address)}</span>
      </button>
      {menu && (
        <div className="wallet-menu glass" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(address).then(
                () => toast("Address copied", "good"),
                () => toast("Could not reach the clipboard", "bad"),
              );
              setMenu(false);
            }}
          >
            Copy address
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Which nav item the current URL belongs to.
 *
 * Prefix matching, not equality: /table/9 is reached from the lobby, and a bar
 * that goes blank the moment you are actually somewhere is a bar that only
 * ever highlights four of the product's pages. `/` is excluded from the prefix
 * rule for the obvious reason.
 */
function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Solid until the page moves, so the hero's top edge is not cut by a
  // hairline sitting on nothing.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A menu that stays open behind a resize into the desktop layout leaves the
  // page scroll-locked with no visible way back.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const close = () => setOpen(false);
    mq.addEventListener("change", close);
    document.body.style.overflow = "hidden";
    return () => {
      mq.removeEventListener("change", close);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header
        className={scrolled ? "site-header glass-blur is-scrolled" : "site-header"}
      >
        <div className="site-header-inner">
          {/* The lockup, whole: the raccoon and the script are one drawing and
              are never split apart or re-set in type. */}
          <Link href="/" aria-label="Pokerable home" className="site-brand">
            <Wordmark size={44} />
          </Link>

          {/*
            The current page is marked, not merely coloured: `aria-current`
            is what a screen reader announces, and the underline beneath the
            label is the second cue a colour change cannot carry on its own.
          */}
          <nav className="site-nav" aria-label="Main">
            {NAV.map((item) => {
              const here = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={here ? "site-nav-link is-current" : "site-nav-link"}
                  aria-current={here ? "page" : undefined}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="site-header-actions">
            <Link href="/trust" className="site-nav-link site-nav-support">
              Support
            </Link>
            {/*
              "Connect wallet", not "Login". Nothing is being logged into —
              the product is non-custodial and the word would set the wrong
              expectation before the player has met the session key. Once
              connected, this slot becomes the wallet pill instead.
            */}
            <WalletSlot />

            <button
              type="button"
              className="site-menu-toggle"
              aria-expanded={open}
              aria-controls="site-mobile-nav"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
            >
              <span className={open ? "burger is-open" : "burger"} aria-hidden>
                <i />
                <i />
              </span>
            </button>
          </div>
        </div>
      </header>

      {/*
        A sheet, not the draft's floating glass pill. That pill is in-app
        chrome for a player mid-session; on a page someone is reading for the
        first time it competes with the CTA it is sitting on top of.
      */}
      {open && (
        <div className="site-sheet-scrim" onClick={() => setOpen(false)}>
          <nav
            id="site-mobile-nav"
            className="site-sheet glass glass-blur"
            aria-label="Main"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV.map((item) => {
              const here = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={here ? "site-sheet-link is-current" : "site-sheet-link"}
                  aria-current={here ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              );
            })}
            <Button
              href="/lobby"
              variant="gradient"
              size="lg"
              fullWidth
              onClick={() => {
                setOpen(false);
                // Same as the desktop CTA: the gate is the wallet picker,
                // and it must reopen even if it was dismissed earlier.
                useUiStore.getState().openGate();
              }}
            >
              Connect wallet
            </Button>
          </nav>
        </div>
      )}
    </>
  );
}
