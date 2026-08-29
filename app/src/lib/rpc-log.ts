/**
 * Every RPC call, on the record.
 *
 * Reading an account is the simplest thing this app does and it was the
 * hardest to diagnose: a call that failed produced a console line naming a
 * bare address, with no way to tell which layer refused it, which of the four
 * reads on the page it belonged to, or whether it was slow, rate-limited, or
 * asking the wrong endpoint for an account that lives elsewhere. Guessing at
 * that from the outside is what made the same defect get misread as a retry
 * problem more than once.
 *
 * So both connections are built over this. It sits at the `fetch` seam web3.js
 * already exposes, which means it sees every call any code path makes —
 * including the ones inside Anchor and inside web3.js's own retry loop — with
 * no call site needing to remember to report anything.
 *
 * Two things come out of it. Live: one console line per call, in a shape that
 * groups by layer and shows duration, so a slow read is visibly slow rather
 * than merely late. After the fact: a ring buffer at `window.__rpc`, which
 * survives the error and can be read once something has gone wrong.
 *
 *   __rpc.summary()   counts and timings per method, per layer
 *   __rpc.errors()    just the failures, with their full addresses
 *   __rpc.recent(50)  the last N calls in order
 */

export type RpcLayer = "base" | "rollup";

export interface RpcRecord {
  at: number;
  layer: RpcLayer;
  method: string;
  /** First account-shaped param, which is what a read is usually about. */
  subject: string | null;
  ms: number;
  ok: boolean;
  /** "not-found" | "rate-limited" | "transient" | "rpc-error" | "http-<n>" */
  outcome: string;
  detail?: string;
}

const RING = 300;
const records: RpcRecord[] = [];

/**
 * A read taking longer than this is the endpoint, not the app.
 *
 * Measured against the same call on a public node: a `getSlot` answers in
 * about 270ms and a single `getAccountInfo` in about 230ms. When ours takes
 * three times that, no amount of caching or retrying on this side is the
 * explanation, and the log should say so plainly rather than leaving somebody
 * to conclude the code is retrying badly. That misreading has cost real time.
 */
const SLOW_MS = 600;

/**
 * Verbose by default in development only.
 *
 * In production the ring buffer still fills — it costs nothing and is the
 * thing worth having when a player reports something — but the per-call
 * console line is off unless it is switched on, because a busy table makes
 * several calls a second and would bury anything else in the console.
 *
 *   localStorage.setItem("solpoker:rpclog", "1")
 */
function verbose(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const flag = localStorage.getItem("solpoker:rpclog");
    if (flag === "1") return true;
    if (flag === "0") return false;
  } catch {
    // Storage unavailable; fall back to the environment.
  }
  return process.env.NODE_ENV === "development";
}

const short = (s: string) => (s.length > 12 ? `${s.slice(0, 8)}…` : s);

/**
 * What actually happened, in a word.
 *
 * These are deliberately different categories rather than one "error", because
 * they call for opposite responses and reading them as the same thing is how
 * an ordinary absent account gets treated as a network fault. "not-found" is
 * usually correct and expected — an account that has never been created, or
 * one being asked of the layer it does not live on. "rate-limited" means back
 * off. "transient" means try again. Only "rpc-error" is a genuine surprise.
 */
function classify(status: number, body: unknown): { ok: boolean; outcome: string; detail?: string } {
  if (status === 429) return { ok: false, outcome: "rate-limited" };
  if (status >= 500) return { ok: false, outcome: `http-${status}` };
  if (status !== 200) return { ok: false, outcome: `http-${status}` };

  const calls = Array.isArray(body) ? body : [body];
  for (const c of calls) {
    const err = (c as { error?: { message?: string; code?: number } } | null)?.error;
    if (!err) continue;
    const msg = err.message ?? "";
    /*
     * "could not find account" is the rollup's answer for an account that has
     * not been delegated to it — the single most confusing message this app
     * produces, because it names a real address that does exist perfectly well
     * on the base layer. It is a routing fact, not a fault, and it is recorded
     * as one.
     */
    if (/could not find account|Invalid param: could not find/i.test(msg)) {
      return { ok: false, outcome: "not-found", detail: msg };
    }
    if (/rate|429|too many/i.test(msg)) return { ok: false, outcome: "rate-limited", detail: msg };
    return { ok: false, outcome: "rpc-error", detail: msg };
  }
  return { ok: true, outcome: "ok" };
}

function record(r: RpcRecord) {
  records.push(r);
  if (records.length > RING) records.shift();

  if (r.ok && r.ms >= SLOW_MS) {
    console.warn(
      `[rpc ${r.layer}] SLOW ${r.method}${r.subject ? ` ${short(r.subject)}` : ""} ${r.ms}ms ` +
        `— the endpoint is answering slowly; this is not a retry or a cache miss`,
    );
  }

  if (!r.ok || verbose()) {
    const where = `${r.layer.padEnd(6)}`;
    const what = `${r.method}${r.subject ? ` ${short(r.subject)}` : ""}`;
    const line = `[rpc ${where}] ${what} ${r.ms}ms ${r.outcome}`;
    if (r.outcome === "not-found") {
      // Expected often enough that it is not a warning, but it must carry the
      // WHOLE address: a truncated one cannot be looked up, which is exactly
      // the dead end the old bare-address line left everyone at.
      console.info(`${line} — ${r.subject ?? "?"}${r.detail ? ` (${r.detail})` : ""}`);
    } else if (!r.ok) {
      console.warn(`${line} — ${r.subject ?? "?"}${r.detail ? ` (${r.detail})` : ""}`);
    } else {
      console.debug(line);
    }
  }
}

/** The account a call is about, if it names one. */
function subjectOf(params: unknown): string | null {
  if (!Array.isArray(params)) return null;
  const first = params[0];
  if (typeof first === "string" && first.length >= 32 && first.length <= 44) return first;
  if (Array.isArray(first) && typeof first[0] === "string") {
    return `${first.length} accounts`;
  }
  return null;
}

/**
 * A `fetch` that keeps the record. Passed to `new Connection(url, { fetch })`,
 * so it wraps every call the connection makes without any call site knowing.
 */
export function loggingFetch(layer: RpcLayer): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now();
    let method = "?";
    let subject: string | null = null;
    try {
      const parsed = JSON.parse(String(init?.body ?? "{}"));
      const calls = Array.isArray(parsed) ? parsed : [parsed];
      method = calls.map((c) => c?.method).filter(Boolean).join("+") || "?";
      subject = subjectOf(calls[0]?.params);
    } catch {
      // Not JSON-RPC — a health check or similar. Timed anyway.
    }

    try {
      const res = await fetch(input, init);
      const ms = Date.now() - started;
      // The body is read here and handed back as a fresh Response, because a
      // Response body can only be consumed once and the caller needs it.
      const text = await res.clone().text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        // Non-JSON error page; status alone classifies it.
      }
      const { ok, outcome, detail } = classify(res.status, body);
      record({ at: started, layer, method, subject, ms, ok, outcome, detail });
      return res;
    } catch (e) {
      // The request never completed: DNS, offline, connection reset. This is
      // the actual network blip, as distinct from anything the server said.
      const ms = Date.now() - started;
      record({
        at: started,
        layer,
        method,
        subject,
        ms,
        ok: false,
        outcome: "transient",
        detail: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  };
}

/** The buffer, and the three ways of reading it worth having ready to hand. */
export const rpcLog = {
  all: () => [...records],
  recent: (n = 50) => records.slice(-n),
  errors: () => records.filter((r) => !r.ok),
  /** How much of the wait is the endpoint's own answer time. */
  slow: () => records.filter((r) => r.ok && r.ms >= SLOW_MS).length,
  summary: () => {
    const by = new Map<string, { n: number; fail: number; totalMs: number; maxMs: number }>();
    for (const r of records) {
      const key = `${r.layer}/${r.method}`;
      const cur = by.get(key) ?? { n: 0, fail: 0, totalMs: 0, maxMs: 0 };
      cur.n += 1;
      if (!r.ok) cur.fail += 1;
      cur.totalMs += r.ms;
      cur.maxMs = Math.max(cur.maxMs, r.ms);
      by.set(key, cur);
    }
    return [...by.entries()]
      .map(([k, v]) => ({
        call: k,
        n: v.n,
        failed: v.fail,
        avgMs: Math.round(v.totalMs / v.n),
        maxMs: v.maxMs,
      }))
      .sort((a, b) => b.n - a.n);
  },
};

if (typeof window !== "undefined") {
  (window as unknown as { __rpc: typeof rpcLog }).__rpc = rpcLog;

  /*
   * One library log downgraded, and only one.
   *
   * web3.js reports a dropped subscription socket as
   * `console.error('ws error:', err.message)` — and a browser WebSocket error
   * event carries no `message`, so it always reads "ws error: undefined".
   * There is nothing in it to act on and nothing wrong: the same handler has
   * already marked the socket closed and the reconnect is on its way.
   *
   * It matters because Next's dev overlay promotes any console.error to a
   * full-screen dialog, so a routine reconnect looked like a fault worth
   * stopping for. This keeps the line — as a warning, where a reconnect
   * belongs — and matches that exact string and nothing else, so a real error
   * from anywhere still arrives as one.
   */
  const realError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args[0] === "ws error:") {
      console.warn("ws error (web3.js subscription socket dropped; reconnecting)", ...args.slice(1));
      return;
    }
    realError(...args);
  };
}
