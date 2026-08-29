/**
 * The backend's memory. One hosted Postgres, reached only from API routes.
 *
 * This exists because the chain deliberately forgets: hand accounts are
 * reused, so pots and hand records cannot be recomputed later from Solana.
 * If the lobby is ever to show 24h volume or an average pot, something has to
 * write hands down AS THEY SETTLE, and this is where they land.
 *
 * Two design rules, both load-bearing:
 *
 *   1. NOTHING here is trusted as submitted. A hand record is stored only
 *      after the server re-runs the same shuffle verification the client
 *      runs (the verifier is pure TypeScript, so it runs identically on
 *      both sides). The database cannot be fed a hand that never happened
 *      without breaking the VRF + commitment scheme itself.
 *
 *   2. The app must work with NO database. Every route degrades to nulls
 *      and the lobby renders exactly what it renders today. DATABASE_URL
 *      appearing is what switches the extra numbers on. Locally, point it
 *      at any Postgres; on Vercel, attach a Postgres to the project and
 *      the env var arrives by itself.
 */

import postgres from "postgres";

type Sql = ReturnType<typeof postgres>;

let sql: Sql | null | undefined;
let ready: Promise<void> | null = null;

export function db(): Sql | null {
  if (sql !== undefined) return sql;
  // Providers disagree on the name, and Vercel's marketplace flow lets the
  // installer add a prefix on top. Reading the known spellings means
  // attaching a database is the only step, with no env var to rename by hand
  // and no silent "I connected it and nothing happened" afterwards.
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_URL ||
    process.env.DATABASE_POSTGRES_URL;
  if (!url) {
    sql = null;
    return sql;
  }
  /*
   * `prepare: false` is the safety-critical half and stays: behind transaction
   * pooling a prepared statement can be orphaned the moment the pooler hands
   * the connection to somebody else.
   *
   * `max` was 1, which is a different claim and a costly one. It does not
   * make anything safer behind a pooler — a pooler exists precisely so many
   * client connections can share few server ones — but it does mean every
   * concurrent query queues behind a single socket, so a route reading four
   * independent things pays four round trips no matter how carefully they are
   * issued together. This database is in us-east-1 and each of those trips
   * costs about 250ms. Measured: the lobby's four queries take 2170ms through
   * one connection and 496ms through four.
   */
  sql = postgres(url, { max: 4, prepare: false });
  return sql;
}

/** Create-if-missing, once per process. Serverless-safe: idempotent DDL. */
export function ensureSchema(s: Sql): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await s`
        CREATE TABLE IF NOT EXISTS hands (
          id           text PRIMARY KEY,
          cluster      text NOT NULL DEFAULT 'devnet',
          table_id     numeric NOT NULL,
          hand_number  bigint NOT NULL,
          pot_chips    bigint,
          result_hash  text,
          record       jsonb NOT NULL,
          settled_at   timestamptz NOT NULL DEFAULT now()
        )`;
      // Devnet and mainnet share one database but must never share one
      // statistic: play-money hands inflating a real volume figure would be
      // exactly the fabricated liveness this product refuses to ship.
      await s`
        ALTER TABLE hands ADD COLUMN IF NOT EXISTS cluster text NOT NULL DEFAULT 'devnet'`;
      await s`
        CREATE INDEX IF NOT EXISTS hands_cluster_settled ON hands (cluster, settled_at)`;
      // The high-water mark of each table's on-chain hand counter.
      //
      // This is a backfill AND a safety net. The counter is the program's own,
      // so it covers hands played before any of this reporting existed and
      // hands whose client never managed to report them. And because
      // `close_table` deletes the table account outright, a count read live
      // from chain falls to zero the moment a table is tidied away; written
      // down here, it survives.
      //
      // `hands` only ever moves up, enforced in the upsert rather than trusted:
      // a partial read or a lagging replica must not be able to lower it.
      await s`
        CREATE TABLE IF NOT EXISTS table_hands (
          cluster    text NOT NULL,
          table_id   numeric NOT NULL,
          hands      bigint NOT NULL,
          first_seen timestamptz NOT NULL DEFAULT now(),
          last_seen  timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (cluster, table_id)
        )`;
      await s`
        CREATE TABLE IF NOT EXISTS table_names (
          table_id   numeric PRIMARY KEY,
          name       text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`;
    })();
  }
  return ready;
}

/**
 * Which chain the server is serving. Read from the same public env var the
 * client uses, so a hand is filed under the cluster it was actually played
 * on rather than whatever the database happens to be shared with.
 */
export const CLUSTER_TAG =
  process.env.NEXT_PUBLIC_CLUSTER === "mainnet" ? "mainnet" : "devnet";
