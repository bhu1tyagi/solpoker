"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Avatar, shortKey } from "@/components/primitives/Avatar";
import { Button } from "@/components/primitives/Button";
import {
  ChartCardSkeleton,
  FigGridSkeleton,
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

function Fig({
  label,
  value,
  tone = "neutral",
  glow = false,
}: {
  label: string;
  value: string | null;
  tone?: "neutral" | "up" | "down";
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

  const points = useMemo(() => (profile?.series ?? []).map((p) => p.at), [profile]);

  /*
   * Slot order is fixed. A series keeps its colour whether or not its
   * neighbours are dulled, so the mapping never has to be relearned.
   */
  const money: Series[] = useMemo(() => {
    const s = profile?.series ?? [];
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
  }, [profile]);

  const play: Series[] = useMemo(() => {
    const s = profile?.series ?? [];
    return [
      { key: "hands", label: "Hands", color: "--c-series1", values: s.map((p) => p.hands) },
      { key: "won", label: "Won", color: "--c-series2", values: s.map((p) => p.handsWon) },
      {
        key: "showdowns",
        label: "Showdowns",
        color: "--c-series3",
        values: s.map((p) => p.showdowns),
      },
    ];
  }, [profile]);

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
     * The shape of the whole page, not a placeholder for part of it. Four
     * figures, two charts, six more figures — the same grid at the same
     * heights, so when the data lands nothing moves.
     */
    return (
      <Loading label="Loading your record">
        <ProfileHeadSkeleton />
        <FigGridSkeleton count={4} />
        <ChartCardSkeleton chips={4} />
        <ChartCardSkeleton chips={3} />
        <FigGridSkeleton count={6} small />
      </Loading>
    );
  }

  const known = profile?.stored === true;
  const played = profile?.handsPlayed ?? 0;
  const net = profile?.netChips ?? null;
  const profitHands = profile?.profitHands ?? 0;

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
          <div className="profile-grid">
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
              caption="Profit and loss over time, in US dollars"
              series={money}
              points={points}
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
              caption="Hands played, hands won and showdowns over time"
              series={play}
              points={points}
              format={(v) => String(Math.round(v))}
              formatAxis={countAxis}
            />
          </section>

          {/* What the charts do not carry, as figures rather than prose. */}
          <div className="profile-grid profile-grid-sm">
            <Fig
              label="Best hand"
              value={
                profile?.biggestWinChips == null
                  ? null
                  : formatSignedUsd(profile.biggestWinChips)
              }
              tone={(profile?.biggestWinChips ?? 0) > 0 ? "up" : "neutral"}
            />
            <Fig
              label="Worst hand"
              value={
                profile?.biggestLossChips == null
                  ? null
                  : formatSignedUsd(profile.biggestLossChips)
              }
              tone={(profile?.biggestLossChips ?? 0) < 0 ? "down" : "neutral"}
            />
            <Fig label="Showdowns" value={known ? String(profile?.showdowns ?? 0) : null} />
            <Fig label="Rake" value={known ? formatUsd(profile?.rakeChips ?? 0) : null} />
            <Fig
              label="Pots captured"
              value={known ? formatUsd(profile?.wonChips ?? 0) : null}
            />
            <Fig
              label="Since"
              value={
                profile?.firstHandAt
                  ? new Date(profile.firstHandAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : null
              }
            />
          </div>

          {known && net !== null && (
            <section className="chart-card" aria-labelledby="share-head">
              <div className="chart-head">
                <h2 id="share-head">Share</h2>
              </div>
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
            </section>
          )}

          <p className="profile-foot">
            Rake earns a share of the player pool — <a href="/rewards">see rewards</a>
          </p>
        </>
      )}
    </>
  );
}
