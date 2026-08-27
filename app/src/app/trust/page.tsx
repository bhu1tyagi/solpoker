import type { Metadata } from "next";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { SiteFooter } from "@/components/chrome/SiteFooter";
import { Orbs } from "@/components/chrome/Orbs";
import { TrustFlow } from "@/components/trust/TrustFlow";
import { RakeMeter } from "@/components/trust/RakeMeter";
import { CLUSTER } from "@/lib/constants";

const MAINNET = CLUSTER === "mainnet";

/**
 * The trust page. The interactive flow carries the lifecycle that used to be
 * several screens of prose; the text that remains is the part a diagram must
 * not soften: what is being trusted, what an attacker cannot do, the rake,
 * and the summary table.
 *
 * The #shuffle and #rake anchors are load-bearing: the footer links to both.
 */

export const metadata: Metadata = {
  title: "Trust model | Pokerable",
  description:
    "What Pokerable actually guarantees, what it only claims, and what breaks if an assumption is wrong.",
};

export default function TrustPage() {
  return (
    <>
      <SiteHeader />

      <main id="main" className="landing">
        <Orbs />
        <div className="landing-inner trust-page">
          <header className="trust-head">
            <h1 className="hero-title">Trust model</h1>
            <p className="trust-lede">
              Written for someone who does not want to be cheated and does not
              take marketing copy at face value. The shuffle is provably fair
              and you can check it yourself. Your hole cards are protected by
              a hardware enclave, which is a hardware and operator assumption,
              not a mathematical one.
            </p>
          </header>

          <section id="shuffle" aria-labelledby="flow-head" className="trust-section">
            <h2 id="flow-head">The life of one hand</h2>
            <p className="trust-section-lede">
              Click through the stages. Green ones anyone can recheck from
              public data; the purple one is where trust actually lives.
            </p>
            <TrustFlow />
          </section>

          <section aria-labelledby="trusting-head" className="trust-section">
            <h2 id="trusting-head">What you are trusting</h2>
            <p className="trust-section-lede">
              Three assumptions, each with its failure spelled out. Open one to
              see exactly what breaks.
            </p>
            <div className="trust-cols">
              {[
                {
                  t: "Intel TDX",
                  p: "Hole cards are unreadable because the enclave refuses to serve them. That rests on Intel's hardware isolation, and TEEs have had real breaks.",
                  b: "A TDX break exposes hole cards at every table, live. Nothing on chain would look wrong.",
                },
                {
                  t: "The validator operator",
                  p: "MagicBlock runs the enclave. The design denies them card access, but the hardware is in their racks.",
                  b: "An operator who can extract enclave memory sees every card and the deck order before the deal. Shuffle verification does not detect it.",
                },
                {
                  t: "Attestation scope",
                  p: "The app verifies a genuine Intel TDX quote before trusting the endpoint. It does not check which code runs inside.",
                  b: "A different build inside real TDX hardware would pass. Closing this needs a measurement allowlist that is not implemented.",
                },
              ].map((c) => (
                <details key={c.t} className="trust-col glass trust-assume">
                  <summary>
                    <h3>{c.t}</h3>
                    <span className="trust-assume-hint" aria-hidden>
                      if it breaks
                    </span>
                  </summary>
                  <p>{c.p}</p>
                  <p className="trust-assume-break">{c.b}</p>
                </details>
              ))}
            </div>
          </section>

          <section aria-labelledby="cannot-head" className="trust-section">
            <h2 id="cannot-head">Try to cheat it</h2>
            <p className="trust-section-lede">
              The attacks a poker player actually worries about, and where each
              one dies. Open any attempt.
            </p>
            <div className="trust-attacks">
              {[
                {
                  a: "Read an opponent's hole cards",
                  b: "Each card account answers only its seat's occupant. An authenticated request from any other wallet returns nothing. Measured, not assumed.",
                },
                {
                  a: "Scrape the cards from Solana",
                  b: "Card accounts are private during play, and the deck is wiped at hand end before anything public could carry it.",
                },
                {
                  a: "Rig the shuffle as the operator",
                  b: "The seed is the VRF output XOR every player's salt. Steering it needs the oracle and every seated player colluding; one honest player is enough.",
                },
                {
                  a: "Steal a session key",
                  b: "It can make bad bets at the one table it was scoped to, nothing else. Cashing out, moving chips and joining tables all need the wallet.",
                },
              ].map((x, i) => (
                <details key={x.a} className="trust-attack glass">
                  <summary>
                    <span className="trust-attack-n num" aria-hidden>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {x.a}
                    <span className="trust-attack-tag">blocked</span>
                  </summary>
                  <p>{x.b}</p>
                </details>
              ))}
            </div>
          </section>

          <section id="rake" aria-labelledby="rake-head" className="trust-section">
            <h2 id="rake-head">The rake</h2>
            <p className="trust-section-lede">
              2.5% of flopped pots, capped at three big blinds. Drag the pot to
              see it.
            </p>
            <RakeMeter />
            {MAINNET && (
              <p className="trust-body" style={{ marginTop: "var(--sp-6)" }}>
                The USDC here is real money. That means the enclave assumptions
                on this page bound custody of funds, not just the fairness of a
                game; the attestation gap above is financially material; the
                program&apos;s upgrade authority could replace the program that
                holds the vault; and real-stakes poker is a licensed, regulated
                activity in most places. None of that is solved here, and this
                page will say so for as long as it is true.
              </p>
            )}
          </section>

          <section aria-labelledby="summary-head" className="trust-section">
            <h2 id="summary-head">Summary</h2>
            <table className="trust-table">
              <tbody>
                {[
                  ["Shuffle fairness", "Verifiable by anyone, no trust needed", "verify"],
                  ["Chip conservation", "Enforced by Solana account ownership", "verify"],
                  ["Rules correctness", "Property tested, deterministic", "verify"],
                  [
                    "Cards hidden from opponents",
                    "Trusts Intel TDX and the validator operator",
                    "trust",
                  ],
                  [
                    "Cards hidden from the operator",
                    "Trusts TDX isolation, and attestation does not check the code",
                    "trust",
                  ],
                  ["Hand completes if you disconnect", "Yes, auto-fold", "verify"],
                  [
                    "Funds at risk",
                    MAINNET
                      ? "Real USDC, plus trust in the program's upgrade authority"
                      : "A test mint, which is valueless",
                    "trust",
                  ],
                ].map(([k, v, kind]) => (
                  <tr key={k}>
                    <td>
                      <span
                        className={`trust-sum-dot trust-sum-dot--${kind}`}
                        aria-hidden
                      />
                      {k}
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
