import Link from "next/link";
import type { Metadata } from "next";

import { CLUSTER } from "@/lib/constants";

const MAINNET = CLUSTER === "mainnet";

export const metadata: Metadata = {
  title: "Trust model | Pokerable",
  description:
    "What Pokerable actually guarantees, what it only claims, and what breaks if an assumption is wrong.",
};

export default function TrustPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "56px 24px 96px",
        lineHeight: 1.65,
      }}
    >
      <Link
        href="/"
        style={{
          fontSize: "var(--t-sm)",
          color: "var(--text-dim)",
          textDecoration: "none",
        }}
      >
        Back to the lobby
      </Link>

      <h1 style={{ fontSize: "var(--t-xl)", margin: "22px 0 10px" }}>Trust model</h1>
      <p style={{ color: "var(--text-dim)", marginTop: 0 }}>
        Written for someone who does not want to be cheated and does not take
        marketing copy at face value.
      </p>

      <Callout>
        <strong>Pokerable does not remove all trust.</strong> The shuffle is
        provably fair and you can check it yourself. Your hole cards are
        protected by Intel TDX and MagicBlock&apos;s TEE validator, which is a
        hardware and operator assumption, not a mathematical one. The accurate
        phrase is &quot;provably fair shuffle, TEE-protected hole cards&quot;.
      </Callout>

      <H2>What you can check yourself</H2>

      <H3>The shuffle</H3>
      <P>
        Every hand publishes the raw VRF output, every player&apos;s salt, each
        player&apos;s prior commitment to that salt, and the final seed. The
        verify button on any finished hand recomputes the deck from scratch in
        your browser and checks all of it. If a deck were rigged, that check
        fails.
      </P>
      <P>Why the deck cannot be steered:</P>
      <ol style={{ color: "var(--text-dim)", paddingLeft: 20 }}>
        <li>Every player commits to a hash of their salt before anyone reveals anything.</li>
        <li>Everyone reveals. The commitments bind them, so nobody can pick a salt after seeing another.</li>
        <li>Only then is VRF drawn, with a seed derived from the salts, so nobody can re-request until they like the answer.</li>
        <li>The shuffle seed is the VRF output XOR every salt.</li>
      </ol>
      <P>
        Biasing it requires the VRF oracle <em>and every seated player</em> to
        collude. One honest player is enough to keep it fair.
      </P>

      <H3>Chip conservation</H3>
      <P>
        Chips only move between a player&apos;s balance and a seat stack on the
        base layer, while the table is undelegated. During a hand the rollup can
        move chips between seats but cannot change the table total, mint a chip,
        or reach anyone&apos;s balance. Solana account ownership enforces this.
      </P>

      <H3>The rules</H3>
      <P>
        Hand evaluation, betting and side pots live in a separate crate with no
        Solana dependencies, covered by property tests asserting chips are
        conserved across any legal sequence of actions.
      </P>

      <H2>What you are trusting</H2>

      <H3>Intel TDX</H3>
      <P>
        Hole cards are unreadable because the TEE validator refuses to serve
        them. That rests on Intel&apos;s hardware isolation. A TDX break, a side
        channel, or a flaw in the enclave firmware would expose cards. TEEs have
        had real breaks. This is a meaningful assumption, not a formality.
      </P>

      <H3>MagicBlock as validator operator</H3>
      <P>
        If the enclave is compromised, or the operator can extract memory from
        it, they see every hole card at every table, live, and the deck order
        before cards are dealt. That is total information. Nothing on chain
        would look wrong, because the cards would still match the published
        seed. <strong>Shuffle verification does not detect this.</strong>
      </P>

      <H3>Attestation proves hardware, not code</H3>
      <P>
        The app verifies a genuine Intel TDX quote bound to a fresh challenge
        before trusting the endpoint. It does not compare the enclave&apos;s
        measurements against an expected allowlist, so it does not prove which
        code is running inside. Read it as &quot;this is real TDX
        hardware&quot;, not &quot;this is the build I expect&quot;. Closing that
        gap needs a measurement allowlist that is not implemented.
      </P>

      <H2>What an attacker cannot do</H2>
      <ul style={{ color: "var(--text-dim)", paddingLeft: 20 }}>
        <li>
          Another player cannot read your hole cards. Each hole-card account is
          permissioned to that seat&apos;s occupant alone. Measured, not assumed:
          an authenticated request from a different wallet returns nothing.
        </li>
        <li>
          Anyone reading Solana sees no cards. Card accounts are private during
          play, and the deck and all hole cards are wiped at hand end before
          anything can carry them back.
        </li>
        <li>The operator cannot rig the deck without every player colluding.</li>
        <li>
          A leaked session key can make bad bets at the one table it was scoped
          to. It cannot cash out, move chips to a balance, or join another
          table, because those paths need your wallet.
        </li>
      </ul>

      <H2>Why not mental poker</H2>
      <P>
        Mental poker removes the hardware assumption and is the
        cryptographically honest answer. We are not using it, so here is why.
        Every card reveal needs a multi-party decryption round trip, and a
        player who disconnects mid-hand takes their key share with them, so the
        hand stalls. Every shipped implementation bolts on timeouts and key
        escrow, which quietly reintroduces trust anyway.
      </P>
      <P>
        Making the enclave the dealer turns a disconnect into an ordinary
        auto-fold. The hand continues without them, like a real table. We
        swapped a cryptographic assumption for a hardware and operator
        assumption, and got liveness in return.
      </P>

      <H2>Disconnects</H2>
      <P>
        Every hand carries a deadline. Once it passes, anyone may call the
        timeout for the seat that owes an action. It is permissionless on
        purpose, so the table does not depend on any one client staying online.
        A player facing no bet is checked down rather than folded, so an
        unattended player only loses a pot they had already put money into.
      </P>

      <H2>Chips and SOL</H2>
      <P>
        Chips are bought with SOL and sold back for SOL, at a rate fixed in the
        program: 1 SOL is exactly 1,000 chips, so a chip is 0.001 SOL. The SOL
        sits in a program vault, and
        chips only exist because someone paid that rate, so every chip is
        backed the moment it is minted. Buying and selling need your wallet;
        session keys cannot touch either.
      </P>
      {MAINNET ? (
        <P>
          This build runs on mainnet, where SOL is real money. That means the
          enclave assumptions on this page bound custody of funds, not just the
          fairness of a game; the attestation gap above is financially
          material; the program&apos;s upgrade authority could replace the
          program that holds the vault; and real-stakes poker is a licensed,
          regulated activity in most places. None of that is solved here, and
          this page will say so for as long as it is true.
        </P>
      ) : (
        <P>
          This build runs on devnet, where SOL is valueless test currency, so
          the architecture is real money and the stakes are not. Be clear-eyed
          about what changes if that ever stops being true: the enclave
          assumptions on this page stop bounding a spoiled game and start
          bounding custody of funds, the attestation gap above becomes
          financially material, and real-stakes poker is a licensed, regulated
          activity in most places. None of that is solved here, and this page
          will say so for as long as it is true.
        </P>
      )}

      <H2>Summary</H2>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "var(--t-sm)",
          marginTop: 12,
        }}
      >
        <tbody>
          {[
            ["Shuffle fairness", "Verifiable by anyone, no trust needed"],
            ["Chip conservation", "Enforced by Solana account ownership"],
            ["Rules correctness", "Property tested, deterministic"],
            ["Cards hidden from opponents", "Trusts Intel TDX and the validator operator"],
            ["Cards hidden from the operator", "Trusts TDX isolation, and attestation does not check the code"],
            ["Hand completes if you disconnect", "Yes, auto-fold"],
            [
              "Funds at risk",
              MAINNET
                ? "Real SOL, plus trust in the program's upgrade authority"
                : "Devnet SOL, which is valueless test currency",
            ],
          ].map(([k, v]) => (
            <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: "9px 12px 9px 0", color: "var(--text)" }}>{k}</td>
              <td style={{ padding: "9px 0", color: "var(--text-dim)" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: "var(--t-lg)", margin: "36px 0 8px" }}>{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontSize: "var(--t-md)", margin: "22px 0 4px", color: "var(--accent)" }}>
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: "var(--text-dim)", margin: "8px 0" }}>{children}</p>;
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderLeft: "2px solid var(--accent)",
        borderRadius: "var(--r-card)",
        padding: "14px 18px",
        margin: "24px 0",
        color: "var(--text-dim)",
      }}
    >
      {children}
    </div>
  );
}
