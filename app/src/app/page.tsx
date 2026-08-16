"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CreateTableModal } from "@/components/chrome/CreateTableModal";
import { Button } from "@/components/primitives/Button";
import { Modal, Skeleton } from "@/components/primitives/Surface";
import { ChipGlyph } from "@/components/primitives/Chip";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import {
  CashOutIcon,
  InfoIcon,
  NewTableIcon,
  PlayersIcon,
  PlusIcon,
  RefreshIcon,
  TableIcon,
  TrophyIcon,
} from "@/components/primitives/Icons";
import { usePlayer } from "@/hooks/use-player";
import { useLeaderboard } from "@/hooks/use-leaderboard";
import { isJoinable, useTables, type LobbyTable } from "@/hooks/use-tables";
import { spring, stagger } from "@/styles/theme";
import { LAMPORTS_PER_CHIP, MAX_SEATS } from "@/lib/constants";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div style={{ width: 150, height: 48 }} /> },
);

/** Stakes, buy-in, seats, players, action. One room per row. */
const COLUMNS = "1.1fr 1.2fr 0.9fr 0.7fr 118px";

export default function Lobby() {
  const { connected, publicKey } = useWallet();
  const { state, buy, sell, busy, affordable } = usePlayer();
  const [exchange, setExchange] = useState<"buy" | "sell" | null>(null);
  const { tables, loading, error, refresh: refreshTables } = useTables();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"players" | "mine">("players");

  const me = publicKey?.toBase58();
  const visible = useMemo(
    () =>
      tables.filter(
        (t) => (!t.outdated && !t.abandoned) || (me && t.table.seats.includes(me)),
      ),
    [tables, me],
  );
  const myTables = useMemo(
    () => (me ? tables.filter((t) => t.table.seats.includes(me)) : []),
    [tables, me],
  );

  return (
    <>
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 380px",
          gap: 48,
          maxWidth: 1720,
          margin: "0 auto",
          padding: "48px 40px 64px",
          alignItems: "start",
        }}
      >
        <section>
          {/* The name, then what you carry with the wallet beside it, then the
              things you can do, on their own line underneath. */}
          <header style={{ marginBottom: 44 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
                marginBottom: 20,
              }}
            >
              <h1
                style={{
                  fontSize: "clamp(34px, 4vw, 52px)",
                  color: "var(--accent)",
                  letterSpacing: "-0.03em",
                  marginRight: "auto",
                }}
              >
                SolPoker
              </h1>

              {connected && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "var(--surface)",
                    borderRadius: "var(--r-panel)",
                    padding: "12px 20px 12px 12px",
                    height: 56,
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background: "var(--accent)",
                      color: "var(--on-accent)",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <ChipGlyph size={20} color="currentColor" />
                  </span>
                  <span
                    className="tnum"
                    style={{ fontWeight: 700, fontSize: 16, color: "var(--text-dim)" }}
                  >
                    {state ? state.chips.toLocaleString() : "..."}
                  </span>
                </div>
              )}

              <WalletMultiButton />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {connected && (
                <>
                  <IconButton title="Buy chips" solid onClick={() => setExchange("buy")}>
                    <PlusIcon />
                  </IconButton>
                  <IconButton
                    title="Cash out"
                    disabled={!state || state.chips === 0}
                    onClick={() => setExchange("sell")}
                  >
                    <CashOutIcon />
                  </IconButton>
                  <IconButton title="New table" onClick={() => setCreating(true)}>
                    <NewTableIcon />
                  </IconButton>
                </>
              )}
              <Link href="/trust" style={{ textDecoration: "none" }}>
                <IconButton title="How this works">
                  <InfoIcon />
                </IconButton>
              </Link>
            </div>
          </header>

          {/* Column headings, then a row per room. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLUMNS,
              gap: 24,
              padding: "0 8px 14px",
              color: "var(--text-dim)",
              opacity: 0.64,
              fontSize: 14,
              letterSpacing: "0.02em",
            }}
          >
            <span>Stakes</span>
            <span>Buy-in</span>
            <span>Seats</span>
            <span>Players</span>
            <span style={{ textAlign: "right" }}>Action</span>
          </div>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Skeleton height={64} />
              <Skeleton height={64} />
              <Skeleton height={64} />
            </div>
          ) : error ? (
            <EmptyRow tone="var(--lose)">
              <span>Could not reach the network.</span>
              <Button variant="ghost" size="sm" onClick={() => void refreshTables()}>
                Try again
              </Button>
            </EmptyRow>
          ) : visible.length === 0 ? (
            <EmptyRow>
              <TableIcon size={22} />
              <span>No rooms yet.</span>
              {connected && (
                <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                  Open one
                </Button>
              )}
            </EmptyRow>
          ) : (
            <div>
              {visible.slice(0, 25).map((t, i) => (
                <motion.div
                  key={t.table.address}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring.gentle, delay: i * stagger.list }}
                >
                  <TableRow t={t} />
                </motion.div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
            <IconButton title="Refresh" onClick={() => void refreshTables()}>
              <RefreshIcon />
            </IconButton>
          </div>
        </section>

        {/* Who is winning, and where you are sitting. */}
        <aside>
          <div style={{ display: "flex", gap: 0, marginBottom: 2 }}>
            <Tab active={tab === "players"} onClick={() => setTab("players")} title="Leaderboard">
              <TrophyIcon size={22} />
            </Tab>
            <Tab active={tab === "mine"} onClick={() => setTab("mine")} title="Your tables">
              <TableIcon size={22} />
            </Tab>
          </div>
          <div style={{ height: 1, background: "var(--control)", opacity: 0.48 }} />

          {tab === "players" ? (
            <Leaderboard me={me} />
          ) : (
            <MyTables tables={myTables} />
          )}
        </aside>
      </main>

      <ExchangeModal
        mode={exchange}
        onClose={() => setExchange(null)}
        chips={state?.chips ?? 0}
        affordable={affordable}
        busy={busy}
        onBuy={buy}
        onSell={sell}
        solPerChip={LAMPORTS_PER_CHIP / 1e9}
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
      <motion.div
        whileHover={{ backgroundColor: "rgba(64, 82, 94, 0.16)" }}
        transition={spring.snappy}
        style={{
          display: "grid",
          gridTemplateColumns: COLUMNS,
          gap: 24,
          alignItems: "center",
          height: 64,
          padding: "0 8px",
          borderRadius: "var(--r-panel)",
        }}
      >
        <span
          className="tnum"
          style={{ fontWeight: 500, fontSize: 18, color: "var(--text-dim)" }}
        >
          {t.config ? `${t.config.smallBlind} / ${t.config.bigBlind}` : "-"}
        </span>

        <span
          className="tnum"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontWeight: 500,
            fontSize: 18,
            color: "var(--accent)",
          }}
        >
          <ChipGlyph size={17} />
          {t.config
            ? `${t.config.minBuyIn.toLocaleString()} - ${t.config.maxBuyIn.toLocaleString()}`
            : "-"}
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: "var(--accent)",
            fontWeight: 500,
            fontSize: 18,
          }}
        >
          <span style={{ color: "var(--text-dim)", opacity: 0.8 }}>
            <TableIcon size={22} />
          </span>
          {MAX_SEATS}
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: "var(--accent)",
            fontWeight: 500,
            fontSize: 18,
          }}
        >
          <span style={{ color: "var(--text-dim)", opacity: 0.8 }}>
            <PlayersIcon size={22} />
          </span>
          {t.seated}
        </span>

        <span
          style={{
            justifySelf: "end",
            width: 118,
            height: 48,
            display: "grid",
            placeItems: "center",
            borderRadius: "var(--r-panel)",
            background: joinable && !live ? "var(--accent)" : "rgba(152, 222, 227, 0.06)",
            color: joinable && !live ? "var(--on-accent)" : "var(--accent)",
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {live ? "Watch" : joinable ? "Join" : "View"}
        </span>
      </motion.div>
    </Link>
  );
}

/**
 * The leaderboard: every player on the program, deepest stack first.
 *
 * The figures are the ones the program already keeps, so nothing here is a
 * separate scoreboard that could drift from the game. Chips sitting on a seat
 * are not in a player's balance, so someone mid-hand shows only what they are
 * not currently risking.
 */
function Leaderboard({ me }: { me?: string }) {
  const { rows, loading } = useLeaderboard();

  if (loading && rows.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 14 }}>
        <Skeleton height={44} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }
  if (rows.length === 0) return <SideEmpty icon={<TrophyIcon size={24} />} />;

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "28px 1fr 36px auto",
          gap: 12,
          height: 52,
          alignItems: "center",
          color: "var(--text-dim)",
          opacity: 0.64,
          fontSize: 14,
          letterSpacing: "0.02em",
        }}
      >
        <span>#</span>
        <span>Player</span>
        <span />
        <span style={{ textAlign: "right" }}>Chips</span>
      </div>

      {rows.slice(0, 12).map((r, i) => {
        const mine = r.authority === me;
        return (
          <motion.div
            key={r.authority}
            initial={{ opacity: 0, x: 6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ ...spring.gentle, delay: i * stagger.list }}
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 36px auto",
              gap: 12,
              alignItems: "center",
              height: 52,
            }}
          >
            <span
              className="tnum"
              style={{
                fontWeight: 700,
                fontSize: 15,
                color: i < 3 ? "var(--accent)" : "var(--text-faint)",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                fontWeight: 500,
                fontSize: 16,
                color: mine ? "var(--accent)" : "var(--text-dim)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mine ? "you" : shortKey(r.authority)}
            </span>
            <Avatar pubkey={r.authority} size={30} square />
            <span
              className="tnum"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 500,
                fontSize: 16,
                color: "var(--accent)",
                justifyContent: "flex-end",
              }}
            >
              <ChipGlyph size={15} />
              {r.chips.toLocaleString()}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Tables this wallet is seated at, so chips are never lost track of. */
function MyTables({ tables }: { tables: LobbyTable[] }) {
  if (tables.length === 0) return <SideEmpty icon={<TableIcon size={24} />} />;
  return (
    <div>
      <SideHead cols={["Table", "", "Seats"]} />
      {tables.map((t) => (
        <Link
          key={t.table.address}
          href={`/table/${t.table.tableId}`}
          style={{ textDecoration: "none" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 40px 40px",
              gap: 14,
              alignItems: "center",
              height: 52,
            }}
          >
            <span className="tnum" style={{ fontSize: 17, color: "var(--text-dim)" }}>
              {t.config ? `${t.config.smallBlind} / ${t.config.bigBlind}` : "-"}
            </span>
            <span style={{ color: "var(--accent)" }}>
              <TableIcon size={22} />
            </span>
            <span
              className="tnum"
              style={{ fontSize: 17, color: "var(--accent)", textAlign: "right" }}
            >
              {t.seated}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function SideHead({ cols }: { cols: string[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 40px 40px",
        gap: 14,
        height: 52,
        alignItems: "center",
        color: "var(--text-dim)",
        opacity: 0.64,
        fontSize: 14,
        letterSpacing: "0.02em",
      }}
    >
      <span>{cols[0]}</span>
      <span />
      <span style={{ textAlign: "right" }}>{cols[2]}</span>
    </div>
  );
}

function SideEmpty({ icon }: { icon: React.ReactNode }) {
  return (
    <div
      style={{
        height: 160,
        display: "grid",
        placeItems: "center",
        color: "var(--text-faint)",
        opacity: 0.5,
      }}
    >
      {icon}
    </div>
  );
}

function EmptyRow({
  children,
  tone = "var(--text-dim)",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        height: 128,
        color: tone,
        fontSize: 15,
      }}
    >
      {children}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        flex: 1,
        height: 56,
        display: "grid",
        placeItems: "center",
        background: "none",
        border: "none",
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        color: active ? "var(--accent)" : "var(--text-dim)",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  title,
  solid = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  solid?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.button
      title={title}
      aria-label={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={spring.snappy}
      style={{
        width: 56,
        height: 56,
        display: "grid",
        placeItems: "center",
        border: "none",
        borderRadius: "var(--r-panel)",
        background: solid ? "var(--accent)" : "var(--surface)",
        color: solid ? "var(--on-accent)" : "var(--accent)",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </motion.button>
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
  solPerChip,
}: {
  mode: "buy" | "sell" | null;
  onClose: () => void;
  chips: number;
  affordable: number;
  busy: "buy" | "sell" | null;
  onBuy: (chips: number) => Promise<void>;
  onSell: (chips: number) => Promise<void>;
  solPerChip: number;
}) {
  const [amount, setAmount] = useState(10_000);
  const buying = mode === "buy";
  const max = buying ? affordable : chips;
  const clamped = Math.min(Math.max(amount, 0), max);
  const sol = clamped * solPerChip;

  return (
    <Modal open={mode !== null} onClose={onClose} title={buying ? "Buy chips" : "Cash out"}>
      <div style={{ display: "flex", gap: 8, margin: "4px 0 14px" }}>
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

      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "6px 0 18px" }}>
        <input
          type="range"
          min={0}
          max={Math.max(max, 1)}
          step={100}
          value={clamped}
          onChange={(e) => setAmount(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span
          className="tnum"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--accent)",
            minWidth: 120,
            justifyContent: "flex-end",
          }}
        >
          <ChipGlyph size={17} />
          {clamped.toLocaleString()}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          color: "var(--text-dim)",
          fontSize: 15,
        }}
      >
        <span>{buying ? "You pay" : "You receive"}</span>
        <span className="tnum" style={{ color: "var(--text)", fontWeight: 600 }}>
          {sol.toFixed(4)} SOL
        </span>
      </div>

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
