"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TopBar } from "@/components/chrome/TopBar";
import { CreateTableModal } from "@/components/chrome/CreateTableModal";
import { Button } from "@/components/primitives/Button";
import { Panel, Skeleton, Stat } from "@/components/primitives/Surface";
import { usePlayer } from "@/hooks/use-player";
import { isJoinable, useTables, type LobbyTable } from "@/hooks/use-tables";
import { spring, stagger } from "@/styles/theme";
import { FAUCET_AMOUNT } from "@/lib/constants";

export default function Lobby() {
  const { connected } = useWallet();
  const { state, claim, busy, canClaim, nextClaimIn, refresh } = usePlayer();
  const { tables, loading, refresh: refreshTables } = useTables();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <TopBar chips={state?.chips} />

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "36px 24px 80px" }}>
        <section style={{ marginBottom: 34 }}>
          <h1 style={{ fontSize: "var(--t-xl)", marginBottom: 6 }}>
            Real-time Hold&apos;em, on chain
          </h1>
          <p style={{ color: "var(--text-dim)", margin: 0, maxWidth: 620 }}>
            Every hand runs inside a secure enclave, so nobody sees your cards,
            and every shuffle can be checked afterwards by anyone. Provably fair
            shuffle, TEE-protected hole cards.{" "}
            <Link href="/trust" style={{ color: "var(--accent)" }}>
              What that means
            </Link>
            .
          </p>
        </section>

        {!connected ? (
          <>
            <Panel style={{ textAlign: "center", padding: 46 }}>
              <p style={{ color: "var(--text-dim)", margin: "0 0 6px" }}>
                Connect a wallet to get chips and take a seat.
              </p>
              <p style={{ color: "var(--text-faint)", fontSize: "var(--t-sm)", margin: 0 }}>
                Devnet only. Chips are play money, not purchasable and not
                redeemable.
              </p>
            </Panel>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 14,
                marginTop: 30,
              }}
            >
              {[
                {
                  n: "01",
                  t: "Everyone salts the deck",
                  d: "Each player commits to random bytes before anyone reveals. One honest player is enough to keep the shuffle fair.",
                },
                {
                  n: "02",
                  t: "The hand runs in an enclave",
                  d: "Cards are dealt inside secure hardware. Your opponents cannot read your hand, and neither can anyone watching Solana.",
                },
                {
                  n: "03",
                  t: "Check it afterwards",
                  d: "Every finished hand publishes what it was dealt from. Recompute the deck yourself and see that it matches.",
                },
              ].map((s, i) => (
                <motion.div
                  key={s.n}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring.gentle, delay: 0.05 + i * 0.06 }}
                >
                  <Panel style={{ height: "100%" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "var(--t-sm)",
                        color: "var(--accent-deep)",
                        marginBottom: 8,
                      }}
                    >
                      {s.n}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "var(--t-base)",
                        marginBottom: 6,
                      }}
                    >
                      {s.t}
                    </div>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "var(--t-sm)",
                        color: "var(--text-dim)",
                        lineHeight: 1.55,
                      }}
                    >
                      {s.d}
                    </p>
                  </Panel>
                </motion.div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
                marginBottom: 30,
              }}
            >
              <Panel>
                <Stat
                  label="Your chips"
                  value={state ? state.chips.toLocaleString() : "..."}
                  size="lg"
                  tone="var(--accent)"
                />
                <div style={{ marginTop: 14 }}>
                  <Button
                    variant={canClaim ? "primary" : "ghost"}
                    size="sm"
                    disabled={!canClaim}
                    loading={busy}
                    onClick={async () => {
                      await claim();
                      await refresh();
                    }}
                  >
                    {canClaim
                      ? `Claim ${FAUCET_AMOUNT.toLocaleString()}`
                      : `Next claim in ${formatWait(nextClaimIn)}`}
                  </Button>
                </div>
              </Panel>

              <Panel>
                <Stat label="Hands played" value={state?.handsPlayed ?? 0} size="lg" />
                <p
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "var(--t-xs)",
                    margin: "12px 0 0",
                  }}
                >
                  One free claim a day. The faucet is the only source of chips.
                </p>
              </Panel>

              <Panel>
                <Stat label="Start something" value="New table" size="lg" />
                <div style={{ marginTop: 14 }}>
                  <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                    Create a table
                  </Button>
                </div>
              </Panel>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <h2 style={{ fontSize: "var(--t-md)" }}>Tables</h2>
              <Button variant="quiet" size="sm" onClick={() => void refreshTables()}>
                Refresh
              </Button>
            </div>

            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Skeleton height={72} />
                <Skeleton height={72} />
              </div>
            ) : tables.length === 0 ? (
              <Panel style={{ textAlign: "center", padding: 40 }}>
                <p style={{ color: "var(--text-dim)", margin: 0 }}>
                  No tables yet. Create the first one.
                </p>
              </Panel>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tables.slice(0, 25).map((t, i) => (
                  <motion.div
                    key={t.table.address}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...spring.gentle, delay: i * stagger.list }}
                  >
                    <TableRow t={t} />
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <CreateTableModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={refreshTables}
      />
    </>
  );
}

function TableRow({ t }: { t: LobbyTable }) {
  const joinable = isJoinable(t);
  const live = t.delegated;

  return (
    <Link href={`/table/${t.table.tableId}`} style={{ textDecoration: "none" }}>
      <Panel hoverable padded={false} style={{ padding: "14px 18px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "var(--t-md)",
                color: "var(--text)",
              }}
            >
              {t.config ? `${t.config.smallBlind} / ${t.config.bigBlind}` : "table"}
            </div>
            <div style={{ fontSize: "var(--t-xs)", color: "var(--text-faint)" }}>
              table {t.table.tableId} · hand {t.table.handNumber}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ textAlign: "right" }}>
              <div className="tnum" style={{ fontSize: "var(--t-base)" }}>
                {t.seated} / 6
              </div>
              <div style={{ fontSize: "var(--t-xs)", color: "var(--text-faint)" }}>
                seated
              </div>
            </div>
            <Badge
              tone={live ? "var(--win)" : joinable ? "var(--accent)" : "var(--text-faint)"}
              label={live ? "playing" : joinable ? "open" : "full"}
            />
          </div>
        </div>
      </Panel>
    </Link>
  );
}

function Badge({ tone, label }: { tone: string; label: string }) {
  return (
    <span
      style={{
        fontSize: "var(--t-xs)",
        color: tone,
        border: `1px solid ${tone}`,
        borderRadius: 999,
        padding: "3px 10px",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        opacity: 0.9,
      }}
    >
      {label}
    </span>
  );
}

function formatWait(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
