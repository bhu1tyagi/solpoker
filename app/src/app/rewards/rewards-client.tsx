"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import { Skeleton } from "@/components/primitives/Surface";
import { TrophyIcon, UsdcMark, ZapIcon } from "@/components/primitives/Icons";
import { ShareCard } from "@/components/rewards/ShareCard";
import { useRewards, type RewardRow } from "@/hooks/use-rewards";
import { formatUsd } from "@/lib/money";
import {
  AIRDROP_RAKE_SHARE_BPS,
  AIRDROP_TOKEN_FEE_SHARE_BPS,
  MIN_ELIGIBLE_RAKE_CHIPS,
  REWARDS_BOARD_SIZE,
  pct,
} from "@/lib/rewards";
import { useUiStore } from "@/stores/ui-store";

/**
 * Rewards: what you have won, what you have paid, and what that is worth when
 * a token exists.
 *
 * Three rules shape everything below, and each of them costs something.
 *
 * The figures are RECORDED, not total. They come from hands a client captured
 * and the server proved against the chain's own result hash, which is most
 * hands and not all of them, and they start the day the capture shipped rather
 * than at the beginning of play. Every heading says so, because "your
 * winnings" would be a claim this data cannot support.
 *
 * Won is not profit. A payout includes the stake that went in, so the board
 * measures pots captured. Calling it profit would flatter every player on it.
 *
 * The pool is a share of rake ALREADY COLLECTED. No projection, no target, no
 * date. The token does not exist, so the page says what will happen when it
 * does and puts no number on it.
 */

const label = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  color: "var(--c-ink-faint)",
};

/** How long the figures have been counting, in the coarsest honest unit. */
function since(at: number | null): string {
  if (!at) return "since the first recorded hand";
  const d = new Date(at);
  return `since ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
}

/**
 * A statistic, or an honest absence of one.
 *
 * `value` is null when nothing is known, and that renders as a sentence rather
 * than a zero — a rewards page reporting $0 across the board when no database
 * is attached would be a lie about the room, not a fact about the player.
 */
function Stat({
  title,
  value,
  note,
  glow = false,
}: {
  title: string;
  value: string | null;
  note?: string;
  glow?: boolean;
}) {
  return (
    <div className={glow ? "rewards-stat rewards-stat-glow" : "rewards-stat"}>
      <span style={label}>{title}</span>
      {value === null ? (
        <span className="rewards-stat-unknown">Not recorded yet</span>
      ) : (
        <span className="rewards-stat-fig">{value}</span>
      )}
      {note && <span className="rewards-stat-note">{note}</span>}
    </div>
  );
}

/**
 * One row of a board.
 *
 * Rank one carries the glow, and only rank one: a board where every row glows
 * has no first place. The rank number itself is the second cue, so the top row
 * is still the top row with colour removed.
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
      <span className="rewards-wallet">
        {shortKey(row.wallet)}
        {isMe && <span className="rewards-you-tag">You</span>}
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
  loading,
  emptyLine,
}: {
  rows: RewardRow[];
  me: string | null;
  unit: string;
  loading: boolean;
  emptyLine: string;
}) {
  const PAGE = 15;
  const [shown, setShown] = useState(PAGE);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton height={52} />
        <Skeleton height={52} />
        <Skeleton height={52} />
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rewards-empty">
        <TrophyIcon size={26} />
        <p>{emptyLine}</p>
      </div>
    );
  }

  // Found before the list is cut down, so a pinned row shows a true position
  // rather than a position within the first page.
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
        <BoardRow
          key={r.wallet}
          row={r}
          rank={i + 1}
          isMe={r.wallet === me}
          unit={unit}
        />
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

  // The adapter knows nothing on the server, so the wallet-dependent panel
  // renders its disconnected shape until hydration rather than flashing.
  useEffect(() => setMounted(true), []);

  const me = mounted && connected && publicKey ? publicKey.toBase58() : null;
  const data = useRewards(me);
  const loading = !data.loaded;
  const you = data.you;

  const counted = since(data.since);
  // A zero is only sayable once a database has answered. Before that every
  // figure is unknown, which is a different thing and reads differently.
  const known = data.stored;

  return (
    <>
      {/* ------------------------------------------------ your rewards --- */}
      <section className="rewards-section" aria-labelledby="yours-head">
        <div className="rewards-head">
          <h2 id="yours-head">Your rewards</h2>
          <p>
            Every pot you have been paid, and every chip of rake you generated,{" "}
            {counted}.
          </p>
        </div>

        {!mounted || !me ? (
          <div className="rewards-connect">
            <UsdcMark size={30} />
            <div>
              <h3>Connect to see your results</h3>
              <p>
                Your figures are read from your wallet&apos;s public record of
                play. Nothing is stored against you until you sit at a table.
              </p>
            </div>
            {/* Not the gradient. The header already carries this screen's one
                gradient CTA, and it is the same action under the same words —
                two of them side by side would spend the accent twice and make
                neither the obvious one. */}
            <Button variant="primary" size="lg" onClick={() => openGate()}>
              Connect wallet
            </Button>
          </div>
        ) : loading ? (
          <div className="rewards-stats">
            <Skeleton height={104} />
            <Skeleton height={104} />
            <Skeleton height={104} />
          </div>
        ) : (
          <>
            <div className="rewards-stats">
              {/* The one glowing element in this region. Money that came back
                  is the affirmative signal the whole page is built around. */}
              <Stat
                title="Won from pots"
                value={known ? formatUsd(you?.wonChips ?? 0) : null}
                note={
                  known && you && you.wonChips > 0
                    ? `${you.handsWon} pot${you.handsWon === 1 ? "" : "s"} · rank ${you.wonRank}`
                    : "Stake included, so this is pots captured rather than profit"
                }
                glow={known && (you?.wonChips ?? 0) > 0}
              />
              <Stat
                title="Rake you generated"
                value={known ? formatUsd(you?.rakeChips ?? 0) : null}
                note={
                  known && you && you.rakeChips > 0
                    ? `Rank ${you.rakeRank} by contribution`
                    : "What the house took from pots you won"
                }
              />
              <Stat
                title="Your share of the pool"
                value={
                  known && you?.shareBps != null
                    ? `${(you.shareBps / 100).toFixed(2)}%`
                    : known
                      ? "Not yet"
                      : null
                }
                note={
                  known && you?.shareBps != null
                    ? "Of the player pool, at the rake recorded so far"
                    : `Generate ${formatUsd(MIN_ELIGIBLE_RAKE_CHIPS)} of rake to take a share`
                }
              />
            </div>

            {known && you && you.wonChips > 0 && (
              <div className="rewards-share">
                <div className="rewards-share-head">
                  <span style={label}>Share your result</span>
                  <p>
                    Drawn from the figures above and nothing else. Post it
                    wherever you like.
                  </p>
                </div>
                <ShareCard
                  stats={{
                    wallet: me,
                    wonChips: you.wonChips,
                    handsWon: you.handsWon,
                    wonRank: you.wonRank,
                    rakeChips: you.rakeChips,
                  }}
                />
              </div>
            )}

            {known && you && you.wonChips === 0 && you.rakeChips === 0 && (
              <div className="rewards-empty">
                <UsdcMark size={26} />
                <p>
                  Nothing recorded for this wallet yet. Figures appear once you
                  win a pot at a table.
                </p>
                <Button href="/lobby" variant="quiet" size="md">
                  Find a seat
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---------------------------------------------------- airdrop --- */}
      <section className="rewards-section" aria-labelledby="airdrop-head">
        <div className="rewards-head">
          <h2 id="airdrop-head">The player pool</h2>
          <p>
            {pct(AIRDROP_RAKE_SHARE_BPS)} of all rake collected, and{" "}
            {pct(AIRDROP_TOKEN_FEE_SHARE_BPS)} of token fees, go back to the
            players who generated them. Shared in proportion to the rake each
            player paid — not to how much they won, and not to a place on a
            leaderboard.
          </p>
        </div>

        <div className="rewards-pool">
          {/* The one glowing element in this region: the money actually set
              aside. It is a share of rake already taken, never a projection. */}
          <Stat
            title="Player pool so far"
            value={known ? formatUsd(data.poolChips ?? 0) : null}
            note={`${pct(AIRDROP_RAKE_SHARE_BPS)} of ${known ? formatUsd(data.rakeChips ?? 0) : "the rake"} recorded ${counted}`}
            glow={known && (data.poolChips ?? 0) > 0}
          />
          <Stat
            title="Players sharing it"
            value={known ? String(data.contributors ?? 0) : null}
            note={`Everyone past ${formatUsd(MIN_ELIGIBLE_RAKE_CHIPS)} of rake, however they placed`}
          />
          <Stat
            title="Hands recorded"
            value={known ? String(data.handsRecorded ?? 0) : null}
            note="Captured at the table and proved against the chain"
          />
        </div>

        <div className="rewards-terms">
          <ZapIcon size={18} />
          <p>
            There is no token yet, so there is no allocation and no date. When
            one launches, the pool converts at the rake each wallet has
            generated by then and{" "}
            {pct(AIRDROP_TOKEN_FEE_SHARE_BPS)} of token fees joins it. Keep
            playing and your share moves; stop and it stops.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------- the boards --- */}
      <section className="rewards-section" aria-labelledby="boards-head">
        <div className="rewards-head">
          <h2 id="boards-head">Boards</h2>
          <p>
            Two different questions. What came back out of pots, and what each
            player contributed in rake — the second is what a share is computed
            from.
          </p>
        </div>

        <div className="rewards-boards">
          <div className="rewards-board">
            <div className="rewards-board-head">
              <TrophyIcon size={18} />
              <h3>Won from pots</h3>
              <span>{counted}</span>
            </div>
            <Board
              rows={data.winners}
              me={me}
              unit="won"
              loading={loading}
              emptyLine={
                known
                  ? "No pots recorded yet. The first hand played fills this in."
                  : "Nobody is keeping track here yet, so there is nothing to show."
              }
            />
          </div>

          <div className="rewards-board">
            <div className="rewards-board-head">
              <ZapIcon size={18} />
              <h3>Top {REWARDS_BOARD_SIZE} by rake</h3>
              <span>share is pro-rata, not top {REWARDS_BOARD_SIZE}</span>
            </div>
            <Board
              rows={data.contributorsBoard}
              me={me}
              unit="rake"
              loading={loading}
              emptyLine={
                known
                  ? "No rake recorded yet. Pots that see a flop are raked 2.5%."
                  : "Nobody is keeping track here yet, so there is nothing to show."
              }
            />
          </div>
        </div>
      </section>
    </>
  );
}
