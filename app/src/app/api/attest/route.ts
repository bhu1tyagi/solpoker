/**
 * Verify the TEE endpoint's attestation quote.
 *
 * This runs on the server because the verifier is a CommonJS package that stubs
 * out node built-ins for browsers. Keeping it here means the client bundle never
 * has to deal with it.
 *
 * Be precise about what a pass means: it verifies a genuine Intel TDX quote
 * bound to a fresh challenge. It does not compare the enclave's measurements
 * against an expected allowlist, so it proves the hardware is real, not which
 * code is running inside it. The trust page says so too.
 */

import { NextResponse } from "next/server";
import { TEE_URL } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Cached {
  ok: boolean;
  checkedAt: number;
  detail: string;
  /**
   * Why it is not ok.
   *
   * "failed" means the quote was checked and did not hold up, which is a
   * security signal. "unavailable" means the check could not be run at all,
   * which is an infrastructure problem and says nothing about the enclave.
   * Collapsing the two would either cry wolf or hide a real failure, so they
   * are kept apart and worded differently.
   */
  reason?: "failed" | "unavailable";
}

/**
 * Errors that mean the verifier could not load or reach anything, rather than
 * a quote that did not verify. The verifier pulls in a CommonJS websocket
 * client whose own uuid dependency is ESM only, which some serverless runtimes
 * refuse to require.
 */
const CANNOT_RUN =
  /require\(\) of ES Module|ERR_REQUIRE_ESM|Cannot find module|MODULE_NOT_FOUND|dynamic import|fetch failed|ENOTFOUND|ETIMEDOUT/i;

const TTL_MS = 60 * 60 * 1000;
let cached: Cached | null = null;

export async function GET() {
  if (cached && Date.now() - cached.checkedAt < TTL_MS) {
    return NextResponse.json(cached);
  }

  try {
    const sdk = await import("@magicblock-labs/ephemeral-rollups-sdk");
    await sdk.verifyTeeRpcIntegrity(TEE_URL);
    cached = {
      ok: true,
      checkedAt: Date.now(),
      detail: "Intel TDX quote verified against a fresh challenge",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const cannotRun = CANNOT_RUN.test(message);
    cached = {
      ok: false,
      checkedAt: Date.now(),
      reason: cannotRun ? "unavailable" : "failed",
      detail: cannotRun
        ? "The attestation check could not run in this environment. This says " +
          "nothing about the enclave either way; verify it yourself against " +
          `${TEE_URL} if it matters to you.`
        : message,
    };
  }

  return NextResponse.json(cached);
}
