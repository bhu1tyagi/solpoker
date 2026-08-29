import type { Metadata } from "next";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { LobbyGate } from "@/components/onboarding/LobbyGate";
import { Orbs } from "@/components/chrome/Orbs";
import { ProfileClient } from "./profile-client";

/**
 * Your profile: how you have done, and what you are called.
 *
 * The shell is a server component like the other marketing routes; everything
 * that depends on a wallet lives in the client child.
 */

export const metadata: Metadata = {
  title: "Your profile, Pokerable",
  description:
    "Every hand recorded against your wallet: profit and loss, hands played, " +
    "biggest pot, and the rake you have generated.",
};

export default function Profile() {
  return (
    <>
      <SiteHeader />
      {/* Asked-for only. The page explains itself to a signed-out reader and
          the panel's own button opens the gate when they want it. */}
      <LobbyGate onlyWhenAsked />

      <main id="main" className="landing">
        <Orbs />
        <div className="landing-inner">
          {/*
            The page's own heading, and the reason it is here rather than
            being the player's name: signed out, there IS no name, and the
            page was rendering with no h1 at all. A document whose only
            top-level heading depends on wallet state has no outline for a
            screen reader half the time.
          */}
          {/* Heading only. The figures below say what the page is faster
              than a sentence introducing them could. */}
          <h1 className="hero-title profile-title">Profile</h1>

          <ProfileClient />
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
