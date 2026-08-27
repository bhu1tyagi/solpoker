import type { Metadata } from "next";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Orbs } from "@/components/chrome/Orbs";
import { Button } from "@/components/primitives/Button";
import { HeroArtifacts } from "@/components/landing/HeroArtifacts";
import { HeroCta } from "@/components/landing/HeroCta";
import { BuiltOnRow } from "@/components/landing/BuiltOnRow";
import {
  ArrowRightIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  UsersIcon,
  ZapIcon,
} from "@/components/primitives/Icons";

/**
 * The landing page.
 *
 * A server component on purpose: nothing here needs a wallet, so a stranger
 * gets HTML on first paint and the wallet adapter never loads. The readiness
 * gate lives at /lobby, where it is actually true.
 *
 * On the copy — several claims in the Superdesign draft could not ship as
 * written, and the replacements are not softenings, they are corrections:
 *
 *   "the first provably fair poker platform"  -> banned phrasing; the honest
 *       claim is a provably fair SHUFFLE plus TEE-protected hole cards, which
 *       is what docs/TRUST_MODEL.md actually supports.
 *   "zero rake"                               -> false. There is a rake, and
 *       it is documented. Claiming otherwise on the page a player reads before
 *       depositing is the kind of thing that ends a product.
 *   "4,281 players currently at the tables"   -> invented. No fabricated
 *       liveness on a real-money product, so the figure is simply absent until
 *       it can be read from chain.
 *   "$50,000 SOL main event"                  -> no such event.
 *   "Deposit SOL"                             -> chips are USDC; SOL is the
 *       fee asset. Conflating them is the single most expensive confusion in
 *       this product's onboarding.
 */

export const metadata: Metadata = {
  title: "Pokerable, poker on Solana",
  description:
    "Six-max Texas Hold'em on Solana. Chips are USDC, the shuffle is verifiable after the hand, and your hole cards are sealed in a hardware enclave.",
};

const FEATURES = [
  {
    Icon: ZapIcon,
    title: "Settles as you leave",
    body: "No withdrawal request, no processing window. Cash out and the chips move to your wallet in the same transaction.",
  },
  {
    Icon: ShieldCheckIcon,
    title: "Verifiable shuffle",
    body: "Every shuffle is a VRF draw combined with player salts, and you can check it after the hand. Hole cards are sealed in a hardware enclave.",
  },
  {
    Icon: UsersIcon,
    title: "Six-max, no accounts",
    body: "No email, no KYC, no password. A wallet is the account, and the table is running the moment two players sit.",
  },
] as const;


export default function Landing() {
  return (
    <>
      <SiteHeader />

      <main id="main" className="landing">
        <Orbs />

        <div className="landing-inner">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1 className="hero-title">
              The deck is
              <br />
              <span className="gradient-text">on-chain.</span>
            </h1>

            <p className="hero-sub">
              Six-max Texas Hold&rsquo;em on Solana. Chips are USDC, the shuffle
              is verifiable after the hand, and your hole cards are sealed in a
              hardware enclave, unreadable by other players and by anyone
              reading Solana state.
            </p>

            <div className="hero-actions">
              <HeroCta />
              <Button href="/trust" variant="ghost" size="xl">
                <PlayCircleIcon size={18} />
                How it works
              </Button>
            </div>
          </div>

          <HeroArtifacts />
        </section>

        {/*
          The stack this actually runs on, as marks rather than a claim. The
          draft's Ledger and Chainlink logos stay out: neither is in the stack,
          and a logo here reads as an endorsement.
        */}
        <section className="landing-built" aria-label="Built on">
          <p className="label">Built on</p>
          <BuiltOnRow />
        </section>

        <section className="landing-features" aria-label="What this is">
          {FEATURES.map(({ Icon, title, body }) => (
            <article key={title} className="feature-card glass glow-hover">
              <span className="feature-icon" aria-hidden>
                <Icon size={26} />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </section>

        </div>
      </main>

      <SiteFooter />
    </>
  );
}
