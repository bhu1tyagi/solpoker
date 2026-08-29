import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";

/**
 * The wallet that fronts delegation rent, and nothing else.
 *
 * Starting a table parks about 0.047 SOL of rent-exemption in the delegation
 * program's buffers — fifteen accounts, refunded in full when the table comes
 * back to Solana. That was being asked of the player, whose wallet showed a
 * transfer of 0.05 SOL with no explanation and no way to tell a deposit from a
 * fee. The house fronts it now, and the player signs nothing for it.
 *
 * Deliberately NOT the treasury authority. This key lives on a server and
 * signs on demand, which is a different risk from the key that owns the house
 * tables and the chip vault; the two must never be the same wallet. Fund this
 * one with a working float and top it up, so the worst case of a server
 * compromise is bounded by what is sitting in it.
 *
 * What protects the float is not this file but the shape of the spend: the
 * money goes straight into delegation buffers and never passes through an
 * account the requester controls, so there is nothing here to extract. A
 * transfer-to-the-session-key design would have been the opposite — a session
 * costs about 0.014 SOL to create, so draining 0.05 at a time would have been
 * profitable.
 */
let funder: Keypair | null | undefined;

export function getFunder(): Keypair | null {
  if (funder !== undefined) return funder;

  // Production keeps it in the environment. Local development can point at the
  // same file the key was generated into, so a dev machine needs no secret in
  // its shell history.
  const raw = process.env.FUNDER_SECRET_KEY;
  const path = process.env.FUNDER_KEYPAIR_PATH;
  try {
    const json = raw ?? (path ? readFileSync(path, "utf8") : null);
    if (!json) {
      funder = null;
      return funder;
    }
    funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
  } catch (e) {
    console.error("funder key could not be read:", e);
    funder = null;
  }
  return funder;
}

/**
 * A ceiling on what the float can lose in a day, held per warm instance.
 *
 * Rent comes back, so this is not a spending limit so much as a limit on how
 * much can be locked up at once — the griefing case is somebody starting
 * tables purely to park the house's money in buffers. A real room will not
 * approach it; a script trying to will stop here.
 */
const DAILY_CAP_LAMPORTS = 2 * 1_000_000_000;
let spentToday = 0;
let dayStartedAt = 0;

export function withinDailyCap(lamports: number): boolean {
  const now = Date.now();
  if (now - dayStartedAt > 24 * 60 * 60 * 1000) {
    dayStartedAt = now;
    spentToday = 0;
  }
  return spentToday + lamports <= DAILY_CAP_LAMPORTS;
}

export function recordSpend(lamports: number) {
  spentToday += lamports;
}
