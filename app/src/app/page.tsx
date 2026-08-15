"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { TopBar } from "@/components/chrome/TopBar";
import { CreateTableModal } from "@/components/chrome/CreateTableModal";
import { Button } from "@/components/primitives/Button";
import { Modal, Panel, Skeleton, Stat } from "@/components/primitives/Surface";
import { usePlayer } from "@/hooks/use-player";
import { isJoinable, useTables, type LobbyTable } from "@/hooks/use-tables";
import { spring, stagger } from "@/styles/theme";
import { LAMPORTS_PER_CHIP } from "@/lib/constants";

export default function Lobby() {
  const { connected, publicKey } = useWallet();
  const { state, buy, sell, busy, affordable, refresh } = usePlayer();
  const [exchange, setExchange] = useState<"buy" | "sell" | null>(null);
  const { tables, loading, error, refresh: refreshTables } = useTables();
  const [creating, setCreating] = useState(false);

  // Tables this wallet is sitting at, live or not. Losing track of a table you
  // have chips on is the one navigation failure that really matters.
  const me = publicKey?.toBase58();
  const myTables = me ? tables.filter((t) => t.table.seats.includes(me)) : [];

  return (
    <>
      <TopBar chips={state?.chips} />

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "36px 24px 80px" }}>
        <section style={{ marginBottom: 34 }}>
          <h1 style={{ fontSize: "var(--t-xl)", marginBottom: 6 }}>
            Real-time Hold&apos;em, on chain
          </h1>
          <p style={{ color: "var(--text-dim)", margin: 0, maxWidth: 620 }}>
            Buy chips with SOL, play, sell them back. Every hand runs inside a
            secure enclave, so nobody sees your cards, and every shuffle can be
            checked afterwards by anyone. Provably fair shuffle, TEE-protected
            hole cards.{" "}
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
                Devnet only for now, so the SOL involved is test currency.
                Chips are backed one to one by SOL in the program vault.
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
                  style={{
                    borderTop: "1px solid var(--line)",
                    paddingTop: 16,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "var(--t-sm)",
                      color: "var(--accent)",
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
                </motion.div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "28px 44px",
                padding: "10px 4px 30px",
              }}
            >
              <div>
                <Stat
                  label="Your chips"
                  value={state ? state.chips.toLocaleString() : "..."}
                  size="lg"
                  tone="var(--accent)"
                />
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <Button variant="primary" size="sm" onClick={() => setExchange("buy")}>
                    Buy chips
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!state || state.chips === 0}
                    onClick={() => setExchange("sell")}
                  >
                    Cash out
                  </Button>
                </div>
              </div>

              <div
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  background:
                    "linear-gradient(180deg, transparent, var(--line), transparent)",
                }}
              />

              <div>
                <Stat
                  label="Wallet"
                  value={state ? `${(state.lamports / 1e9).toFixed(3)} SOL` : "..."}
                  size="lg"
                />
                <p
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "var(--t-xs)",
                    margin: "10px 0 0",
                    maxWidth: 230,
                  }}
                >
                  10,000 chips cost 0.01 SOL, and sell back for exactly the
                  same. The vault holds the difference.
                </p>
              </div>

              <div
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  background:
                    "linear-gradient(180deg, transparent, var(--line), transparent)",
                }}
              />

              <div>
                <Stat label="Start something" value="New table" size="lg" />
                <div style={{ marginTop: 10 }}>
                  <Button variant="ghost" size="sm" onClick={() => setCreating(true)}>
                    Create a table
                  </Button>
                </div>
              </div>
            </div>

            {myTables.length > 0 && (
              <Panel
                style={{
                  marginBottom: 22,
                  borderLeft: "2px solid var(--accent)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: "var(--t-base)" }}>
                      You are seated at {myTables.length === 1 ? "a table" : `${myTables.length} tables`}
                    </div>
                    <p
                      style={{
                        margin: "4px 0 0",
                        fontSize: "var(--t-sm)",
                        color: "var(--text-dim)",
                      }}
                    >
                      Your chips stay on the seat until you cash out there.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {myTables.map((t) => (
                      <Link
                        key={t.table.address}
                        href={`/table/${t.table.tableId}`}
                        style={{ textDecoration: "none" }}
                      >
                        <Button variant="primary" size="sm">
                          Return to table {String(t.table.tableId).slice(-4)}
                        </Button>
                      </Link>
                    ))}
                  </div>
                </div>
              </Panel>
            )}

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
            ) : error ? (
              <Panel style={{ textAlign: "center", padding: 32 }}>
                <p style={{ color: "var(--lose)", margin: "0 0 6px" }}>
                  Could not load the table list.
                </p>
                <p
                  style={{
                    color: "var(--text-faint)",
                    fontSize: "var(--t-xs)",
                    margin: "0 0 12px",
                    wordBreak: "break-word",
                  }}
                >
                  {error}
                </p>
                <Button variant="ghost" size="sm" onClick={() => void refreshTables()}>
                  Try again
                </Button>
              </Panel>
            ) : tables.length === 0 ? (
              <Panel style={{ textAlign: "center", padding: 40 }}>
                <p style={{ color: "var(--text-dim)", margin: 0 }}>
                  No tables yet. Create the first one.
                </p>
              </Panel>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {tables
                .filter((t) => (!t.outdated && !t.abandoned) || (me && t.table.seats.includes(me)))
                .slice(0, 25)
                .map((t, i) => (
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

      <ExchangeModal
        mode={exchange}
        onClose={() => setExchange(null)}
        chips={state?.chips ?? 0}
        affordable={affordable}
        busy={busy}
        onBuy={buy}
        onSell={sell}
      />

      <CreateTableModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={refreshTables}
        tables={tables}
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
              tone={
                t.outdated
                  ? "var(--lose)"
                  : live
                    ? "var(--win)"
                    : joinable
                      ? "var(--accent)"
                      : "var(--text-faint)"
              }
              label={t.outdated ? "outdated" : live ? "playing" : joinable ? "open" : "full"}
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

function ExchangeModal({
  mode,
  onClose,
  chips,
  affordable,
  busy,
  onBuy,
  onSell,
}: {
  mode: "buy" | "sell" | null;
  onClose: () => void;
  chips: number;
  affordable: number;
  busy: "buy" | "sell" | null;
  onBuy: (chips: number) => Promise<void>;
  onSell: (chips: number) => Promise<void>;
}) {
  const [amount, setAmount] = useState(10_000);
  const buying = mode === "buy";
  const max = buying ? affordable : chips;
  const clamped = Math.min(Math.max(amount, 0), max);
  const sol = (clamped * LAMPORTS_PER_CHIP) / 1e9;

  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      title={buying ? "Buy chips" : "Cash out to SOL"}
    >
      <p style={{ color: "var(--text-dim)", fontSize: "var(--t-sm)", marginTop: 0 }}>
        {buying
          ? "SOL moves from your wallet into the program vault and chips appear in your balance. The rate is fixed in the program."
          : "Chips leave your balance and the vault pays SOL back to your wallet, at the same fixed rate they were bought at."}
      </p>

      <div style={{ display: "flex", gap: 8, margin: "16px 0 10px" }}>
        {[1_000, 10_000, 50_000].map((v) => (
          <Button
            key={v}
            size="sm"
            variant={clamped === Math.min(v, max) ? "primary" : "ghost"}
            disabled={max === 0}
            onClick={() => setAmount(Math.min(v, max))}
          >
            {v.toLocaleString()}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={max === 0} onClick={() => setAmount(max)}>
          Max
        </Button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "6px 0 18px" }}>
        <input
          type="range"
          min={0}
          max={Math.max(max, 1)}
          step={100}
          value={clamped}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{ flex: 1, accentColor: "var(--accent)" }}
        />
        <span
          className="tnum"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--t-md)",
            color: "var(--accent)",
            minWidth: 90,
            textAlign: "right",
          }}
        >
          {clamped.toLocaleString()}
        </span>
      </div>

      <p style={{ color: "var(--text-faint)", fontSize: "var(--t-sm)", margin: "0 0 16px" }}>
        {buying ? `Costs ${sol} SOL` : `Pays ${sol} SOL`}
      </p>

      <div style={{ display: "flex", gap: 10 }}>
        <Button
          variant="primary"
          disabled={clamped === 0}
          loading={busy !== null}
          onClick={async () => {
            if (buying) await onBuy(clamped);
            else await onSell(clamped);
            onClose();
          }}
        >
          {buying ? "Buy" : "Cash out"}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
