/*
 * Server only, enforced by the build.
 *
 * This module reads the database password. Next.js only inlines env vars
 * prefixed NEXT_PUBLIC_ into the browser bundle, so the secret cannot
 * reach a client today — but that protection is a naming convention, and
 * a convention is one careless import away from being wrong. This makes
 * the build fail instead: importing this from a client component is a
 * compile error, not a leak discovered later.
 */
import "server-only";

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
   * issued together. Measured from a laptop in India, where each trip costs
   * about 250ms: the lobby's four queries take 2170ms through one connection
   * and 496ms through four. In production the same trips are a local hop —
   * see the note above ensureSchema.
   */
  /*
   * `fetch_types: false` removes a round trip PER CONNECTION.
   *
   * postgres.js asks the server for array type OIDs the first time it opens
   * each socket, which showed up in the statement log as four `select b.oid,
   * b.typarray` queries on a cold request — one for each connection in the
   * pool, each one a full trip to another region before any real work.
   *
   * Safe here because nothing this app selects is an array type. Every column
   * read is text, numeric, bigint, boolean, timestamptz or jsonb, all of which
   * parse without the OID table. If an array column is ever added, this has to
   * come back off — the symptom would be a column arriving as a raw string.
   */
  sql = postgres(url, { max: 4, prepare: false, fetch_types: false });
  return sql;
}

/**
 * The schema, as one batch.
 *
 * The comments that used to sit between these statements are preserved on the
 * tables themselves below; the ordering is unchanged and every statement is
 * still IF NOT EXISTS, so running it against an existing database is a no-op.
 */
const SCHEMA = `
        CREATE TABLE IF NOT EXISTS hands ( id text PRIMARY KEY, cluster text NOT NULL DEFAULT 'devnet', table_id numeric NOT NULL, hand_number bigint NOT NULL, pot_chips bigint, result_hash text, record jsonb NOT NULL, settled_at timestamptz NOT NULL DEFAULT now() );
        ALTER TABLE hands ADD COLUMN IF NOT EXISTS cluster text NOT NULL DEFAULT 'devnet';
        CREATE INDEX IF NOT EXISTS hands_cluster_settled ON hands (cluster, settled_at);
        CREATE TABLE IF NOT EXISTS table_hands ( cluster text NOT NULL, table_id numeric NOT NULL, hands bigint NOT NULL, first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (cluster, table_id) );
        CREATE TABLE IF NOT EXISTS table_names ( table_id numeric PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now() );
        CREATE TABLE IF NOT EXISTS hand_players ( cluster text NOT NULL, table_id numeric NOT NULL, hand_number bigint NOT NULL, seat smallint NOT NULL, wallet text NOT NULL, payout_chips bigint NOT NULL, rake_chips bigint NOT NULL DEFAULT 0, contributed_chips bigint, showdown boolean NOT NULL DEFAULT false, settled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (cluster, table_id, hand_number, seat) );
        ALTER TABLE hand_players ADD COLUMN IF NOT EXISTS contributed_chips bigint;
        ALTER TABLE hand_players ADD COLUMN IF NOT EXISTS showdown boolean NOT NULL DEFAULT false;
        CREATE INDEX IF NOT EXISTS hand_players_wallet ON hand_players (cluster, wallet);
        CREATE TABLE IF NOT EXISTS players ( cluster text NOT NULL, wallet text NOT NULL, display_name text, name_updated_at timestamptz, PRIMARY KEY (cluster, wallet) );
`;

/*
 * MEASURED, 30 Aug 2026, so the next person does not repeat the mistake this
 * comment used to cause. Functions run in iad1 and the Neon database is in
 * us-east-1 — the SAME region — verified with `vercel inspect` (the build
 * lists every lambda as [iad1]) and the connection host
 * (…c-12.us-east-1.aws.neon.tech, already the -pooler endpoint). An earlier
 * version of this comment claimed the two were in different regions and sent
 * a whole round of optimisation work chasing a co-location problem that does
 * not exist.
 *
 * In production a round trip to the database is a local-network hop, and the
 * routes measure ~340ms end to end from India, of which almost all is the
 * requester's own distance to iad1 (x-vercel-id reads `bom1::iad1`). Six
 * minutes of idle adds nothing, so the Neon compute is not autosuspending.
 *
 * Where round trips DO cost is local development: a laptop in India talking
 * to us-east-1 pays ~250ms per trip, which is why `npm run dev` felt like it
 * hung and production never did. Keep the trip COUNT low anyway — it is what
 * makes dev usable — but do not tune production for a latency it does not
 * have.
 */

/**
 * Create-if-missing, once per process, in ONE round trip.
 *
 * This used to issue ten statements one after another, each awaited. That is
 * fine against a local database and ruinous against a remote one: measured
 * with statement logging, a cold request made 18 round trips and ten of them
 * were this function. At the ~250ms this database sits from the functions
 * reading it, that is two and a half seconds of schema checking before a
 * single figure is fetched — the whole of the "the API takes three seconds"
 * complaint, on a request that reads four numbers.
 *
 * Sent as one simple-protocol batch instead. Every statement is unchanged and
 * still idempotent, so the guarantee is the same; only the number of trips
 * changes, from ten to one. `unsafe` is safe here in the literal sense that
 * matters: the string is a compile-time constant with no interpolation of any
 * kind, and it is the only way to put multiple statements in one message.
 */
export function ensureSchema(s: Sql): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await s.unsafe(SCHEMA).simple();
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
