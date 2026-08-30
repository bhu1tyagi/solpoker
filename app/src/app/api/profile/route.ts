import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { CLUSTER_TAG, db, ensureSchema } from "@/lib/server/db";
import {
  NAME_SIGNATURE_TTL_MS,
  checkName,
  nameMessage,
} from "@/lib/profile-name";

export const runtime = "nodejs";

/**
 * One player: how they have done, and what they are called.
 *
 * GET is public. Everything it returns is derived from hands already recorded
 * against a public key on a public chain, so there is nothing here to gate —
 * and gating it would break the one thing a profile is for, which is being
 * shown to somebody else.
 *
 * POST is the only authenticated write in this application. A display name is
 * the first thing in the product that is not derived from chain state, which
 * means it is the first thing somebody could set on a wallet that is not
 * theirs. So the wallet signs the exact name it is claiming and the server
 * verifies that signature before believing any of it. There is no session, no
 * cookie, and no token: the signature IS the credential, it authorises exactly
 * one change, and it stops being good ten minutes after it was made.
 */

interface Profile {
  wallet: string;
  displayName: string | null;
  /** Every figure below is null when no database answered. */
  stored: boolean;

  handsPlayed: number | null;
  handsWon: number | null;
  showdowns: number | null;
  tablesPlayed: number | null;
  firstHandAt: number | null;
  lastHandAt: number | null;

  /** Gross, out of pots. Includes the player's own stake coming back. */
  wonChips: number | null;
  rakeChips: number | null;
  biggestPotChips: number | null;

  /*
   * Profit and loss, over the hands whose contributions are known.
   *
   * Separate counts because they cover a smaller set than the figures above:
   * a hand recorded before contributions were captured, or one whose
   * contributions did not check out, can say who won but not who profited.
   * Reporting a net over a subset while implying it covers everything is the
   * kind of quiet wrongness that makes a money figure worse than no figure.
   */
  netChips: number | null;
  profitHands: number | null;
  wonAmountChips: number | null;
  lostAmountChips: number | null;
  biggestWinChips: number | null;
  biggestLossChips: number | null;

  /**
   * The record as it accumulated, one point per day played.
   *
   * Cumulative rather than daily, because the question a player asks of a
   * poker graph is "am I up over time", and a daily bar answers a different
   * one. Days with no play are not interpolated and not filled with zeros —
   * the line simply steps from one day played to the next, so a month away
   * is a flat segment rather than a fabricated decline.
   */
  series: SeriesPoint[];
}

export interface SeriesPoint {
  /** Epoch millis, midnight UTC of the day. */
  at: number;
  net: number | null;
  won: number;
  lost: number;
  rake: number;
  hands: number;
  handsWon: number;
  showdowns: number;
}

/*
 * Never cached, and that is a correctness requirement rather than a
 * preference.
 *
 * This response is about one wallet, and the one moment a player looks hardest
 * at it is the moment they have just changed something. A shared cache held it
 * for fifteen seconds, so a rename that had already been accepted and stored
 * read back as the old name — the write worked and the product looked broken.
 * The queries behind it are two indexed lookups; there is nothing here worth
 * trading that for.
 */
const headers = { "Cache-Control": "private, no-store" };

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * How many points a chart series is thinned to.
 *
 * Enough that the line shows real shape rather than a few straight runs, few
 * enough that a heavy player's history is not a megabyte of JSON. Below this
 * many hands nothing is dropped at all.
 */
const SERIES_POINTS = 400;

function empty(wallet: string): Profile {
  return {
    wallet,
    displayName: null,
    stored: false,
    handsPlayed: null,
    handsWon: null,
    showdowns: null,
    tablesPlayed: null,
    firstHandAt: null,
    lastHandAt: null,
    wonChips: null,
    rakeChips: null,
    biggestPotChips: null,
    netChips: null,
    profitHands: null,
    wonAmountChips: null,
    lostAmountChips: null,
    biggestWinChips: null,
    biggestLossChips: null,
    series: [],
  };
}

export async function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get("wallet");
  let wallet: string;
  try {
    wallet = new PublicKey(asked ?? "").toBase58();
  } catch {
    return NextResponse.json({ error: "not a wallet" }, { status: 400 });
  }

  const s = db();
  if (!s) return NextResponse.json(empty(wallet), { headers });

  try {
    await ensureSchema(s);
    const [totals, profit, name, daily] = await Promise.all([
      /*
       * The whole-history figures, over every recorded hand.
       *
       * `hands` counts rows, which is hands DEALT IN rather than hands won —
       * the distinction the losers' rows exist to make possible.
       */
      s`
        SELECT count(*)                                    AS hands,
               count(*) FILTER (WHERE payout_chips > 0)    AS won,
               count(*) FILTER (WHERE showdown)            AS showdowns,
               count(DISTINCT table_id)                    AS tables,
               coalesce(sum(payout_chips), 0)              AS gross,
               coalesce(sum(rake_chips), 0)                AS rake,
               coalesce(max(payout_chips), 0)              AS biggest_pot,
               min(settled_at)                             AS first_at,
               max(settled_at)                             AS last_at
          FROM hand_players
         WHERE cluster = ${CLUSTER_TAG} AND wallet = ${wallet}`,
      /*
       * Profit, over the hands that can support the word.
       *
       * The per-hand delta is what came out minus what went in, so a folded
       * blind is a small negative and an uncalled bet nets to zero — the
       * returned chips appear in both columns. Summing the positives and the
       * negatives separately gives the two halves a player actually wants,
       * and the extremes are the best and worst single hands.
       */
      s`
        SELECT count(*)                                            AS hands,
               coalesce(sum(payout_chips - contributed_chips), 0)   AS net,
               coalesce(sum(payout_chips - contributed_chips)
                        FILTER (WHERE payout_chips > contributed_chips), 0) AS won_amt,
               coalesce(-sum(payout_chips - contributed_chips)
                        FILTER (WHERE payout_chips < contributed_chips), 0) AS lost_amt,
               coalesce(max(payout_chips - contributed_chips), 0)   AS best,
               coalesce(min(payout_chips - contributed_chips), 0)   AS worst
          FROM hand_players
         WHERE cluster = ${CLUSTER_TAG} AND wallet = ${wallet}
           AND contributed_chips IS NOT NULL`,
      s`
        SELECT display_name
          FROM players
         WHERE cluster = ${CLUSTER_TAG} AND wallet = ${wallet}`,
      /*
       * One point per HAND, not per day.
       *
       * A day is the wrong grain for a poker graph. A session of three hundred
       * hands collapsed to a single point, so the line between two days was a
       * straight interpolation and every swing inside the session — the whole
       * thing a player opens this chart to see — was invisible. Bucketed by
       * day the graph could only ever look linear.
       *
       * Running totals come from a window over the hands in the order they
       * were settled. The result is then thinned to at most SERIES_POINTS
       * evenly spaced samples, so a player with forty hands gets all forty and
       * one with forty thousand gets a detailed line rather than a payload
       * measured in megabytes. The final hand is always kept, so the last
       * point on the chart is the player's real current position and not
       * whatever the sampling happened to land on.
       */
      s`
        WITH seq AS (
          SELECT row_number() OVER w                                   AS n,
                 settled_at,
                 count(*) FILTER (WHERE payout_chips > 0) OVER w        AS hands_won,
                 count(*) FILTER (WHERE showdown) OVER w                AS showdowns,
                 sum(rake_chips) OVER w                                 AS rake,
                 count(*) FILTER (WHERE contributed_chips IS NOT NULL)
                   OVER w                                               AS priced,
                 coalesce(sum(payout_chips - contributed_chips)
                   FILTER (WHERE contributed_chips IS NOT NULL) OVER w, 0) AS net,
                 coalesce(sum(payout_chips - contributed_chips)
                   FILTER (WHERE contributed_chips IS NOT NULL
                             AND payout_chips > contributed_chips) OVER w, 0) AS won_amt,
                 coalesce(-sum(payout_chips - contributed_chips)
                   FILTER (WHERE contributed_chips IS NOT NULL
                             AND payout_chips < contributed_chips) OVER w, 0) AS lost_amt
            FROM hand_players
           WHERE cluster = ${CLUSTER_TAG} AND wallet = ${wallet}
             AND settled_at > now() - interval '2 years'
          WINDOW w AS (ORDER BY settled_at, table_id, hand_number
                       ROWS UNBOUNDED PRECEDING)
        ),
        sized AS (SELECT *, count(*) OVER () AS total FROM seq)
        SELECT n AS hands, settled_at, hands_won, showdowns, rake, priced,
               net, won_amt, lost_amt
          FROM sized
         WHERE n % greatest(1, (total / ${SERIES_POINTS})::int) = 0 OR n = total
         ORDER BY n`,
    ]);

    /*
     * Already cumulative from the window above, so this only shapes it. `net`
     * stays null until a hand has actually been priced — a running profit of
     * zero over hands nobody could price is not a profit of zero.
     */
    const series: SeriesPoint[] = daily.map((r) => ({
      at: new Date(r.settled_at as Date).getTime(),
      hands: n(r.hands) ?? 0,
      net: (n(r.priced) ?? 0) > 0 ? (n(r.net) ?? 0) : null,
      won: n(r.won_amt) ?? 0,
      lost: n(r.lost_amt) ?? 0,
      rake: n(r.rake) ?? 0,
      handsWon: n(r.hands_won) ?? 0,
      showdowns: n(r.showdowns) ?? 0,
    }));

    const t = totals[0] ?? {};
    const p = profit[0] ?? {};
    const first = t.first_at as Date | null;
    const last = t.last_at as Date | null;
    const profitHands = n(p.hands) ?? 0;

    return NextResponse.json(
      {
        wallet,
        displayName: (name[0]?.display_name as string | null) ?? null,
        stored: true,
        handsPlayed: n(t.hands) ?? 0,
        handsWon: n(t.won) ?? 0,
        showdowns: n(t.showdowns) ?? 0,
        tablesPlayed: n(t.tables) ?? 0,
        firstHandAt: first ? new Date(first).getTime() : null,
        lastHandAt: last ? new Date(last).getTime() : null,
        wonChips: n(t.gross) ?? 0,
        rakeChips: n(t.rake) ?? 0,
        biggestPotChips: n(t.biggest_pot) ?? 0,
        // Null rather than zero when no hand can support a profit figure. A
        // net of $0 and "not enough recorded to say" are different answers.
        netChips: profitHands > 0 ? n(p.net) : null,
        profitHands,
        wonAmountChips: profitHands > 0 ? n(p.won_amt) : null,
        lostAmountChips: profitHands > 0 ? n(p.lost_amt) : null,
        biggestWinChips: profitHands > 0 ? n(p.best) : null,
        biggestLossChips: profitHands > 0 ? n(p.worst) : null,
        series,
      } satisfies Profile,
      { headers },
    );
  } catch {
    return NextResponse.json(empty(wallet), { headers });
  }
}

/**
 * Claim a display name.
 *
 * The body carries the wallet, the name, when the request was issued, and a
 * signature over the message those three produce. The server rebuilds that
 * message from the parts rather than trusting any text in the body — a
 * signature is only meaningful over a message the verifier constructed
 * itself, because verifying a caller-supplied string proves they can sign
 * something, not that they agreed to this.
 */
export async function POST(req: Request) {
  const s = db();
  if (!s) {
    return NextResponse.json(
      { error: "Names cannot be saved here yet." },
      { status: 503 },
    );
  }

  let body: { wallet?: string; name?: string; issuedAt?: number; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "not json" }, { status: 400 });
  }

  let wallet: PublicKey;
  try {
    wallet = new PublicKey(body.wallet ?? "");
  } catch {
    return NextResponse.json({ error: "not a wallet" }, { status: 400 });
  }

  const checked = checkName(String(body.name ?? ""));
  if ("problem" in checked) {
    return NextResponse.json({ error: checked.problem }, { status: 400 });
  }

  /*
   * A signature is good for ten minutes, in both directions.
   *
   * Forward, so one captured signature cannot be replayed to rename a wallet
   * indefinitely. Backward, so a caller cannot mint one dated into the future
   * and keep it in reserve. Clock skew between a phone and a server is
   * seconds; ten minutes is generous for both.
   */
  const issuedAt = Number(body.issuedAt);
  if (!Number.isFinite(issuedAt)) {
    return NextResponse.json({ error: "missing timestamp" }, { status: 400 });
  }
  if (Math.abs(Date.now() - issuedAt) > NAME_SIGNATURE_TTL_MS) {
    return NextResponse.json(
      { error: "That request expired. Try again." },
      { status: 400 },
    );
  }

  // The gate. The message is rebuilt here, from values this server checked.
  const message = new TextEncoder().encode(
    nameMessage(wallet.toBase58(), checked.name, issuedAt),
  );
  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(String(body.signature ?? "")), message, wallet.toBytes());
  } catch {
    ok = false;
  }
  if (!ok) {
    return NextResponse.json(
      { error: "That signature does not match this wallet." },
      { status: 401 },
    );
  }

  try {
    await ensureSchema(s);
    await s`
      INSERT INTO players (cluster, wallet, display_name, name_updated_at)
      VALUES (${CLUSTER_TAG}, ${wallet.toBase58()}, ${checked.name}, now())
      ON CONFLICT (cluster, wallet) DO UPDATE
        SET display_name = excluded.display_name, name_updated_at = now()`;
  } catch {
    return NextResponse.json({ error: "Could not save that name." }, { status: 500 });
  }

  return NextResponse.json({ displayName: checked.name });
}
