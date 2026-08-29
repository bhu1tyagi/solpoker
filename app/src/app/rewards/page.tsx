import type { Metadata } from "next";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { LobbyGate } from "@/components/onboarding/LobbyGate";
import { Orbs } from "@/components/chrome/Orbs";
import { RewardsClient } from "./rewards-client";

/**
 * Rewards. The shell is a server component like the rest of the marketing
 * routes; everything that depends on a wallet or on figures that change lives
 * in the client child, so a stranger reading this page still gets it rendered
 * on the server.
 */

export const metadata: Metadata = {
  title: "Rewards, Pokerable",
  description:
    "What you have won, what you have paid in rake, and how the player pool " +
    "shares 20% of rake back to the players who generated it.",
};

export default function Rewards() {
  return (
    <>
      <SiteHeader />
      {/* Asked-for only. Most of this page is public record and reads fine
          without a wallet — the boards, the pool, the terms — and share cards
          bring strangers straight here to look at it. Opening the gate
          unprompted would hold them at the door of a room they came to read.
          The connect button in the panel calls openGate() when they want it. */}
      <LobbyGate onlyWhenAsked />

      <main id="main" className="landing">
        <Orbs />
        <div className="landing-inner">
          <header className="rewards-hero">
            <h1 className="hero-title">Rewards</h1>
            <p>
              Poker pays the house a rake on every pot that sees a flop. A fifth
              of it comes back to the people who paid it.
            </p>
          </header>

          <RewardsClient />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
