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
import { useLeaderboard, type LeaderRow } from "@/hooks/use-leaderboard";
import { isJoinable, useTables, type LobbyTable } from "@/hooks/use-tables";
import { spring, stagger } from "@/styles/theme";
import { LAMPORTS_PER_CHIP, MAX_SEATS } from "@/lib/constants";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div style={{ width: 150, height: 48 }} /> },
);

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
        (t) =>
          (!t.outdated && !t.abandoned && !t.stale) ||
          // A table you are sitting at is always shown, whatever its state,
          // because chips on a seat must never become unreachable.
          (me && t.table.seats.includes(me)),
      ),
    [tables, me],
  );
  const myTables = useMemo(
    () => (me ? tables.filter((t) => t.table.seats.includes(me)) : []),
    [tables, me],
  );

  return (
    <>
      {/* The class carries the shape: content beside the side column on a
          desktop, one column on anything narrower. */}
      <main className="lobby-shell">
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
                <>
                  {/* Your chips, with the way to get more built into the same
                      control, then the way to take them out, then the wallet. */}
                  <div
                    className="m-pill"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      background: "var(--surface)",
                      borderRadius: "var(--r-panel)",
                      padding: "0 5px 0 12px",
                      height: 44,
                    }}
                  >
                    <ChipGlyph size={22} />
                    <span
                      className="tnum"
                      style={{ fontWeight: 700, fontSize: 16, color: "var(--text-dim)" }}
                    >
                      {state ? state.chips.toLocaleString() : "..."}
                    </span>
                    <motion.button
                      className="m-plus"
                      title="Buy chips"
                      aria-label="Buy chips"
                      onClick={() => setExchange("buy")}
                      whileTap={{ scale: 0.94 }}
                      transition={spring.snappy}
                      style={{
                        width: 34,
                        height: 34,
                        display: "grid",
                        placeItems: "center",
                        border: "none",
                        borderRadius: "var(--r-panel)",
                        background: "var(--accent)",
                        color: "var(--on-accent)",
                        cursor: "pointer",
                      }}
                    >
                      <PlusIcon size={16} />
                    </motion.button>
                  </div>

                  <IconButton
                    title="Cash out"
                    disabled={!state || state.chips === 0}
                    onClick={() => setExchange("sell")}
                  >
                    <CashOutIcon />
                  </IconButton>
                </>
              )}

              <WalletMultiButton />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {connected && (
                <LabelButton
                  title="Create a table"
                  icon={<NewTableIcon size={16} />}
                  onClick={() => setCreating(true)}
                />
              )}
              <Link href="/trust" style={{ textDecoration: "none" }}>
                <LabelButton title="How this works" icon={<InfoIcon size={16} />} />
              </Link>

              {/* Chips left on a seat are the one thing worth interrupting the
                  layout for, so a table you are sitting at says so here rather
                  than waiting to be found under a tab. */}
              {myTables.map((t) => (
                <Link
                  key={t.table.address}
                  href={`/table/${t.table.tableId}`}
                  style={{ textDecoration: "none" }}
                >
                  <LabelButton title="Return to table" icon={<TableIcon size={16} />} solid />
                </Link>
              ))}

              <div style={{ marginLeft: "auto" }}>
                <LabelButton
                  title="Refresh"
                  icon={<RefreshIcon size={16} />}
                  onClick={() => void refreshTables(true)}
                />
              </div>
            </div>
          </header>

          {/* Column headings, then a row per room. On a phone the buy-in folds
              under the stakes and the seat count goes without saying. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "var(--lobby-cols)",
              gap: "var(--lobby-gap)",
              padding: "0 8px 14px",
              color: "var(--text-dim)",
              opacity: 0.64,
              fontSize: 14,
              letterSpacing: "0.02em",
            }}
          >
            <span>Stakes</span>
            <span className="m-hide">Buy-in</span>
            <span className="m-hide">Seats</span>
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

        </section>

        {/* Who is winning, and where you are sitting. The panel lifts away from
            the page on its left edge and sinks into it on the right, so the
            column reads as its own surface without needing a border. */}
        <aside style={{ alignSelf: "stretch" }}>
          <div style={{ display: "flex", gap: 0 }}>
            <Tab active={tab === "players"} onClick={() => setTab("players")} title="Leaderboard">
              <TrophyIcon size={16} />
              Leaderboard
            </Tab>
            <Tab active={tab === "mine"} onClick={() => setTab("mine")} title="Your tables">
              <TableIcon size={16} />
              Your tables
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
        className="lobby-row"
        whileHover={{ backgroundColor: "rgba(64, 82, 94, 0.16)" }}
        transition={spring.snappy}
        style={{
          display: "grid",
          gridTemplateColumns: "var(--lobby-cols)",
          gap: "var(--lobby-gap)",
          alignItems: "center",
          padding: "0 8px",
          borderRadius: "var(--r-panel)",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            className="tnum"
            style={{ fontWeight: 500, fontSize: 18, color: "var(--text-dim)" }}
          >
            {t.config ? `${t.config.smallBlind} / ${t.config.bigBlind}` : "-"}
          </span>
          <span
            className="tnum m-hide"
            style={{ fontSize: 11, color: "var(--text-faint)" }}
          >
            {t.table.tableId}
          </span>
          {/* The phone's buy-in line, standing in for the hidden column. */}
          <span
            className="tnum m-only"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "var(--accent)",
              whiteSpace: "nowrap",
            }}
          >
            <ChipGlyph size={12} />
            {t.config
              ? `${t.config.minBuyIn.toLocaleString()} - ${t.config.maxBuyIn.toLocaleString()}`
              : "-"}
          </span>
        </span>

        <span
          className="tnum m-hide"
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
          className="m-hide"
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
          className="row-cta"
          style={{
            justifySelf: "stretch",
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
  const PAGE = 15;
  const [shown, setShown] = useState(PAGE);

  // Where you actually stand, found before the list is cut down, so the pinned
  // row shows a true position rather than a position within the first page.
  const myIndex = me ? rows.findIndex((r) => r.authority === me) : -1;
  const mine = myIndex >= 0 ? rows[myIndex] : null;

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
          gridTemplateColumns: "26px minmax(0, 1fr) 30px auto",
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

      {/* You stay at the top whatever page is scrolled, showing your real
          position, so the board never has to be hunted through to find it. */}
      {mine && (
        <>
          <LeaderRowView row={mine} rank={myIndex} isMe />
          <div
            style={{
              height: 1,
              background: "var(--control)",
              opacity: 0.48,
              margin: "4px 0 6px",
            }}
          />
        </>
      )}

      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
            setShown((n) => Math.min(n + PAGE, rows.length));
          }
        }}
        style={{ maxHeight: "62vh", overflowY: "auto", overflowX: "hidden" }}
      >
        {rows.slice(0, shown).map((r, i) =>
          // Your row is pinned above, so it is not repeated in the list.
          r.authority === me ? null : (
            <LeaderRowView key={r.authority} row={r} rank={i} isMe={false} index={i} />
          ),
        )}
      </div>
    </div>
  );
}

function LeaderRowView({
  row,
  rank,
  isMe,
  index = 0,
}: {
  row: LeaderRow;
  rank: number;
  isMe: boolean;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring.gentle, delay: Math.min(index, 12) * stagger.list }}
      style={{
        display: "grid",
        gridTemplateColumns: "26px minmax(0, 1fr) 30px auto",
        gap: 12,
        alignItems: "center",
        height: 48,
      }}
    >
      <span
        className="tnum"
        style={{
          fontWeight: 700,
          fontSize: 14,
          color: isMe || rank < 3 ? "var(--accent)" : "var(--text-faint)",
        }}
      >
        {String(rank + 1).padStart(2, "0")}
      </span>
      <span
        style={{
          fontWeight: isMe ? 700 : 500,
          fontSize: 15,
          color: isMe ? "var(--accent)" : "var(--text-dim)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {isMe ? "you" : shortKey(row.authority)}
      </span>
      <Avatar pubkey={row.authority} size={30} square />
      <span
        className="tnum"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 500,
          fontSize: 15,
          color: "var(--accent)",
          justifyContent: "flex-end",
        }}
      >
        <ChipGlyph size={15} />
        {row.chips.toLocaleString()}
      </span>
    </motion.div>
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
        height: 48,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        background: "none",
        border: "none",
        borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
        color: active ? "var(--accent)" : "var(--text-dim)",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        cursor: "pointer",
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

/**
 * An action with its name beside it.
 *
 * The icon alone was a guessing game for anything that is not universal, so
 * everything outside the balance strip says what it does.
 */
function LabelButton({
  title,
  icon,
  onClick,
  solid = false,
}: {
  title: string;
  icon: React.ReactNode;
  onClick?: () => void;
  solid?: boolean;
}) {
  return (
    <motion.button
      className="m-btn"
      title={title}
      aria-label={title}
      onClick={onClick}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      transition={spring.snappy}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: 40,
        padding: "0 14px",
        border: "none",
        borderRadius: "var(--r-panel)",
        background: solid ? "var(--accent)" : "var(--surface)",
        color: solid ? "var(--on-accent)" : "var(--accent)",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        cursor: "pointer",
      }}
    >
      {icon}
      {title}
    </motion.button>
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
      className="m-icon"
      title={title}
      aria-label={title}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={spring.snappy}
      style={{
        width: 44,
        height: 44,
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
      <div style={{ display: "flex", gap: 8, margin: "4px 0 14px", flexWrap: "wrap" }}>
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
