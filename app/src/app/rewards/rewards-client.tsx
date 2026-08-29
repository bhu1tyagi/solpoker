"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import { TrophyIcon, UsdcMark, ZapIcon } from "@/components/primitives/Icons";
import { LineChart, type Series } from "@/components/charts/LineChart";
import {
  BoardSkeleton,
  ChartCardSkeleton,
  FigGridSkeleton,
  Loading,
} from "@/components/primitives/Skeletons";
import { useRewards, type RewardRow } from "@/hooks/use-rewards";
import { chipsToUsd, formatUsd } from "@/lib/money";
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
}: {
  rows: RewardRow[];
  me: string | null;
  unit: string;
  emptyLine: string;
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
  const offBoard = mine && myIndex >= shown;

  return (
    <div>
      {offBoard && (
        <>
          <BoardRow row={mine} rank={myIndex + 1} isMe unit={unit} />
          <div className="rewards-row-split" />
        </>
      )}
      {rows.slice(0, shown).map((r, i) => (
        <BoardRow key={r.wallet} row={r} rank={i + 1} isMe={r.wallet === me} unit={unit} />
      ))}
      {shown < rows.length && (
        <div className="rewards-more">
          <Button variant="quiet" size="md" onClick={() => setShown((s) => s + PAGE)}>
            Show more
          </Button>
        </div>
      )}
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

  const points = useMemo(() => data.series.map((p) => p.at), [data.series]);
  const series: Series[] = useMemo(() => {
    const s = data.series;
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
  }, [data.series]);

  const worth =
    known && you?.shareBps != null
      ? Math.floor(((data.poolChips ?? 0) * you.shareBps) / 10_000)
      : null;

  if (loading) {
    return (
      <Loading label="Loading the player pool">
        <FigGridSkeleton count={4} />
        <ChartCardSkeleton chips={3} />
        <FigGridSkeleton count={2} />
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
      <section className="pool-hero" aria-labelledby="pool-head">
        <div className="pool-hero-main">
          <h2 id="pool-head" className="fig-label">
            Player pool so far
          </h2>
          <p className="pool-hero-fig">
            {known ? formatUsd(data.poolChips ?? 0) : "Not recorded yet"}
          </p>
          <p className="pool-hero-sub">
            {pct(AIRDROP_RAKE_SHARE_BPS)} of {known ? formatUsd(data.rakeChips ?? 0) : "rake"}{" "}
            collected since {since(data.since)}
          </p>
        </div>
        <div className="pool-hero-side">
          <Fig
            label="Players sharing it"
            value={known ? String(data.contributors ?? 0) : null}
            note={`Past ${formatUsd(MIN_ELIGIBLE_RAKE_CHIPS)} of rake`}
          />
          <Fig
            label="Hands recorded"
            value={known ? String(data.handsRecorded ?? 0) : null}
            note="Proved against the chain"
          />
        </div>
      </section>

      {/* ---------------------------------------------------- the graph --- */}
      {points.length > 0 && (
        <section className="chart-card" aria-labelledby="growth-head">
          <div className="chart-head">
            <h2 id="growth-head">How the pool has grown</h2>
            <span className="chart-note">{data.handsRecorded ?? 0} hands</span>
          </div>
          <LineChart
            caption="The player pool and the rake it comes from, over time"
            series={series}
            points={points}
            format={formatUsd}
            formatAxis={usdAxis}
            height={260}
          />
        </section>
      )}

      {/* ----------------------------------------------------- your cut --- */}
      <section className="rewards-yours" aria-labelledby="yours-head">
        <h2 id="yours-head" className="section-head">
          Your share
        </h2>
        {!me ? (
          <div className="rewards-connect">
            <UsdcMark size={28} />
            <h3>Connect to see your share</h3>
            <Button variant="primary" size="lg" onClick={() => openGate()}>
              Connect wallet
            </Button>
          </div>
        ) : known && you && you.rakeChips === 0 ? (
          <div className="rewards-empty">
            <ZapIcon size={24} />
            <p>No rake yet. A share builds from your first raked pot.</p>
            <Button href="/lobby" variant="quiet" size="md">
              Find a seat
            </Button>
          </div>
        ) : (
          <div className="profile-grid">
            <Fig
              label="Rake generated"
              value={known ? formatUsd(you?.rakeChips ?? 0) : null}
              note={you && you.rakeChips > 0 ? `Rank ${you.rakeRank}` : undefined}
            />
            <Fig
              label="Share of pool"
              value={
                known && you?.shareBps != null
                  ? `${(you.shareBps / 100).toFixed(2)}%`
                  : known
                    ? "Not yet"
                    : null
              }
              note={
                you?.shareBps == null
                  ? `Needs ${formatUsd(MIN_ELIGIBLE_RAKE_CHIPS)} of rake`
                  : undefined
              }
            />
            <Fig
              label="Worth so far"
              value={worth === null ? (known ? "Not yet" : null) : formatUsd(worth)}
              note="Moves with play"
            />
            <Fig
              label="Token fees"
              value={pct(AIRDROP_TOKEN_FEE_SHARE_BPS)}
              note="Joins the pool at launch"
            />
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- boards --- */}
      <section className="rewards-boards-section" aria-labelledby="boards-head">
        <h2 id="boards-head" className="section-head">
          Boards
        </h2>
        <div className="rewards-boards">
          <div className="rewards-board">
            <div className="rewards-board-head">
              <TrophyIcon size={18} />
              <h3>Most profitable</h3>
              <span>out minus in</span>
            </div>
            <Board
              rows={data.winners}
              me={me}
              unit="profit"
              emptyLine={
                known
                  ? "Nobody is ahead yet. Profit needs both halves of a hand recorded."
                  : "Nobody is keeping track here yet."
              }
            />
          </div>

          <div className="rewards-board">
            <div className="rewards-board-head">
              <ZapIcon size={18} />
              <h3>Top {REWARDS_BOARD_SIZE} by rake</h3>
              <span>share is pro-rata</span>
            </div>
            <Board
              rows={data.contributorsBoard}
              me={me}
              unit="rake"
              emptyLine={
                known
                  ? "No rake yet. Pots that see a flop are raked 2.5%."
                  : "Nobody is keeping track here yet."
              }
            />
          </div>
        </div>
      </section>

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
