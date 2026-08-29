#!/usr/bin/env node
/**
 * Freeze the rewards ledger into a distribution list.
 *
 * The page shows a live share that moves with every hand. A distribution needs
 * the opposite: one moment, written down, that everybody can check afterwards.
 * This is that moment — every wallet that has generated at least the minimum
 * rake, what it generated, and what it is owed out of a pool you name.
 *
 * The pool is an argument rather than a constant because it is denominated in
 * whatever is being handed out. Chips today, tokens when a mint exists. The
 * arithmetic is the same either way: your share of the pool is your share of
 * the rake, and the remainder from the division goes to the largest holder,
 * the same rule the program uses for an odd chip.
 *
 * Every contributor past the floor is included. There is no top-N cut, and
 * that is deliberate: a cutoff makes the boundary worth buying, and the
 * cheapest way to buy it is to play yourself from a second wallet. Sharing in
 * proportion removes the prize for doing that, because a wash hand pays its
 * full rake to buy back its own fraction of a fifth of it.
 *
 *   DATABASE_URL=postgres://... node scripts/rewards-snapshot.mjs --pool 1000000
 *   ... --cluster mainnet --csv --out allocations.csv
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.STORAGE_URL ||
  process.env.DATABASE_POSTGRES_URL;
if (!url) {
  console.error("No database. Set DATABASE_URL to the one the app writes to.");
  process.exit(1);
}

const cluster = flag("cluster", "mainnet");
const pool = Number(flag("pool", "0"));
// Mirrors MIN_ELIGIBLE_RAKE_CHIPS in src/lib/rewards.ts. Overridable so a
// snapshot can be rehearsed against a smaller floor before it is real.
const floor = Number(flag("floor", "100"));

if (!Number.isFinite(pool) || pool <= 0) {
  console.error("Pass --pool <amount> — how much is being distributed.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const rows = await sql`
    SELECT wallet,
           sum(rake_chips)   AS rake,
           sum(payout_chips) AS won,
           count(*)          AS hands
      FROM hand_players
     WHERE cluster = ${cluster}
     GROUP BY wallet
    HAVING sum(rake_chips) >= ${floor}
     ORDER BY rake DESC, wallet`;

  if (rows.length === 0) {
    console.error(
      `No wallet on ${cluster} has generated ${floor} chips of rake yet. ` +
        `Nothing to distribute.`,
    );
    process.exit(1);
  }

  const total = rows.reduce((n, r) => n + Number(r.rake), 0);
  let handed = 0;
  const list = rows.map((r) => {
    const rake = Number(r.rake);
    const allocation = Math.floor((pool * rake) / total);
    handed += allocation;
    return {
      wallet: r.wallet,
      rakeChips: rake,
      wonChips: Number(r.won),
      hands: Number(r.hands),
      // Basis points, so a share is checkable by hand against the rake column.
      shareBps: Math.round((rake / total) * 10_000),
      allocation,
    };
  });

  // The floor divisions leave a little over. It goes to the largest
  // contributor, so the list always sums to exactly the pool and no
  // distribution has to explain a missing remainder.
  const remainder = pool - handed;
  if (remainder > 0) list[0].allocation += remainder;

  const snapshot = {
    cluster,
    pool,
    floor,
    contributors: list.length,
    totalRakeChips: total,
    // Stamped by the caller's clock, and named as such: the figures are
    // whatever the database held when this ran, not a chain height.
    takenAt: new Date().toISOString(),
    allocations: list,
  };

  const out = flag("out");
  if (has("csv")) {
    const csv = [
      "wallet,rake_chips,won_chips,hands,share_bps,allocation",
      ...list.map((a) =>
        [a.wallet, a.rakeChips, a.wonChips, a.hands, a.shareBps, a.allocation].join(","),
      ),
    ].join("\n");
    if (out) writeFileSync(out, csv);
    else console.log(csv);
  } else {
    const json = JSON.stringify(snapshot, null, 2);
    if (out) writeFileSync(out, json);
    else console.log(json);
  }

  if (out) {
    console.error(
      `${list.length} contributors, ${total} chips of rake, ` +
        `${pool} distributed. Written to ${out}.`,
    );
  }
} finally {
  await sql.end();
}
