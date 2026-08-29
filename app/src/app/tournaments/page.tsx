import type { Metadata } from "next";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Orbs } from "@/components/chrome/Orbs";
import { Button } from "@/components/primitives/Button";
import {
  ClockIcon,
  PlayCircleIcon,
  TableIcon,
  TrophyIcon,
  UsdcMark,
} from "@/components/primitives/Icons";

/**
 * Tournaments, before there are any.
 *
 * The route exists so the nav points somewhere real, and this page has one job:
 * say that scheduled play is not running, say what it would be, and say what is
 * still missing — without dressing the gap up as a feature.
 *
 * What that rules out, specifically. No countdown, because no date has been
 * committed to and a clock ticking toward nothing is the pressure copy the
 * design system bans. No sample bracket and no placeholder prize pool, because
 * an invented figure on a real-money product is a misrepresentation rather than
 * a design flourish. No email capture, for the reason the footer has no
 * newsletter column: an input with no endpoint behind it silently discards the
 * address, which is worse than not asking.
 *
 * What is left is the honest version of a coming-soon page — the formats being
 * built, each labelled as planned, and the pieces that have to land first, split
 * into what runs today and what does not exist yet. Both halves are checkable
 * against the repository, which is the only reason the page is worth reading.
 *
 * Server component, like the other marketing routes: nothing here needs a
 * wallet, so a stranger gets HTML on first paint and the adapter never loads.
 * There is no LobbyGate either — holding someone at a wallet picker on a page
 * they can take no action on would be a toll booth in front of a closed road.
 */

export const metadata: Metadata = {
  title: "Tournaments, Pokerable",
  description:
    "Scheduled and sit-and-go tournaments are not running yet. What they will be, what is still missing, and where to play in the meantime.",
};

/**
 * The formats being built. Every one carries the "Planned" tag: on a page whose
 * whole subject is a thing that does not exist, a card that reads like a feature
 * list is the exact confusion to avoid.
 */
const FORMATS = [
  {
    Icon: TableIcon,
    title: "Sit & Go",
    body:
      "Six players, one table, no start time. It deals the moment the last seat fills, which makes it the closest thing to what already runs here, and the reason it comes first.",
  },
  {
    Icon: TrophyIcon,
    title: "Scheduled multi-table",
    body:
      "An announced start time and one seat each. Blinds rise on a clock, tables consolidate as the field busts out, and the last table left is the final one.",
  },
  {
    Icon: UsdcMark,
    title: "Buy-ins in USDC",
    body:
      "Chips are USDC at the cash tables and they would be in a tournament too. The prize pool would sit in a program account, and a payout would settle the way a cash-out does.",
  },
] as const;

/**
 * The build rail. Two states only — running today, or not built — because
 * "in progress" is a status nobody outside the repository can check, and this
 * page is only worth anything if every line on it can be.
 *
 * State is never carried by colour alone: each step names its status in words,
 * and the node is a filled tick or a hollow ring.
 */
const PIECES = [
  {
    done: true,
    title: "Six-max cash tables",
    body: "Hold'em with blinds, side pots and showdown, running on the rollup.",
  },
  {
    done: true,
    title: "A shuffle you can recheck",
    body: "The seed is a VRF draw combined with every player's salt, and the hand history keeps what you need to verify it.",
  },
  {
    done: true,
    title: "Hole cards sealed in the enclave",
    body: "Each card account answers only its own seat. The same protection a tournament would need, already carrying real hands.",
  },
  {
    done: false,
    title: "A blind clock the program enforces",
    body: "Levels that rise on a schedule the chain agrees with, rather than on a server's word for what time it is.",
  },
  {
    done: false,
    title: "Registration and a prize pool held on chain",
    body: "Buy-ins escrowed at sign-up, payouts by finishing position, and nobody holding the pool in between.",
  },
  {
    done: false,
    title: "Table balancing",
    body: "Moving players between tables as the field shrinks, without anyone losing a blind to the reseat.",
  },
] as const;

export default function Tournaments() {
  return (
    <>
      <SiteHeader />

      <main id="main" className="landing">
        <Orbs />
        <div className="landing-inner tourn-page">
          <header className="tourn-hero">
            {/*
              A hollow ring, not the filled green dot the landing hero uses for
              a live signal. The state is written out beside it as well, so it
              survives colour removal — this badge and that one must never be
              mistakable for each other at a glance.
            */}
            <p className="hero-badge hero-badge--soon">
              <span className="hero-badge-dot hero-badge-dot--hollow" aria-hidden />
              In development
            </p>

            <h1 className="hero-title">
              Tournaments
              <br />
              <span className="gradient-text">coming soon.</span>
            </h1>

            <p className="hero-sub">
              Scheduled games and sit-and-gos are being built and none of them
              are running. There is no date on this page because no date has
              been set. The cash tables are open now, and a seat takes about a
              minute.
            </p>

            <div className="hero-actions">
              {/* The one gradient CTA on this page, and the one glowing
                  element: the only action here that goes somewhere real. */}
              <Button href="/lobby" variant="gradient" size="xl">
                Take a seat at a cash table
              </Button>
              <Button href="/trust" variant="ghost" size="xl">
                <PlayCircleIcon size={18} />
                How it works
              </Button>
            </div>

            <p className="hero-foot">
              Nothing below is a schedule. When a tournament is announced it
              appears here and in the lobby, with the buy-in and the structure
              written out before registration opens.
            </p>
          </header>

          <section className="tourn-section" aria-labelledby="formats-head">
            <div className="tourn-head">
              <h2 id="formats-head">What they will be</h2>
              <p>
                Three formats, in the order they are likely to arrive. Each one
                is a plan rather than a product, and is labelled that way.
              </p>
            </div>

            <div className="tourn-formats">
              {FORMATS.map(({ Icon, title, body }) => (
                <article key={title} className="tourn-format glass">
                  <span className="feature-icon" aria-hidden>
                    <Icon size={26} />
                  </span>
                  <h3>
                    {title}
                    <span className="tourn-tag">Planned</span>
                  </h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="tourn-section" aria-labelledby="pieces-head">
            <div className="tourn-head">
              <h2 id="pieces-head">What has to land first</h2>
              <p>
                A tournament is the cash game plus a clock, an escrow and a way
                to move players between tables. The first three lines below are
                running today; the last three do not exist yet.
              </p>
            </div>

            <ol className="tourn-rail">
              {PIECES.map(({ done, title, body }) => (
                <li
                  key={title}
                  className={done ? "tourn-step is-done" : "tourn-step"}
                >
                  <span className="tourn-node" aria-hidden>
                    {done ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M20 6 9 17l-5-5"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span className="tourn-step-text">
                    <strong>
                      {title}
                      <span className="tourn-status">
                        {done ? "Running today" : "Not built yet"}
                      </span>
                    </strong>
                    <span>{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="tourn-note" aria-labelledby="notify-head">
            <ClockIcon size={20} />
            <div>
              <h2 id="notify-head">There is no sign-up list</h2>
              <p>
                We are not collecting an address we have nowhere to send from.
                When the first tournament is scheduled it goes up on this page
                and at the top of the lobby, far enough ahead that registering
                is not a scramble. Until then the shared cash tables are where
                the players are, which is also where a tournament field would
                come from.
              </p>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
