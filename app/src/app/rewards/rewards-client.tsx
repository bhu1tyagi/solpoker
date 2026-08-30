"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import {
  CloseIcon,
  ExpandIcon,
  TrophyIcon,
  UsdcMark,
  ZapIcon,
} from "@/components/primitives/Icons";
import { LineChart, type Series } from "@/components/charts/LineChart";
import {
  BoardSkeleton,
  ChartCardSkeleton,
  FigSkeleton,
  Loading,
} from "@/components/primitives/Skeletons";
import { Skeleton } from "@/components/primitives/Surface";
import { useRewards, type RewardRow } from "@/hooks/use-rewards";
import { chipsToUsd, formatSignedUsd, formatUsd } from "@/lib/money";
import {
  AIRDROP_RAKE_SHARE_BPS,
  AIRDROP_TOKEN_FEE_SHARE_BPS,
  MIN_ELIGIBLE_RAKE_CHIPS,
  REWARDS_BOARD_SIZE,
  pct,
} from "@/lib/rewards";
import { useUiStore } from "@/stores/ui-store";

/**
 * Rewards: what the rake you generate is worth when a token exists.
 *
 * Rebuilt around one number. The page previously ran heading, paragraph, three
 * tiles, heading, paragraph, three identical tiles — the same block twice, with
 * six paragraphs between them and nothing carrying the point. Everything was
 * the same weight, so nothing read as the answer.
 *
 * Now the pool is a hero figure with the rest supporting it, the accrual is a
 * chart because it is the one thing here that changes over time, and the terms
 * are a short definition list rather than prose. Personal performance stays on
 * the profile: this page answers "what am I owed, and why", and the answer is
 * rake.
 *
 * The honest-state rules are unchanged. Every figure is a share of rake ALREADY
 * COLLECTED — no projection, no target, no date, because the token does not
 * exist yet.
 */

const usdAxis = (chips: number) => {
  const usd = chipsToUsd(chips);
  return usd >= 1000 ? `$${(usd / 1000).toFixed(1)}k` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
};

/** The x axis: how many recorded hands the pool has been built from. */
const handsAxis = (n: number) =>
  `${n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString("en-US")} hands`;

/** How long the figures have been counting. */
function since(at: number | null): string {
  if (!at) return "the first recorded hand";
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function Fig({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div className="fig">
      <span className="fig-label">{label}</span>
      <span className={value === null ? "fig-val is-unknown" : "fig-val"}>
        {value ?? "Not recorded yet"}
      </span>
      {note && <span className="fig-note">{note}</span>}
    </div>
  );
}

/**
 * One row of a board. Rank one carries the glow, and only rank one: a board
 * where every row glows has no first place. The rank number is the second cue.
 */
function BoardRow({
  row,
  rank,
  isMe,
  unit,
}: {
  row: RewardRow;
  rank: number;
  isMe: boolean;
  unit: string;
}) {
  const classes = ["rewards-row"];
  if (isMe) classes.push("rewards-row-me");
  if (rank === 1) classes.push("rewards-row-top");
  return (
    <div className={classes.join(" ")}>
      <span className="rewards-rank">{rank}</span>
      <Avatar pubkey={row.wallet} size={28} />
      {/* A name never stands alone; the address rides beside it on every row. */}
      <span className="rewards-wallet">
        {row.displayName && (
          <span className="rewards-display-name">{row.displayName}</span>
        )}
        {isMe && <span className="rewards-you-tag">You</span>}
        <span className="rewards-addr">{shortKey(row.wallet)}</span>
      </span>
      <span className="rewards-row-fig">
        {formatUsd(row.chips)}
        <span className="rewards-row-unit">{unit}</span>
      </span>
    </div>
  );
}

function Board({
  rows,
  me,
  unit,
  emptyLine,
  limit,
}: {
  rows: RewardRow[];
  me: string | null;
  unit: string;
  emptyLine: string;
  /**
   * Show exactly this many and offer no pager — the cropped board on the card.
   * Passed rather than slicing at the call site so the off-board pin below
   * still measures the reader's position against the WHOLE list: "rank 40" is
   * only true if rank 40 was counted.
   */
  limit?: number;
}) {
  const PAGE = 10;
  const [shown, setShown] = useState(PAGE);

  if (rows.length === 0) {
    return (
      <div className="rewards-empty">
        <TrophyIcon size={24} />
        <p>{emptyLine}</p>
      </div>
    );
  }

  // Found before the list is cut down, so a pinned row shows a true position.
  const myIndex = me ? rows.findIndex((r) => r.wallet === me) : -1;
  const mine = myIndex >= 0 ? rows[myIndex] : null;
  const cut = limit ?? shown;
  const offBoard = mine && myIndex >= cut;

  return (
    <div>
      {offBoard && (
        <>
          <BoardRow row={mine} rank={myIndex + 1} isMe unit={unit} />
          <div className="rewards-row-split" />
        </>
      )}
      {rows.slice(0, cut).map((r, i) => (
        <BoardRow key={r.wallet} row={r} rank={i + 1} isMe={r.wallet === me} unit={unit} />
      ))}
      {limit === undefined && shown < rows.length && (
        <div className="rewards-more">
          {/* Also `lg`. It is under the 44px floor at `md`, and it only
              escaped the check because no board here has passed ten rows
              yet — the modal will show it far more often. */}
          <Button variant="quiet" size="lg" onClick={() => setShown((s) => s + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

/** How many rows a board shows on the card before it has to be opened. */
const BOARD_PREVIEW = 5;

/**
 * A board on the card: its head, its first few rows, and a way to see the rest.
 *
 * Cropped rather than scrolled. Two boards stacked beside a chart cannot both
 * run to twenty rows without the column becoming the page, and the rows past
 * the head are the ones nobody reads in place — so the card shows the head and
 * the full list opens over the page.
 */
function BoardCard({
  title,
  hint,
  unit,
  icon,
  rows,
  me,
  emptyLine,
}: {
  title: string;
  hint: string;
  unit: string;
  icon: React.ReactNode;
  rows: RewardRow[];
  me: string | null;
  emptyLine: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rewards-board">
      <div className="rewards-board-head">
        {icon}
        <h3>{title}</h3>
        <span>{hint}</span>
        {/*
          Always here, not only when the list is longer than the card.
          It used to appear at six rows and up, which meant that on a board
          with three players it was simply missing and there was no way to
          open anything — an affordance that comes and goes is one nobody
          learns. Opening a short board is still worth doing: the card crops
          to whatever height the row gives it, so "all of it" is a real
          difference at any length.
        */}
        <button
          type="button"
          className="rewards-board-expand"
          onClick={() => setOpen(true)}
          aria-label={`Open ${title} in full — ${rows.length} ${
            rows.length === 1 ? "player" : "players"
          }`}
        >
          <ExpandIcon size={17} />
        </button>
      </div>

      {/*
        The rows scroll inside the card rather than setting its height.
        Both boards are held to the same height and that height comes from the
        chart beside them, so the list has to fit whatever it is given.
      */}
      <div className="rewards-board-rows">
        <Board rows={rows} me={me} unit={unit} emptyLine={emptyLine} limit={BOARD_PREVIEW} />
      </div>

      {open && (
        <BoardModal
          title={title}
          hint={hint}
          unit={unit}
          icon={icon}
          rows={rows}
          me={me}
          emptyLine={emptyLine}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}

/**
 * The whole board, over the page.
 *
 * Built on the same three rules the wallet gate uses, because a second kind of
 * dialog in one product is a second set of ways to be trapped in one: the
 * ground behind it closes it, Escape closes it, and focus moves inside when it
 * opens so a keyboard is not left behind on the page underneath.
 */
function BoardModal({
  title,
  hint,
  unit,
  icon,
  rows,
  me,
  emptyLine,
  onClose,
}: {
  title: string;
  hint: string;
  unit: string;
  icon: React.ReactNode;
  rows: RewardRow[];
  me: string | null;
  emptyLine: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const reduce = useReducedMotion();

  // The page behind it must not scroll under it.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="gate-scrim" onClick={onClose}>
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="board-modal glass glass-blur"
        onClick={(e) => e.stopPropagation()}
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
      >
        <header className="board-modal-head">
          {icon}
          <h2 id={headingId}>{title}</h2>
          <span>{hint}</span>
          <button
            type="button"
            className="board-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        {/* The list scrolls inside the dialog, so the head and the close stay
            put however long the board is. */}
        <div className="board-modal-body">
          <Board rows={rows} me={me} unit={unit} emptyLine={emptyLine} />
        </div>
      </motion.div>
    </div>
  );
}

export function RewardsClient() {
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const openGate = useUiStore((s) => s.openGate);

  useEffect(() => setMounted(true), []);

  const me = mounted && connected && publicKey ? publicKey.toBase58() : null;
  const data = useRewards(me);
  const loading = !data.loaded;
  const you = data.you;
  const known = data.stored;

  /*
   * Hands recorded, not the calendar — the same axis the profile uses, for the
   * same reason: the pool grows when hands are played, not when time passes.
   * A quiet week should be absent from the shape rather than drawn as a long
   * flat stretch. The dates stay in the tooltip.
   */
  /*
 * A cumulative chart starts at nothing.
 *
 * The first stored point is the end of the first day played, which on a busy
 * opening session is already a hundred hands in — so the line began partway up
 * with no visible climb, and the axis started at "120 hands" as though the
 * first hundred had happened somewhere off-screen. Prepending a zero is not
 * invented data: before a hand is played, every cumulative figure IS zero. The
 * one exception is caller's own rake, which stays null when there is no wallet to draw.
 */
  const chart = useMemo(() => {
    const raw = data.series;
    if (raw.length === 0) return [];
    const first = raw[0];
    return [
      { at: first.at, hands: 0, rake: 0, pool: 0, yours: first.yours === null ? null : 0 },
      ...raw,
    ];
  }, [data.series]);

  const points = useMemo(() => chart.map((p) => p.hands), [chart]);
  const pointLabels = useMemo(
    () =>
      chart.map((p, i) =>
        i === 0
          ? "before any hands"
          : new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      ),
    [chart],
  );
  const series: Series[] = useMemo(() => {
    const s = chart;
    const out: Series[] = [
      { key: "pool", label: "Player pool", color: "--c-series1", values: s.map((p) => p.pool) },
      { key: "rake", label: "Rake collected", color: "--c-series4", values: s.map((p) => p.rake) },
    ];
    // Only when there is something of the reader's own to draw.
    if (s.some((p) => p.yours !== null && p.yours > 0)) {
      out.push({
        key: "yours",
        label: "Your rake",
        color: "--c-series2",
        values: s.map((p) => p.yours),
      });
    }
    return out;
  }, [chart]);

  const worth =
    known && you?.shareBps != null
      ? Math.floor(((data.poolChips ?? 0) * you.shareBps) / 10_000)
      : null;

  if (loading) {
    /*
     * The page's shape, not a placeholder for part of it: the hero and its
     * eight figures on one row, then the chart with the two boards stacked
     * beside it — at the widths they land at, so nothing moves when the data
     * arrives.
     */
    return (
      <Loading label="Loading the player pool">
        <div className="profile-top pool-hero">
          <div className="profile-top-main pool-hero-main">
            <Skeleton width="45%" height={11} />
            <Skeleton width="72%" height={48} />
            <Skeleton width="86%" height={13} />
          </div>
          <div className="profile-figs figs-column pool-figs">
            {Array.from({ length: 8 }, (_, i) => (
              <FigSkeleton key={i} />
            ))}
          </div>
        </div>
        <div className="rewards-mid">
          <ChartCardSkeleton chips={3} />
          <div className="rewards-boards-shell">
            <div className="rewards-boards-stack">
              <BoardSkeleton rows={BOARD_PREVIEW} />
              <BoardSkeleton rows={BOARD_PREVIEW} />
            </div>
          </div>
        </div>
      </Loading>
    );
  }

  return (
    <>
      {/* ------------------------------------------------------ the pool --- */}
      {/*
        A hero number, because the page has exactly one headline and it was
        previously the same size as five other figures. The supporting facts
        sit beside it rather than competing with it.
      */}
      {/*
        The same top row the profile uses: the headline on the left, and every
        supporting figure in one dense block on the right.

        All eight live here now — four about the pool, four about you. They
        used to be split across the page with the personal four stranded in a
        row of their own, and they are the same kind of thing read in the same
        glance. Each personal card says "your" in its own label, so the block
        needs no headings to say which half is which.

        The headline column is narrower than it was. It holds one number and a
        line of type, and at 1.4fr the right of it was empty while the figures
        were cramped; the space belongs to whichever side has more in it.
      */}
      <section className="profile-top pool-hero" aria-labelledby="pool-head">
        <div className="profile-top-main pool-hero-main">
          <h2 id="pool-head" className="fig-label">
            Player pool so far
          </h2>
          <p className="pool-hero-fig">
            {known ? formatUsd(data.poolChips ?? 0) : "Not recorded yet"}
          </p>
          {/* The rule and the start date. The amount it is a share OF has its
              own card, so this sentence no longer states it twice. */}
          <p className="pool-hero-sub">
            {pct(AIRDROP_RAKE_SHARE_BPS)} of every raked pot, since {since(data.since)}
          </p>
        </div>

        <div className="profile-figs figs-column pool-figs">
          <Fig
            label="Rake collected"
            value={known ? formatUsd(data.rakeChips ?? 0) : null}
            note="across every table"
          />
          <Fig
            label="Players sharing it"
            value={known ? String(data.contributors ?? 0) : null}
            note={`past ${formatUsd(MIN_ELIGIBLE_RAKE_CHIPS)} of rake`}
          />
          <Fig
            label="Hands recorded"
            value={known ? String(data.handsRecorded ?? 0) : null}
            note="proved against the chain"
          />
          <Fig
            label="Token fees"
            value={pct(AIRDROP_TOKEN_FEE_SHARE_BPS)}
            note="join the pool at launch"
          />

          {/*
            Your four, or the one thing standing between you and them. The
            prompt spans the whole second row rather than sitting in the first
            slot, so the block stays a rectangle in every state.
          */}
          {!me ? (
            <div className="fig fig-span rewards-connect-inline">
              <UsdcMark size={24} />
              <p>Connect a wallet to see your share of the pool.</p>
              {/* `lg`, not `md`: md is 40px and this is a real control on a
                  page, so it has to clear the 44px floor like any other. */}
              <Button variant="primary" size="lg" onClick={() => openGate()}>
                Connect wallet
              </Button>
            </div>
          ) : known && you && you.rakeChips === 0 ? (
            <div className="fig fig-span rewards-connect-inline">
              <ZapIcon size={22} />
              <p>No rake yet. A share builds from your first raked pot.</p>
              <Button href="/lobby" variant="quiet" size="lg">
                Find a seat
              </Button>
            </div>
          ) : (
            <>
              <Fig
                label="Your rake"
                value={known ? formatUsd(you?.rakeChips ?? 0) : null}
                note={you && you.rakeChips > 0 ? `rank ${you.rakeRank} by rake` : undefined}
              />
              <Fig
                label="Your share"
                value={
                  known && you?.shareBps != null
                    ? `${(you.shareBps / 100).toFixed(2)}%`
                    : known
                      ? "Not yet"
                      : null
                }
                note={
                  you?.shareBps == null
                    ? `needs ${formatUsd(MIN_ELIGIBLE_RAKE_CHIPS)} of rake`
                    : "of the players' pool"
                }
              />
              <Fig
                label="Worth so far"
                value={worth === null ? (known ? "Not yet" : null) : formatUsd(worth)}
                note="moves with play"
              />
              <Fig
                label="Your profit rank"
                value={
                  known && you?.netRank != null
                    ? `#${you.netRank}`
                    : known
                      ? "Not yet"
                      : null
                }
                note={
                  you?.netChips != null
                    ? formatSignedUsd(you.netChips)
                    : "needs a priced hand"
                }
              />
            </>
          )}
        </div>
      </section>

      {/* --------------------------------------------- the graph and the boards --- */}
      {/*
        The chart on the left, the two boards stacked beside it.

        They were a full-width chart and then a full-width pair of boards, one
        under the other, which is two scrolls for four things that answer each
        other: how the pool grew, and who built it. Stacked in a column the
        boards show their head — the names anyone actually looks for — and the
        rest is one click away rather than a page of rows nobody scrolled to.
      */}
      <div className="rewards-mid">
        {points.length > 0 && (
          <section className="chart-card" aria-labelledby="growth-head">
            <div className="chart-head">
              <h2 id="growth-head">How the pool has grown</h2>
              <span className="chart-note">{data.handsRecorded ?? 0} hands</span>
            </div>
            <LineChart
              caption="The player pool and the rake it comes from, against hands recorded"
              series={series}
              points={points}
              pointLabels={pointLabels}
              formatX={handsAxis}
              format={formatUsd}
              formatAxis={usdAxis}
              /*
               * Taller than the 260 it was. The boards beside it take their
               * height from this card, and at 260 each of them had about two
               * and a half rows of visible list — the chart was deciding how
               * much of a leaderboard you could see. 340 gives each board
               * three and a half rows and keeps the plot at a readable aspect.
               */
              height={340}
            />
          </section>
        )}

        {/*
          The shell exists to take the row's height WITHOUT contributing to it.
          A grid row is as tall as its tallest item, so with the boards as a
          direct child a long list made the row grow and dragged the chart up
          to match — the boards were deciding the chart's height instead of the
          other way round. The stack is positioned inside this, so the row is
          measured from the chart alone and the boards are handed the result.
        */}
        <div className="rewards-boards-shell">
          <div className="rewards-boards-stack">
          <BoardCard
            title="Most profitable"
            unit="profit"
            hint="out minus in"
            icon={<TrophyIcon size={18} />}
            rows={data.winners}
            me={me}
            emptyLine={
              known
                ? "Nobody is ahead yet. Profit needs both halves of a hand recorded."
                : "Nobody is keeping track here yet."
            }
          />
          <BoardCard
            title={`Top ${REWARDS_BOARD_SIZE} by rake`}
            unit="rake"
            hint="share is pro-rata"
            icon={<ZapIcon size={18} />}
            rows={data.contributorsBoard}
            me={me}
            emptyLine={
              known
                ? "No rake yet. Pots that see a flop are raked 2.5%."
                : "Nobody is keeping track here yet."
            }
          />
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------- terms --- */}
      {/* A definition list, not a paragraph. Four facts, each one line. */}
      <section className="rewards-terms-grid" aria-label="Programme terms">
        <dl>
          <div>
            <dt>Rake</dt>
            <dd>2.5% of pots that see a flop, capped at 3 big blinds</dd>
          </div>
          <div>
            <dt>Pool</dt>
            <dd>{pct(AIRDROP_RAKE_SHARE_BPS)} of all rake collected</dd>
          </div>
          <div>
            <dt>Split</dt>
            <dd>Pro-rata by rake paid, not by winnings or rank</dd>
          </div>
          <div>
            <dt>Token</dt>
            <dd>
              None yet, so no allocation and no date. {pct(AIRDROP_TOKEN_FEE_SHARE_BPS)} of
              token fees joins the pool at launch
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
