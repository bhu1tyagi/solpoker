"use client";

import Link from "next/link";
import { Wordmark } from "@/components/primitives/Logo";
import { DiscordIcon, XIcon } from "@/components/primitives/Icons";

/**
 * The marketing footer.
 *
 * ONE RULE, applied throughout: every link resolves.
 *
 * The Superdesign draft's Resources column lists Whitepaper, Security audit,
 * API docs and Mobile app. Three of those do not exist and the fourth is not
 * written. A footer link to a 404 is worse than an absent link — it reads as a
 * product that has shipped more than it has — so that column became Trust and
 * points at /trust, which is real, and is the strongest page this product has.
 *
 * Anything below marked EXTERNAL is a real destination. Anything that would
 * have been a placeholder was cut instead of stubbed.
 */

const PLATFORM = [
  { href: "/lobby", label: "Game lobby" },
  // { href: "/tournaments", label: "Tournaments" },  hidden until it runs
  { href: "/rewards", label: "Rewards" },
  { href: "/profile", label: "Your profile" },
  { href: "/trust", label: "How it works" },
] as const;

const TRUST = [
  { href: "/trust", label: "Trust model" },
  { href: "/trust#shuffle", label: "Provably fair shuffle" },
  { href: "/trust#rake", label: "Rake" },
] as const;

const SOCIAL = [
  { href: "https://x.com/", label: "X", Icon: XIcon },
  { href: "https://discord.gg/", label: "Discord", Icon: DiscordIcon },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <Link href="/" aria-label="Pokerable home" className="site-brand">
              <Wordmark size={52} />
            </Link>
            <p className="site-footer-blurb">
              Six-max Texas Hold&rsquo;em on Solana. Chips are USDC, the shuffle
              is verifiable after the hand, and your hole cards are sealed in a
              hardware enclave.
            </p>
            <ul className="site-social">
              {SOCIAL.map(({ href, label, Icon }) => (
                <li key={label}>
                  <a
                    href={href}
                    aria-label={label}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="site-social-link"
                  >
                    <Icon size={18} />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <nav className="site-footer-col" aria-label="Platform">
            <h3 className="site-footer-head">Platform</h3>
            <ul>
              {PLATFORM.map((l) => (
                <li key={l.label}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="site-footer-col" aria-label="Trust">
            <h3 className="site-footer-head">Trust</h3>
            <ul>
              {TRUST.map((l) => (
                <li key={l.label}>
                  <Link href={l.href}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          {/*
            No newsletter column: an input that silently discards an address is
            worse than no input. It goes in when there is an endpoint behind it.
            No status column either, since the cluster note it carried is gone.
          */}
        </div>

        <div className="site-footer-base">
          <p className="site-footer-copy">&copy; 2026 Pokerable</p>
          {/*
            Terms, privacy and risk disclosure belong here, and they are
            deliberately absent rather than pointing at stubs, so the gap
            stays visible in every review of this file.
          */}
        </div>
      </div>
    </footer>
  );
}
