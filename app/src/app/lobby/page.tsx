"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CreateTableModal } from "@/components/chrome/CreateTableModal";
import { Button } from "@/components/primitives/Button";
import { Modal, Skeleton } from "@/components/primitives/Surface";
import { ChipGlyph } from "@/components/primitives/Chip";
import { ChipO, Logo } from "@/components/primitives/Logo";
import { SolanaMark, StackCredit } from "@/components/primitives/StackCredit";
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
  UsdcMark,
} from "@/components/primitives/Icons";
import { usePlayer } from "@/hooks/use-player";
import { useLeaderboard, type LeaderRow } from "@/hooks/use-leaderboard";
import { isJoinable, useTables, type LobbyTable } from "@/hooks/use-tables";
import { spring, stagger } from "@/styles/theme";
import { MAX_SEATS, PLAY_FLOOR_LAMPORTS } from "@/lib/constants";
import { formatUsd, formatUsdRange } from "@/lib/money";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false, loading: () => <div style={{ width: 150, height: 48 }} /> },
);

export default function Lobby() {
  const { connected, publicKey } = useWallet();
  const { state, buy, sell, busy, affordable, buyBlocked, sellBlocked } = usePlayer();
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

  // Whether this wallet can actually sit down. Drives what the table area
  // shows: a room list is no use to someone who cannot join one yet.
  const notReady =
    connected &&
    state !== null &&
    !(state.lamports >= PLAY_FLOOR_LAMPORTS && state.chips > 0);

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
              <div style={{ marginRight: "auto" }}>
                <h1
                  style={{
                    display: "flex",
                    alignItems: "center",
                    // The mark scales with the name rather than sitting at a
                    // fixed size, so the pair holds together from a phone to a
                    // desktop.
                    gap: "clamp(10px, 1.2vw, 16px)",
                    fontSize: "clamp(34px, 4vw, 52px)",
                    color: "var(--c-green)",
                    // Dela Gothic sets very tight at display size and the name
                    // was reading as one dense block. A little air lets the
                    // letters — and the chip standing in for the 'o' — be read
                    // as separate shapes.
                    letterSpacing: "0.02em",
                  }}
                >
                  <span className="wordmark-solana" style={{ whiteSpace: "nowrap" }}>
                    P
                    <ChipO />
                    kerable
                  </span>
                </h1>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: "var(--t-body-sm-size)",
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--c-ink-muted)",
                  }}
                >
                  Play poker with stablecoins
                </p>
                <StackCredit />
              </div>

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
                      background: "var(--c-felt-raised)",
                      borderRadius: "var(--r-lg)",
                      padding: "0 5px 0 12px",
                      height: 44,
                    }}
                  >
                    <ChipGlyph size={22} />
                    <span
                      className="num"
                      style={{ fontWeight: 700, fontSize: 16, color: "var(--c-ink-muted)" }}
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
                        borderRadius: "var(--r-lg)",
                        background: "var(--c-green)",
                        color: "var(--c-felt)",
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

              {/* SOL is not what a chip is made of, but it is what every
                  transaction costs, and a wallet can hold plenty of dollars and
                  still be unable to sit down.

                  Two states, and they say different things on purpose. When
                  there is enough, the balance is a quiet fact and gets out of
                  the way. When there is not, the balance is the wrong number to
                  show — what you need is the shortfall, because that is the
                  amount you are about to go and send. "Top up to play" made
                  someone work that out for themselves. */}
              {connected && state && <SolGauge lamports={state.lamports} />}

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
              color: "var(--c-ink-muted)",
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
            <EmptyRow tone="var(--c-loss)">
              <span>Could not reach the network.</span>
              <Button variant="ghost" size="sm" onClick={() => void refreshTables()}>
                Try again
              </Button>
            </EmptyRow>
          ) : notReady && state ? (
            <GetReady state={state} onDeposit={() => setExchange("buy")} />
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
          <div style={{ height: 1, background: "var(--c-felt-edge)", opacity: 0.48 }} />

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
        blocked={exchange === "buy" ? buyBlocked : sellBlocked}
        ready={state !== null}
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
        whileHover={{ backgroundColor: "var(--c-felt-raised)" }}
        transition={spring.snappy}
        style={{
          display: "grid",
          gridTemplateColumns: "var(--lobby-cols)",
          gap: "var(--lobby-gap)",
          alignItems: "center",
          padding: "0 8px",
          borderRadius: "var(--r-lg)",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            className="num"
            style={{ fontWeight: 500, fontSize: 18, color: "var(--c-ink-muted)" }}
          >
            {t.config ? `${t.config.smallBlind} / ${t.config.bigBlind}` : "-"}
          </span>
          <span
            className="tnum m-hide"
            style={{ fontSize: 11, color: "var(--c-ink-faint)" }}
          >
            {t.table.tableId}
          </span>
          {/* The phone's buy-in line, standing in for the hidden column. */}
          <span
            className="num m-only"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "var(--c-green)",
              whiteSpace: "nowrap",
            }}
          >
            <ChipGlyph size={12} />
            {t.config
              ? `${t.config.minBuyIn.toLocaleString()} - ${t.config.maxBuyIn.toLocaleString()}`
              : "-"}
          </span>
        </span>

        {/* Chips are the unit at the table, but nobody arrives knowing what a
            chip is worth. The money goes underneath, quietly, so the row can
            still be read at a glance. */}
        <span className="m-hide" style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span
            className="num"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontWeight: 500,
              fontSize: 18,
              color: "var(--c-green)",
            }}
          >
            <ChipGlyph size={17} />
            {t.config
              ? `${t.config.minBuyIn.toLocaleString()} - ${t.config.maxBuyIn.toLocaleString()}`
              : "-"}
          </span>
          {t.config && (
            <span
              className="num"
              style={{ fontSize: "var(--t-label-size)", color: "var(--c-ink-muted)", paddingLeft: 25 }}
            >
              {formatUsdRange(t.config.minBuyIn, t.config.maxBuyIn)}
            </span>
          )}
        </span>

        <span
          className="m-hide"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: "var(--c-green)",
            fontWeight: 500,
            fontSize: 18,
          }}
        >
          <span style={{ color: "var(--c-ink-muted)", opacity: 0.8 }}>
            <TableIcon size={22} />
          </span>
          {MAX_SEATS}
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            color: "var(--c-green)",
            fontWeight: 500,
            fontSize: 18,
          }}
        >
          <span style={{ color: "var(--c-ink-muted)", opacity: 0.8 }}>
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
            borderRadius: "var(--r-lg)",
            background:
              joinable && !live
                ? "var(--c-green)"
                : "color-mix(in srgb, var(--c-green) 8%, transparent)",
            color: joinable && !live ? "var(--c-felt)" : "var(--c-green)",
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
          color: "var(--c-ink-muted)",
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
              background: "var(--c-felt-edge)",
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
        className="num"
        style={{
          fontWeight: 700,
          fontSize: 14,
          color: isMe || rank < 3 ? "var(--c-green)" : "var(--c-ink-faint)",
        }}
      >
        {String(rank + 1).padStart(2, "0")}
      </span>
      <span
        style={{
          fontWeight: isMe ? 700 : 500,
          fontSize: 15,
          color: isMe ? "var(--c-green)" : "var(--c-ink-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {isMe ? (
          "you"
        ) : (
          <span style={{ fontFamily: "var(--font-mono)" }}>{shortKey(row.authority)}</span>
        )}
      </span>
      <Avatar pubkey={row.authority} size={30} square />
      <span
        className="num"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontWeight: 700,
          fontSize: 15,
          color: "var(--c-ink)",
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
            <span className="num" style={{ fontSize: 17, color: "var(--c-ink-muted)" }}>
              {t.config ? `${t.config.smallBlind} / ${t.config.bigBlind}` : "-"}
            </span>
            <span style={{ color: "var(--c-green)" }}>
              <TableIcon size={22} />
            </span>
            <span
              className="num"
              style={{ fontSize: 17, color: "var(--c-green)", textAlign: "right" }}
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
        color: "var(--c-ink-muted)",
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
        color: "var(--c-ink-faint)",
        opacity: 0.5,
      }}
    >
      {icon}
    </div>
  );
}

function EmptyRow({
  children,
  tone = "var(--c-ink-muted)",
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
        borderBottom: "2px solid transparent",
        borderBottomColor: active ? "var(--c-green)" : "transparent",
        color: active ? "var(--c-ink)" : "var(--c-ink-muted)",
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
        borderRadius: "var(--r-lg)",
        background: solid ? "var(--c-green)" : "var(--c-felt-raised)",
        color: solid ? "var(--c-felt)" : "var(--c-green)",
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

/**
 * What to do before you can sit down, in the place the lobby already puts
 * prompts.
 *
 * This used to be a stepper floating above the room list, and it never sat
 * right: a checkout wizard is a pattern for walking through pages, and it was
 * occupying a region the lobby does not otherwise have, restating balances the
 * header pills already show. So it stopped being a region. A room list is no
 * use to someone who cannot join a room, so when the wallet is not ready this
 * *is* the table area — same centred shape, same icon-sentence-button rhythm
 * as "No rooms yet", which is the lobby's own way of saying "nothing here, do
 * this".
 *
 * The three marks survive as a footnote underneath rather than the headline.
 * They answer "how much further" for anyone who wonders; the sentence above
 * answers "what now", which is what almost everyone actually wants.
 */
function GetReady({
  state,
  onDeposit,
}: {
  state: { lamports: number; microUsdc: number; chips: number };
  onDeposit: () => void;
}) {
  const gasOk = state.lamports >= PLAY_FLOOR_LAMPORTS;
  const usdcOk = state.microUsdc > 0 || state.chips > 0;
  const chipsOk = state.chips > 0;
  const short = Math.ceil(((PLAY_FLOOR_LAMPORTS - state.lamports) / 1e9) * 1000) / 1000;

  const step = !gasOk
    ? {
        icon: <SolanaMark size={20} />,
        line: (
          <>
            Add <span className="num">{short.toFixed(3)}</span> SOL to cover network fees
          </>
        ),
        action: null as React.ReactNode,
        note: "Solana charges fees in SOL, not USDC. Most of it comes back.",
      }
    : !usdcOk
      ? {
          icon: <UsdcMark size={20} />,
          line: <>Get some USDC to play with</>,
          action: (
            <a
              href="https://jup.ag/swap/SOL-USDC"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "none" }}
            >
              <Button variant="primary" size="sm">
                Swap SOL for USDC
              </Button>
            </a>
          ),
          note: "Or send USDC here from an exchange.",
        }
      : {
          icon: <ChipGlyph size={20} />,
          line: (
            <>
              Turn your <span className="num">${(state.microUsdc / 1e6).toFixed(2)}</span> into chips
            </>
          ),
          action: (
            <Button variant="primary" size="sm" onClick={onDeposit}>
              Buy chips
            </Button>
          ),
          note: "A cent a chip, and the same rate back out.",
        };

  const marks = [gasOk, usdcOk, chipsOk];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        minHeight: 128,
        padding: "26px 16px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 14,
          flexWrap: "wrap",
          color: "var(--c-ink-muted)",
          fontSize: 15,
        }}
      >
        {step.icon}
        <span>{step.line}</span>
        {step.action}
      </div>

      <span style={{ fontSize: "var(--t-label-size)", color: "var(--c-ink-faint)" }}>{step.note}</span>

      {/* How much further, as a footnote. */}
      <div
        aria-label={`Step ${marks.filter(Boolean).length + 1} of 3`}
        style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}
      >
        {marks.map((done, i) => (
          <span
            key={i}
            style={{
              width: done ? 14 : 6,
              height: 6,
              borderRadius: 3,
              background: done ? "var(--c-win)" : "var(--c-rule-strong)",
              opacity: done ? 0.55 : 1,
              transition: "width var(--m-base) var(--m-ease)",
            }}
          />
        ))}
      </div>
    </div>
  );
}


/**
 * What the wallet holds in SOL, and — when that is not enough — exactly how
 * much more to send.
 *
 * The shortfall is rounded up to the thousandth. Quoting the precise deficit
 * would have someone send it and land a hair short.
 */
function SolGauge({ lamports }: { lamports: number }) {
  const ok = lamports >= PLAY_FLOOR_LAMPORTS;
  const short = Math.ceil(((PLAY_FLOOR_LAMPORTS - lamports) / 1e9) * 1000) / 1000;

  return (
    <div
      title={
        ok
          ? "Enough SOL for network fees and a session key"
          : `Sitting down costs about ${(PLAY_FLOOR_LAMPORTS / 1e9).toFixed(3)} SOL in fees and session float. Most of it comes back when the session is swept.`
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 44,
        padding: ok ? "0 12px" : "0 14px",
        borderRadius: "var(--r-lg)",
        background: ok ? "transparent" : "var(--c-felt-raised)",
        border: ok ? "1px solid transparent" : "1px solid var(--c-info)",
        fontSize: "var(--t-body-sm-size)",
        whiteSpace: "nowrap",
        color: ok ? "var(--c-ink-faint)" : "var(--c-info)",
      }}
    >
      <SolanaMark size={12} />
      {ok ? (
        <span className="num">{(lamports / 1e9).toFixed(3)}</span>
      ) : (
        <span>
          Add <span className="num">{short.toFixed(3)}</span> to play
        </span>
      )}
    </div>
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
        borderRadius: "var(--r-lg)",
        background: solid ? "var(--c-green)" : "var(--c-felt-raised)",
        color: solid ? "var(--c-felt)" : "var(--c-green)",
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </motion.button>
  );
}

/**
 * Buying chips and cashing out.
 *
 * The one screen where the currency has to be unambiguous, so it says USDC in
 * as many ways as it can without nagging: in the title, on the badge beside the
 * amount, and in the line that names what leaves or arrives. The dollar figure
 * is the large number and the chip count is the small one, because dollars are
 * what a person is deciding about.
 */
function ExchangeModal({
  mode,
  onClose,
  chips,
  affordable,
  busy,
  onBuy,
  onSell,
  blocked,
  ready,
}: {
  mode: "buy" | "sell" | null;
  onClose: () => void;
  chips: number;
  affordable: number;
  busy: "buy" | "sell" | null;
  onBuy: (chips: number) => Promise<void>;
  onSell: (chips: number) => Promise<void>;
  blocked: string | null;
  ready: boolean;
}) {
  const [amount, setAmount] = useState(0);
  const buying = mode === "buy";
  const max = buying ? affordable : chips;
  const clamped = Math.min(Math.max(amount, 0), max);

  // Presets scaled to what this wallet actually has, not a fixed ladder.
  // Cashing out $4.60 used to offer $10 / $50 / $100 and disable all three,
  // which is a row of buttons whose only message is that you cannot afford
  // anything. Quarter, half, all — always reachable, always meaningful.
  const presets: [string, number][] = [
    ["25%", Math.floor(max * 0.25)],
    ["Half", Math.floor(max * 0.5)],
    ["Max", max],
  ];

  // Open at something sensible rather than at zero with a dead CTA.
  useEffect(() => {
    if (mode) setAmount(max);
  }, [mode, max]);
  // Until the balances land, every control here would be disabled with nothing
  // to explain why. Say so instead: a dead row of buttons reads as broken.
  const waiting = !ready;

  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      title={buying ? "Buy chips with USDC" : "Cash out to USDC"}
    >
      {/* The headline figure: dollars first, chips underneath. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          padding: "var(--sp-4)",
          marginBottom: "var(--sp-4)",
          background: "var(--c-felt-raised)",
          borderRadius: "var(--r-lg)",
          border: "1px solid var(--c-rule)",
        }}
      >
        <UsdcMark size={34} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            className="num"
            style={{
              fontSize: "var(--t-display-lg-size)",
              fontWeight: 600,
              color: "var(--c-ink)",
              lineHeight: 1.05,
            }}
          >
            {formatUsd(clamped)}
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--t-body-sm-size)",
              color: "var(--c-ink-muted)",
            }}
          >
            <ChipGlyph size={13} />
            <span className="num">{clamped.toLocaleString()}</span> chips
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-3)", flexWrap: "wrap" }}>
        {presets.map(([label, v]) => (
          <Button
            key={label}
            size="sm"
            variant={clamped === v && v > 0 ? "primary" : "ghost"}
            disabled={max === 0}
            onClick={() => setAmount(v)}
          >
            {label}
          </Button>
        ))}
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(max, 1)}
        step={1}
        value={clamped}
        disabled={max === 0}
        aria-label={buying ? "Chips to buy" : "Chips to cash out"}
        onChange={(e) => setAmount(Number(e.target.value))}
        style={{ width: "100%", marginBottom: "var(--sp-4)" }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--sp-2)",
          color: "var(--c-ink-muted)",
          fontSize: "var(--t-body-sm-size)",
        }}
      >
        <span>{buying ? "You pay" : "You receive"}</span>
        <span className="num" style={{ color: "var(--c-ink)", fontWeight: 600 }}>
          {formatUsd(clamped)} USDC
        </span>
      </div>

      {/* Said once, quietly, so nobody meets it for the first time in a
          failed signature. */}
      <p
        style={{
          margin: "0 0 var(--sp-4)",
          fontSize: "var(--t-label-size)",
          color: "var(--c-ink-faint)",
          lineHeight: 1.5,
        }}
      >
        {buying
          ? `Chips are backed one for one by the USDC you deposit, at a cent a chip. Solana charges its fees in SOL, not USDC — keep at least ${(PLAY_FLOOR_LAMPORTS / 1e9).toFixed(3)} SOL here, or you will be able to buy chips and not sit down with them.`
          : "Cashing out returns USDC to this wallet at the same cent a chip. Chips on a table have to be picked up first."}
      </p>

      {(waiting || blocked) && (
        <p
          role="status"
          style={{
            margin: "0 0 var(--sp-4)",
            padding: "var(--sp-3)",
            borderRadius: "var(--r-md)",
            background: "var(--c-felt-raised)",
            borderLeft: "2px solid var(--c-info)",
            fontSize: "var(--t-body-sm-size)",
            color: "var(--c-ink-muted)",
            lineHeight: 1.5,
          }}
        >
          {waiting ? "Checking your balance…" : blocked}
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button
          variant="primary"
          disabled={clamped === 0 || blocked !== null || waiting}
          loading={busy !== null}
          onClick={async () => {
            if (buying) await onBuy(clamped);
            else await onSell(clamped);
            onClose();
          }}
        >
          {buying ? `Buy chips for ${formatUsd(clamped)}` : `Cash out ${formatUsd(clamped)}`}
        </Button>
        <Button variant="quiet" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
