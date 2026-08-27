import type { Metadata } from "next";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { LobbyGate } from "@/components/onboarding/LobbyGate";
import { Orbs } from "@/components/chrome/Orbs";
import { Button } from "@/components/primitives/Button";

/**
 * Tournaments. The route exists so the nav can point somewhere real; the
 * product does not run tournaments yet and this page says so instead of
 * dressing the gap up as a feature. No fake schedule, no counterfeit bracket,
 * no "coming soon" countdown to a date nobody has committed to.
 */

export const metadata: Metadata = {
  title: "Tournaments, Pokerable",
  description:
    "Scheduled tournaments are not running yet. The cash tables are open.",
};

export default function Tournaments() {
  return (
    <>
      <SiteHeader />
      <LobbyGate />

      <main id="main" className="landing">
        <Orbs />
        <div className="landing-inner">
          <section className="landing-steps" aria-labelledby="tournaments-head">
            <div className="landing-steps-head">
              <h1 id="tournaments-head" className="hero-title">
                Tournaments
              </h1>
              <p>
                Not running yet. Scheduled games are next on the roadmap.
                Until then, the cash tables are open and a seat takes about a
                minute.
              </p>
            </div>
            <Button href="/lobby" variant="gradient" size="lg">
              Go to the tables
            </Button>
          </section>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
