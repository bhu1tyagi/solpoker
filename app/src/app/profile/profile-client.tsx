"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import {
  ChartCardSkeleton,
  FigSkeleton,
  Loading,
  ProfileHeadSkeleton,
} from "@/components/primitives/Skeletons";
import { CheckIcon, UsdcMark } from "@/components/primitives/Icons";
import { LineChart, type Series } from "@/components/charts/LineChart";
import { ShareCard } from "@/components/rewards/ShareCard";
import { useProfile, type Rename } from "@/hooks/use-profile";
import { chipsToUsd, formatSignedUsd, formatUsd } from "@/lib/money";
import { NAME_MAX, checkName } from "@/lib/profile-name";
import { useUiStore } from "@/stores/ui-store";

/**
 * A player's own record, told in two charts.
 *
 * Written to be read at a glance rather than read through. The figures carry
 * the meaning and the labels only name them — an earlier version explained
 * every statistic in a sentence underneath it, which is how a page of six
 * facts becomes a page of six paragraphs nobody finishes.
 *
 * Two charts because there are two units. Money and hand counts cannot share a
 * y-axis without one of them lying about the other, and a second axis is the
 * most common way a chart misleads. Splitting them is not a layout choice.
 */

/** Chips are cents; an axis reads better in whole dollars. */
const usdAxis = (chips: number) => {
  const usd = chipsToUsd(chips);
  const abs = Math.abs(usd);
  const s =
    abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(abs < 10 ? 2 : 0)}`;
  return usd < 0 ? `−${s}` : s;
};
const countAxis = (n: number) => String(Math.round(n));
/** The x axis: how many hands deep into the record a point sits. */
const handsAxis = (n: number) =>
  `${n >= 10_000 ? `${(n / 1000).toFixed(0)}k` : n.toLocaleString("en-US")} hands`;

type FigTone = "neutral" | "up" | "down";

function Fig({
  label,
  value,
  note,
  tone = "neutral",
  glow = false,
}: {
  label: string;
  value: string | null;
  /**
   * The second fact the figure is useless without — a share, a denominator, a
   * qualifier. Only ever derived from the record; omitted, never invented,
   * when the value it would be derived from is missing.
   */
  note?: string;
  tone?: FigTone;
  glow?: boolean;
}) {
  return (
    <div className={glow ? "fig fig-glow" : "fig"}>
      <span className="fig-label">{label}</span>
      <span
        className={value === null ? "fig-val is-unknown" : "fig-val"}
        style={{
          color:
            tone === "up" ? "var(--c-win)" : tone === "down" ? "var(--c-loss)" : undefined,
        }}
      >
        {value ?? "—"}
      </span>
      {/* Only alongside a real value: a note under a dash would be explaining
          a number that is not there. */}
      {note && value !== null && <span className="fig-note">{note}</span>}
    </div>
  );
}

function NameEditor({
  wallet,
  current,
  rename,
  onSaved,
}: {
  wallet: string;
  current: string | null;
  rename: Rename;
  onSaved: () => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const toast = useUiStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setDraft(current ?? ""), [current]);

  if (!editing) {
    return (
      <div className="profile-name-row">
        <h2 className="profile-name">{current ?? shortKey(wallet)}</h2>
        <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>
          {current ? "Rename" : "Set a name"}
        </Button>
      </div>
    );
  }

  const save = async () => {
    const checked = checkName(draft);
    if ("problem" in checked) {
      setProblem(checked.problem);
      return;
    }
    if (!publicKey) return;
    setProblem(null);
    setBusy(true);
    const err = await rename(publicKey, signMessage, checked.name);
    setBusy(false);
    if (err) {
      setProblem(err);
      return;
    }
    onSaved();
    setEditing(false);
    toast(`You are now ${checked.name}.`, "good");
  };

  return (
    <div className="profile-name-edit">
      <div className="profile-name-controls">
        <input
          id="display-name"
          className="profile-name-input"
          value={draft}
          maxLength={NAME_MAX}
          autoFocus
          disabled={busy}
          aria-label="Display name"
          placeholder="Your name"
          onChange={(e) => {
            setDraft(e.target.value);
            setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button variant="primary" size="md" onClick={() => void save()} loading={busy}>
          {busy ? "Sign in wallet" : "Save"}
        </Button>
        <Button variant="quiet" size="md" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {problem ? (
        <p className="profile-name-problem" role="alert">
          {problem}
        </p>
      ) : (
        <p className="profile-name-hint">Signed by your wallet. Moves no chips.</p>
      )}
    </div>
  );
}

export function ProfileClient() {
  const { publicKey, connected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const openGate = useUiStore((s) => s.openGate);

  useEffect(() => setMounted(true), []);

  const me = mounted && connected && publicKey ? publicKey.toBase58() : null;
  const { profile, loaded, refresh, rename } = useProfile(me);

  /*
   * The x axis is hands played, not the calendar.
   *
   * Poker is measured in hands. A week away draws a long flat run on a time
   * axis, which reads as a losing streak when in fact nothing was played; on a
   * hands axis that week simply is not there, which is the truth. It is also
   * the axis every poker tracker uses, so the shape is one players can already
   * read. The dates are not lost — they ride in the tooltip.
   */
  /*
 * A cumulative chart starts at nothing.
 *
 * The first stored point is the end of the first day played, which on a busy
 * opening session is already a hundred hands in — so the line began partway up
 * with no visible climb, and the axis started at "120 hands" as though the
 * first hundred had happened somewhere off-screen. Prepending a zero is not
 * invented data: before a hand is played, every cumulative figure IS zero. The
 * one exception is net, which stays null when no hand has ever been priced,
 * because "no profit yet" and "profit unknown" are different claims.
 */
  const chart = useMemo(() => {
    const raw = profile?.series ?? [];
    if (raw.length === 0) return [];
    const first = raw[0];
    const origin = {
      at: first.at,
      hands: 0,
      net: first.net === null ? null : 0,
      won: 0,
      lost: 0,
      rake: 0,
      handsWon: 0,
      showdowns: 0,
    };
    return [origin, ...raw];
  }, [profile]);

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

  /*
   * Slot order is fixed. A series keeps its colour whether or not its
   * neighbours are dulled, so the mapping never has to be relearned.
   */
  const money: Series[] = useMemo(() => {
    const s = chart;
    return [
      { key: "net", label: "Net", color: "--c-series1", values: s.map((p) => p.net) },
      {
        key: "won",
        label: "Won",
        color: "--c-series2",
        values: s.map((p) => p.won),
        format: formatUsd,
      },
      {
        key: "lost",
        label: "Lost",
        color: "--c-series3",
        values: s.map((p) => p.lost),
        format: formatUsd,
      },
      {
        key: "rake",
        label: "Rake",
        color: "--c-series4",
        values: s.map((p) => p.rake),
        format: formatUsd,
      },
    ];
  }, [chart]);

  /*
   * "Hands" is the axis now, so plotting it as a series too would draw a
   * straight diagonal that states hands equal hands. What is left is the part
   * that varies: how much of that play was won, and how much reached a
   * showdown. The slope of each line is the rate.
   */
  const play: Series[] = useMemo(() => {
    const s = chart;
    return [
      { key: "won", label: "Won", color: "--c-series2", values: s.map((p) => p.handsWon) },
      {
        key: "showdowns",
        label: "Showdowns",
        color: "--c-series3",
        values: s.map((p) => p.showdowns),
      },
    ];
  }, [chart]);

  if (!mounted || !me) {
    return (
      <div className="rewards-connect">
        <UsdcMark size={30} />
        <h3>Connect to see your record</h3>
        <Button variant="primary" size="lg" onClick={() => openGate()}>
          Connect wallet
        </Button>
      </div>
    );
  }

  if (!loaded) {
    /*
     * The shape of the whole page, not a placeholder for part of it: the card
     * and its figures on one row, then the two charts on another, at the same
     * widths they will land at, so nothing moves when the data arrives.
     */
    return (
      <Loading label="Loading your record">
        <ProfileHeadSkeleton />
        <div className="profile-top">
          <div className="profile-top-main">
            <div className="skel skel-share" />
          </div>
          <div className="profile-figs figs-column">
            {Array.from({ length: 8 }, (_, i) => (
              <FigSkeleton key={i} />
            ))}
          </div>
        </div>
        <div className="profile-charts">
          <ChartCardSkeleton chips={4} />
          <ChartCardSkeleton chips={3} />
        </div>
      </Loading>
    );
  }

  const known = profile?.stored === true;
  const played = profile?.handsPlayed ?? 0;
  const net = profile?.netChips ?? null;
  const profitHands = profile?.profitHands ?? 0;

  /** There is a result worth posting: a stored record with a priced net. */
  const shareable = known && net !== null;

  /*
   * The figures the share card does not carry.
   *
   * These are the deeper cuts — the best and worst single hands, how much play
   * reached a showdown, what the rake took, and how long the record runs. They
   * sit beside the card rather than under the charts because they answer the
   * card: it says what the result was, and these say how it was arrived at.
   *
   * Every one carries a note, and the notes do real work. Beside the card the
   * figures had a label and a number in a tall box and read as mostly empty,
   * and the fix is not a bigger number — it is the second fact each of these
   * is useless without. A count of showdowns means nothing until you know what
   * share of the hands it was; a best hand means nothing without the worst.
   *
   * A note is only ever derived from a value the record actually holds. Where
   * a denominator is missing, the note is dropped rather than divided by zero
   * or guessed at.
   */
  const rate = (n: number | null | undefined, of: number) =>
    n == null || of <= 0 ? null : `${Math.round((n / of) * 100)}% of hands`;

  const deepFigs: {
    label: string;
    value: string | null;
    note?: string;
    tone?: FigTone;
  }[] = [
    {
      label: "Best hand",
      value:
        profile?.biggestWinChips == null
          ? null
          : formatSignedUsd(profile.biggestWinChips),
      note: "largest single win",
      tone: (profile?.biggestWinChips ?? 0) > 0 ? "up" : "neutral",
    },
    {
      label: "Worst hand",
      value:
        profile?.biggestLossChips == null
          ? null
          : formatSignedUsd(profile.biggestLossChips),
      note: "largest single loss",
      tone: (profile?.biggestLossChips ?? 0) < 0 ? "down" : "neutral",
    },
    {
      label: "Win rate",
      value:
        known && played > 0
          ? `${Math.round(((profile?.handsWon ?? 0) / played) * 100)}%`
          : null,
      note:
        known && played > 0
          ? `${profile?.handsWon ?? 0} of ${played} hands`
          : undefined,
    },
    {
      label: "Showdowns",
      value: known ? String(profile?.showdowns ?? 0) : null,
      note: rate(profile?.showdowns, played) ?? undefined,
    },
    {
      label: "Pots captured",
      value: known ? formatUsd(profile?.wonChips ?? 0) : null,
      note: "before buy-ins",
    },
    {
      label: "Rake",
      value: known ? formatUsd(profile?.rakeChips ?? 0) : null,
      note: "on your hands",
    },
    {
      label: "Tables",
      value: known ? String(profile?.tablesPlayed ?? 0) : null,
      note:
        (profile?.tablesPlayed ?? 0) > 0 && played > 0
          ? `${Math.round(played / (profile?.tablesPlayed || 1))} hands each`
          : undefined,
    },
    {
      label: "Since",
      value: profile?.firstHandAt
        ? new Date(profile.firstHandAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : null,
      note: profile?.firstHandAt ? "first recorded hand" : undefined,
    },
  ];

  return (
    <>
      <header className="profile-head">
        <Avatar pubkey={me} size={64} />
        <div className="profile-ident">
          <NameEditor
            wallet={me}
            current={profile?.displayName ?? null}
            rename={rename}
            onSaved={() => void refresh()}
          />
          {/* The address is always present, whatever the name says. */}
          <p className="profile-address">
            <CheckIcon size={14} />
            {me}
          </p>
        </div>
      </header>

      {known && played === 0 ? (
        <div className="rewards-empty">
          <UsdcMark size={26} />
          <p>No hands recorded yet.</p>
          <Button href="/lobby" variant="quiet" size="md">
            Find a seat
          </Button>
        </div>
      ) : (
        <>
          {/*
            The top row: the shareable card on the left, the figures it does
            not carry on the right.

            The card already states net, hands, won and biggest pot at a size
            nothing on this page can compete with, so the four small cards that
            used to repeat them above it are gone — the same number twice, once
            large and once small, is the page arguing with itself. Nothing was
            dropped from the record: every one of those values is still
            fetched, still stored, and still on screen inside the card.

            When there is no card to show — a wallet with no priced hands — the
            headline figures come back as cards in its place, because then they
            are the only place those numbers appear.
          */}
          <div className={shareable ? "profile-top" : "profile-top is-cardless"}>
            <div className="profile-top-main">
              {shareable ? (
                <ShareCard
                  stats={{
                    wallet: me,
                    displayName: profile?.displayName ?? null,
                    netChips: net,
                    handsPlayed: played,
                    handsWon: profile?.handsWon ?? 0,
                    biggestPotChips: profile?.biggestPotChips ?? 0,
                  }}
                />
              ) : (
                <div className="profile-figs profile-figs-head">
                  <Fig
                    label="Net"
                    value={net === null ? null : formatSignedUsd(net)}
                    tone={net === null ? "neutral" : net >= 0 ? "up" : "down"}
                    glow={net !== null && net > 0}
                  />
                  <Fig label="Hands" value={known ? String(played) : null} />
                  <Fig label="Won" value={known ? String(profile?.handsWon ?? 0) : null} />
                  <Fig
                    label="Biggest pot"
                    value={known ? formatUsd(profile?.biggestPotChips ?? 0) : null}
                  />
                </div>
              )}
            </div>

            {/* What the card does not carry, as figures rather than prose. */}
            <div className="profile-figs figs-column">
              {deepFigs.map((f) => (
                <Fig key={f.label} {...f} />
              ))}
            </div>
          </div>

          {/*
            Both charts on one row. They are the same shape at the same height
            and they are read against each other — money over hands beside play
            over hands — so stacking them put a scroll between two halves of
            one comparison.
          */}
          <div className="profile-charts">
          <section className="chart-card" aria-labelledby="pnl-head">
            <div className="chart-head">
              <h2 id="pnl-head">Profit and loss</h2>
              {/* The one qualifier that cannot be dropped: the net covers only
                  the hands whose contributions are known. */}
              <span className="chart-note">
                {profitHands < played
                  ? `${profitHands} of ${played} hands priced`
                  : `${played} hands`}
              </span>
            </div>
            <LineChart
              caption="Profit and loss over hands played, in US dollars"
              series={money}
              points={points}
              pointLabels={pointLabels}
              formatX={handsAxis}
              format={(v) => formatSignedUsd(v)}
              formatAxis={usdAxis}
            />
          </section>

          <section className="chart-card" aria-labelledby="play-head">
            <div className="chart-head">
              <h2 id="play-head">Play</h2>
              <span className="chart-note">
                {profile?.tablesPlayed ?? 0} table
                {profile?.tablesPlayed === 1 ? "" : "s"}
              </span>
            </div>
            <LineChart
              caption="Hands won and showdowns, against hands played"
              series={play}
              points={points}
              pointLabels={pointLabels}
              formatX={handsAxis}
              format={(v) => String(Math.round(v))}
              formatAxis={countAxis}
            />
          </section>
          </div>

          <p className="profile-foot">
            Rake earns a share of the player pool — <a href="/rewards">see rewards</a>
          </p>
        </>
      )}
    </>
  );
}
