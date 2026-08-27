"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { CreateTableModal } from "@/components/chrome/CreateTableModal";
import { SiteHeader } from "@/components/chrome/SiteHeader";
import { Orbs } from "@/components/chrome/Orbs";
import { SolanaMark } from "@/components/primitives/StackCredit";
import { LobbyGate } from "@/components/onboarding/LobbyGate";
import { Button } from "@/components/primitives/Button";
import { Modal, Skeleton } from "@/components/primitives/Surface";
import { ChipGlyph } from "@/components/primitives/Chip";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import {
  CashOutIcon,
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
import { displayName } from "@/lib/table-names";
import { useLobbyMeta, type TableTotals } from "@/hooks/use-lobby-meta";
import { useReadiness } from "@/hooks/use-readiness";
import { useUiStore } from "@/stores/ui-store";

/**
 * Stake tiers, mirrored from CreateTableModal's STAKES by big blind. A table
 * made outside these tiers (an older build, a custom config) still shows; it
 * simply matches only "All stakes".
 */
const TIERS = [
  { key: "micro", label: "Micro", sub: "$0.10 / $0.20", bb: 20 },
  { key: "low", label: "Low", sub: "$0.50 / $1", bb: 100 },
  { key: "high", label: "High", sub: "$2.50 / $5", bb: 500 },
] as const;

/** A stat tile: its name, its figure, and the window the figure covers. */
type Tile = [label: string, value: string, window?: string];

/**
 * Stands in for a figure nobody can answer yet. An en dash, not a zero and
 * not an em dash: it has to read as "no number here" without looking like a
 * number, and without becoming a piece of punctuation this product does not
 * use anywhere else.
 */
const DASH = "–";

export default function Lobby() {
  const { connected, publicKey } = useWallet();
  const { state, buy, sell, busy, affordable, buyBlocked, sellBlocked } = usePlayer();
  const [exchange, setExchange] = useState<"buy" | "sell" | null>(null);
  const { tables, loading, error, refresh: refreshTables } = useTables();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"players" | "mine">("players");
  const [tier, setTier] = useState<"all" | (typeof TIERS)[number]["key"]>("all");
  const meta = useLobbyMeta();
  // One source for who may sit down, shared with the gate so the two can
  // never disagree about what is still missing.
  const { ready } = useReadiness();
  const [openOnly, setOpenOnly] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);

  // How far back every stored figure on this page reaches. One phrase, used
  // by the tiles and by each card, so they can never quietly disagree.
  const since = meta.window === "24h" ? "past 24h" : "all time";

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

  const stats = useMemo(() => {
    const live = visible.filter((t) => t.delegated).length;
    const players = visible.reduce((n, t) => n + t.seated, 0);
    const seats = visible.reduce(
      (n, t) => n + (t.outdated ? 0 : MAX_SEATS - t.seated),
      0,
    );
    return { players, tables: visible.length, seats, live };
  }, [visible]);

  /*
   * The stat row: four tiles, and what has been PLAYED gets them.
   *
   * Volume, pot sizes and hand counts are what someone deciding whether to
   * sit down is actually asking about, and the chain cannot answer any of
   * them — hand accounts are reused, so a settled pot is gone the moment the
   * next hand starts. They come from hands clients reported and the server
   * re-verified.
   *
   * `meta.stored` is the switch, not the figures. Once a database has
   * answered, a count of zero hands is a fact about this room and gets said
   * out loud. Until then nothing is known at all, and the row falls back to
   * the live chain counts rather than inventing a zero or showing an empty
   * band. The two states look identical in the numbers and are completely
   * different claims, which is the whole reason the flag exists.
   *
   * A figure that stays unknowable inside a room that HAS been counted shows
   * a dash. An average pot over no observed pots is not zero, it is a
   * question nobody has answered yet.
   */
  const tiles = useMemo<Tile[]>(() => {
    if (!meta.stored) {
      return [
        ["Players seated", String(stats.players)],
        ["Active tables", String(stats.tables)],
        ["Open seats", String(stats.seats)],
        ["Hands live", String(stats.live)],
      ];
    }
    /*
     * Observed pots or a dash. Volume here means the money that actually went
     * through the pots — every pot of every reported hand, blinds-only steals
     * included — and a pot is only known when a client stayed open long
     * enough to report it. There used to be a rake-derived floor behind these
     * ("at least $X"), but a figure that moves only when the house gets paid
     * is a statement about rake wearing volume's label, so it is gone: the
     * tile says what was seen or says nothing.
     */
    const money = (observed: number | null): string =>
      observed !== null ? formatUsd(observed) : DASH;
    return [
      // The program's own counter, so this covers hands played before any of
      // the reporting existed. It carries no timestamps, so unlike the money
      // beside it there is no honest way to window it: it says "all time" even
      // when the rest of the row is showing a day.
      ["Hands", (meta.handsDealt ?? meta.hands ?? 0).toLocaleString(), "all time"],
      ["Volume", money(meta.volumeChips), since],
      ["Average pot", money(meta.avgPotChips), since],
      ["Biggest pot", money(meta.biggestPotChips), since],
    ];
  }, [meta, since, stats]);

  const filtered = useMemo(
    () =>
      visible.filter((t) => {
        if (tier !== "all") {
          const wanted = TIERS.find((x) => x.key === tier)?.bb;
          if (!t.config || t.config.bigBlind !== wanted) return false;
        }
        if (openOnly && !isJoinable(t)) return false;
        if (liveOnly && !t.delegated) return false;
        return true;
      }),
    [visible, tier, openOnly, liveOnly],
  );

  return (
    <>
      {/* Nobody enters without a wallet. The gate renders itself only while
          a step is unmet, so the ready path costs one null render. */}
      <LobbyGate />
      <SiteHeader />

      <main id="main" className="landing lobby-main">
        <Orbs />
        <div className="landing-inner">
          <header className="lobby-head">
            <div className="lobby-head-copy">
              <h1>Game lobby</h1>
              <p>Six-max no-limit hold&rsquo;em. Sit anywhere with an open seat.</p>
            </div>

            <div className="lobby-tools">
              {connected && (
                <>
                  {/* Your chips, with the way to get more built into the same
                      control, then the way to take them out. */}
                  <div className="lobby-chips glass">
                    <ChipGlyph size={20} />
                    <span className="num">
                      {state ? state.chips.toLocaleString() : "..."}
                    </span>
                    <motion.button
                      className="lobby-chips-add"
                      title="Buy chips"
                      aria-label="Buy chips"
                      onClick={() => setExchange("buy")}
                      whileTap={{ scale: 0.94 }}
                      transition={spring.snappy}
                    >
                      <PlusIcon size={15} />
                    </motion.button>
                  </div>
                  <IconButton
                    title="Cash out"
                    disabled={!state || state.chips === 0}
                    onClick={() => setExchange("sell")}
                  >
                    <CashOutIcon />
                  </IconButton>
                  {state && <SolGauge lamports={state.lamports} />}
                  <Button variant="primary" size="lg" onClick={() => setCreating(true)}>
                    <NewTableIcon size={16} />
                    Open a table
                  </Button>
                </>
              )}
              <IconButton title="Refresh" onClick={() => void refreshTables(true)}>
                <RefreshIcon />
              </IconButton>
            </div>
          </header>

          {/* Chips left on a seat are worth interrupting the layout for. */}
          {myTables.length > 0 && (
            <div className="lobby-return">
              {myTables.map((t) => (
                <Button
                  key={t.table.address}
                  href={`/table/${t.table.tableId}`}
                  variant="sol"
                  size="md"
                >
                  <TableIcon size={15} />
                  Return to {displayName(t.table.tableId, meta.names[String(t.table.tableId)])}
                </Button>
              ))}
            </div>
          )}

          <section className="lobby-stats" aria-label="Room activity">
            {/* The window is shown rather than assumed. The server hands back
                24h while there was play in it and all time otherwise, and a
                tile that said "24h" over an all-time figure would be a small,
                constant lie. */}
            {tiles.map(([label, value, note]) => (
              <div key={label} className="lobby-stat glass">
                <span className="label">
                  {label}
                  {note && <em className="lobby-stat-when">{note}</em>}
                </span>
                {/* A placeholder must not carry a real figure's weight, or
                    the row reads as four answers when one of them is a
                    shrug. */}
                <span
                  className={
                    value === DASH
                      ? "num lobby-stat-fig is-unknown"
                      : "num lobby-stat-fig"
                  }
                >
                  {value}
                </span>
              </div>
            ))}
          </section>

          <div className="lobby-grid">
            <aside className="lobby-filters" aria-label="Filters">
              <div className="lobby-filter-group glass">
                <h3 className="label">Stakes</h3>
                <label className="lobby-radio">
                  <input
                    type="radio"
                    name="tier"
                    checked={tier === "all"}
                    onChange={() => setTier("all")}
                  />
                  <span>All stakes</span>
                </label>
                {TIERS.map((s) => (
                  <label key={s.key} className="lobby-radio">
                    <input
                      type="radio"
                      name="tier"
                      checked={tier === s.key}
                      onChange={() => setTier(s.key)}
                    />
                    <span>
                      {s.label}
                      <em className="num">{s.sub}</em>
                    </span>
                  </label>
                ))}
              </div>

              <div className="lobby-filter-group glass">
                <h3 className="label">Status</h3>
                <label className="lobby-check">
                  <input
                    type="checkbox"
                    checked={openOnly}
                    onChange={(e) => setOpenOnly(e.target.checked)}
                  />
                  <span>With open seats</span>
                </label>
                <label className="lobby-check">
                  <input
                    type="checkbox"
                    checked={liveOnly}
                    onChange={(e) => setLiveOnly(e.target.checked)}
                  />
                  <span>Hand in progress</span>
                </label>
              </div>
            </aside>

            <section className="lobby-tables" aria-label="Tables">
              {loading ? (
                <div className="lobby-cards">
                  <Skeleton height={190} />
                  <Skeleton height={190} />
                  <Skeleton height={190} />
                  <Skeleton height={190} />
                </div>
              ) : error ? (
                <EmptyRow tone="var(--c-loss)">
                  <span>Could not reach the network.</span>
                  <Button variant="ghost" size="sm" onClick={() => void refreshTables()}>
                    Try again
                  </Button>
                </EmptyRow>
              ) : visible.length === 0 ? (
                <EmptyRow>
                  <TableIcon size={22} />
                  <span>Quiet right now.</span>
                  {connected && (
                    <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                      Open the first table
                    </Button>
                  )}
                </EmptyRow>
              ) : filtered.length === 0 ? (
                // Filtered-to-nothing is NOT the first-run void; say which
                // it is and how to get back.
                <EmptyRow>
                  <span>Nothing matches those filters.</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTier("all");
                      setOpenOnly(false);
                      setLiveOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                </EmptyRow>
              ) : (
                <div className="lobby-cards">
                  {filtered.slice(0, 24).map((t, i) => (
                    <motion.div
                      key={t.table.address}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring.gentle, delay: i * stagger.list }}
                    >
                      <TableCard
                        t={t}
                        registered={meta.names[String(t.table.tableId)]}
                        played={meta.tables[String(t.table.tableId)]}
                        since={since}
                        ready={ready}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            {/* Who is winning, and where you are sitting. */}
            <aside className="lobby-side" aria-label="Standings">
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
              <div style={{ height: 1, background: "var(--c-rule)" }} />
              {tab === "players" ? <Leaderboard me={me} /> : <MyTables tables={myTables} />}
            </aside>
          </div>
        </div>
      </main>

      <ExchangeModal
        mode={exchange}
        setMode={setExchange}
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

/**
 * A table as a place, not a row: generated name over real facts.
 *
 * Stakes, seats and liveness are read from chain. The name is deterministic
 * from the id (see table-names.ts) — labelling, never invented liveness. The
 * track record underneath is the only part that comes from the database, and
 * the whole line is absent for a table that has not been played yet: a new
 * table showing "0 hands" would read as a room being avoided rather than as
 * a room nobody has opened.
 */
function TableCard({
  t,
  registered,
  played,
  since,
  ready,
}: {
  t: LobbyTable;
  registered?: string;
  played?: TableTotals;
  since: string;
  ready: boolean;
}) {
  const joinable = isJoinable(t);
  const live = t.delegated;
  const openGate = useUiStore((s) => s.openGate);

  /*
   * A card is a link once the player can actually sit down, and a button that
   * summons the gate until then.
   *
   * Not a disabled card: a greyed-out room with no explanation is the exact
   * pattern this product's design rules forbid. The table stays inviting and
   * fully legible, and pressing it says what is still missing.
   */
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    ready ? (
      <Link href={`/table/${t.table.tableId}`} style={{ textDecoration: "none" }}>
        {children}
      </Link>
    ) : (
      <button
        type="button"
        className="table-card-locked"
        onClick={openGate}
        aria-label={`${displayName(t.table.tableId, registered)}: finish setting up to sit down`}
      >
        {children}
      </button>
    );

  return (
    <Wrapper>
      <motion.article
        className="table-card glass glow-hover"
        whileHover={{ y: -2 }}
        transition={spring.snappy}
      >
        <header className="table-card-head">
          {/* One line. The variant and the id said the same thing on every
              card, which is the definition of clutter; the full id survives in
              the hover title for anyone who needs to quote it. */}
          <h3 title={`#${String(t.table.tableId)}`}>
            {displayName(t.table.tableId, registered)}
          </h3>
          {t.house && !live && (
            <span className="table-card-house" title="Opened by the house, always here">
              house
            </span>
          )}
          {live && (
            <span className="table-card-live">
              <span className="table-card-live-dot animate-badge-pulse" aria-hidden />
              live
            </span>
          )}
        </header>

        {/* The two numbers a player chooses a table by, each behind a small
            mark instead of a caption. The words live on for hover and screen
            readers; the eye gets the figures. */}
        <div className="table-card-stats">
          <span
            className="tc-stat"
            title="Blinds"
            aria-label={`Blinds ${
              t.config
                ? `${formatUsd(t.config.smallBlind)} / ${formatUsd(t.config.bigBlind)}`
                : "unknown"
            }`}
          >
            <ChipGlyph size={13} />
            <b className="num">
              {t.config
                ? `${formatUsd(t.config.smallBlind)} / ${formatUsd(t.config.bigBlind)}`
                : "-"}
            </b>
          </span>
          <span
            className="tc-stat"
            title="Buy-in"
            aria-label={`Buy-in ${
              t.config ? formatUsdRange(t.config.minBuyIn, t.config.maxBuyIn) : "unknown"
            }`}
          >
            <BuyInMark />
            <b className="num">
              {t.config ? formatUsdRange(t.config.minBuyIn, t.config.maxBuyIn) : "-"}
            </b>
          </span>
        </div>

        {/* What has actually happened here — one quiet line on every card, so
            a room that has never dealt sits at the same height as one that
            has, and says so instead of saying nothing. */}
        <p className="table-card-log">
          {played?.hands ? (
            <>
              <span className="num">{played.hands.toLocaleString()}</span>{" "}
              {played.hands === 1 ? "hand" : "hands"} {since}
              {played.avgPotChips !== null && (
                <>
                  <span aria-hidden>&middot;</span> avg pot{" "}
                  <span className="num">{formatUsd(played.avgPotChips)}</span>
                </>
              )}
              {/* A live table's recency is the pulsing dot above; only a quiet
                  one needs telling how long it has been quiet. */}
              {!live && played.lastHandAt !== null && (
                <>
                  <span aria-hidden>&middot;</span> last {ago(played.lastHandAt)}
                </>
              )}
            </>
          ) : (
            <span className="table-card-log-quiet">no hands dealt yet</span>
          )}
        </p>

        <div className="table-card-foot">
          <span className="table-card-seats" aria-label={`${t.seated} of ${MAX_SEATS} seats taken`}>
            {Array.from({ length: MAX_SEATS }, (_, i) => (
              <i key={i} className={i < t.seated ? "is-taken" : undefined} />
            ))}
            <span className="num">
              {t.seated}/{MAX_SEATS}
            </span>
          </span>
          <span
            className={
              joinable && !live ? "table-card-cta is-join" : "table-card-cta"
            }
          >
            {live ? "Watch" : joinable ? "Join table" : "View"}
          </span>
        </div>
      </motion.article>
    </Wrapper>
  );
}

/**
 * The buy-in mark: three chips in a stack, drawn in the same line weight as
 * the chip glyph beside it. A caption said "Buy-in" in ten characters; the
 * stack says it in eleven pixels.
 */
function BuyInMark() {
  return (
    <svg aria-hidden width={13} height={13} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="8" cy="4.2" rx="5.6" ry="2.4" />
        <path d="M2.4 4.2v3.6c0 1.33 2.5 2.4 5.6 2.4s5.6-1.07 5.6-2.4V4.2" />
        <path d="M2.4 7.8v3.6c0 1.33 2.5 2.4 5.6 2.4s5.6-1.07 5.6-2.4V7.8" />
      </g>
    </svg>
  );
}

/**
 * How long ago, in the coarsest unit that still says something.
 *
 * Deliberately vague past an hour. The reading anyone takes from this is
 * "recently" or "not recently", and quoting "47 minutes" implies a precision
 * the figure does not have: it is the last hand a client managed to report,
 * not the last hand played.
 */
function ago(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
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
  setMode,
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
  setMode: (m: "buy" | "sell") => void;
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
  // The dollar field keeps its own text while it is being typed in, or the
  // derived value would rewrite the box mid-keystroke and eat the cursor.
  const [usdText, setUsdText] = useState("");
  const editingUsd = useRef(false);
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

  useEffect(() => {
    if (!editingUsd.current) setUsdText((clamped / 100).toFixed(2));
  }, [clamped]);
  // Until the balances land, every control here would be disabled with nothing
  // to explain why. Say so instead: a dead row of buttons reads as broken.
  const waiting = !ready;

  const chipField = (
    <label className="xchg-field" key="chips">
      <ChipGlyph size={17} />
      <input
        className="num"
        inputMode="numeric"
        aria-label={buying ? "Chips to buy" : "Chips to cash out"}
        value={clamped === 0 ? "" : String(clamped)}
        placeholder="0"
        disabled={max === 0}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^\d]/g, ""));
          setAmount(Number.isFinite(n) ? n : 0);
        }}
      />
    </label>
  );

  const usdField = (
    <label className="xchg-field" key="usd">
      <UsdcMark size={17} />
      <input
        className="num"
        inputMode="decimal"
        aria-label="Amount in USDC"
        value={usdText}
        placeholder="0.00"
        disabled={max === 0}
        onFocus={() => (editingUsd.current = true)}
        onBlur={() => {
          editingUsd.current = false;
          setUsdText((clamped / 100).toFixed(2));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setUsdText(t);
          const n = Number(t);
          if (Number.isFinite(n)) setAmount(Math.round(n * 100));
        }}
      />
    </label>
  );

  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      title="Chips"
    >
      {/* Buying and cashing out are the same dialog with the direction
          flipped, so they are tabs rather than two ways in. */}
      <div className="xchg-tabs" role="tablist" aria-label="Direction">
        <button
          type="button"
          role="tab"
          aria-selected={buying}
          className={buying ? "xchg-tab is-on" : "xchg-tab"}
          onClick={() => setMode("buy")}
        >
          Buy chips
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!buying}
          className={!buying ? "xchg-tab is-on" : "xchg-tab"}
          onClick={() => setMode("sell")}
        >
          Cash out
        </button>
      </div>

      <p className="xchg-balance">
        <ChipGlyph size={15} />
        <span className="num">{chips.toLocaleString()}</span> chips
        <span className="xchg-balance-sep" aria-hidden />
        <span className="num">{formatUsd(chips)}</span>
      </p>

      <div className="xchg-presets">
        {presets.map(([label, v]) => (
          <button
            key={label}
            type="button"
            className={clamped === v && v > 0 ? "xchg-preset is-on" : "xchg-preset"}
            aria-pressed={clamped === v && v > 0}
            disabled={max === 0}
            onClick={() => setAmount(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        Both sides are editable and each drives the other: some players think
        in chips, some in dollars, and neither should do the arithmetic.

        The LEFT field is always what you give up. Buying, that is USDC
        leaving the wallet; cashing out, it is chips leaving the table. The
        pair reads left to right as the trade actually happens, so the
        direction is legible without reading the tab.
      */}
      <div className="xchg-convert">
        {buying ? usdField : chipField}
        <span className="xchg-eq" aria-hidden>
          =
        </span>
        {buying ? chipField : usdField}
      </div>

      {/* The facts, as facts. This replaced a paragraph nobody read, and the
          SOL line stays because a wallet can hold plenty of dollars and still
          be unable to sit down. */}
      <ul className="xchg-facts">
        <li>
          Min <span className="num">{formatUsd(1)}</span>
        </li>
        <li>
          1 chip = <span className="num">{formatUsd(1)}</span>
        </li>
        <li>{buying ? "Fees in SOL" : "Table chips must be picked up first"}</li>
      </ul>

      {(waiting || blocked) && (
        <p role="status" className="xchg-status">
          {waiting ? "Checking your balance" : blocked}
        </p>
      )}

      <div className="xchg-actions">
        <Button
          variant="gradient"
          size="lg"
          fullWidth
          disabled={clamped === 0 || blocked !== null || waiting}
          loading={busy !== null}
          onClick={async () => {
            if (buying) await onBuy(clamped);
            else await onSell(clamped);
            onClose();
          }}
        >
          {buying ? `Buy for ${formatUsd(clamped)}` : `Cash out ${formatUsd(clamped)}`}
        </Button>
      </div>
    </Modal>
  );
}
