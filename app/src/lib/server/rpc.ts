import "server-only";

/**
 * The endpoint the server calls, which need not be the one the browser calls.
 *
 * `NEXT_PUBLIC_BASE_RPC` is, by design, public: it is compiled into the client
 * bundle because the browser genuinely has to reach an RPC endpoint, and
 * anyone can read it out of the network panel. That is not a leak to be
 * plugged so much as a fact to be planned around — a key a browser uses is a
 * key the world can see.
 *
 * The way to plan around it is two keys rather than one. The public key is
 * locked down at the provider — allowed origins set to this site's domains, so
 * a copy of the URL pasted into somebody else's app is refused before it costs
 * anything, and rate limits low enough that one browser cannot do damage. The
 * server key, set here as `BASE_RPC` with no NEXT_PUBLIC_ prefix, is never
 * shipped anywhere and can stay unrestricted: it is what runs the sweeps, the
 * funder, and anything a locked-down browser key would refuse.
 *
 * Falling back to the public variable keeps a single-key setup working
 * unchanged, so this costs nothing until the second key exists.
 *
 * Origin locking is browser-enforced and a script can forge the header, so it
 * stops other sites and casual copying rather than a determined attacker. What
 * makes it worth doing is that it is free: the check happens at the provider's
 * edge, where the request already lands, so it costs no extra hop and no
 * latency. A proxy through this server would be airtight and would put a whole
 * round trip in front of every read.
 */
export function serverRpc(): string | null {
  return process.env.BASE_RPC || process.env.NEXT_PUBLIC_BASE_RPC || null;
}
