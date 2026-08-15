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
}

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
    cached = {
      ok: false,
      checkedAt: Date.now(),
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  return NextResponse.json(cached);
}
