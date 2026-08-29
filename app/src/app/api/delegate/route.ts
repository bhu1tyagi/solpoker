import { NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { makeProgram } from "@/lib/anchor";
import { decodeTable } from "@/lib/decode";
import { delegateCoreIx, delegateSeatIx } from "@/lib/instructions";
import { seatPda, tablePda } from "@/lib/pdas";
import { MAX_SEATS, PROGRAM_ID } from "@/lib/constants";
import { getFunder, recordSpend, withinDailyCap } from "@/lib/server/funder";
import { serverRpc, serverFetch } from "@/lib/server/rpc";

export const runtime = "nodejs";

/**
 * The house pays the table's rent.
 *
 * A start parks rent-exemption for fifteen accounts in the delegation
 * program's buffers, and the player was being asked for it: a wallet prompt
 * for about 0.05 SOL, no explanation, and no way to tell a refundable deposit
 * from the price of playing. The funder wallet signs these instead, so the
 * player signs nothing to start a table.
 *
 * This is safe to expose because of WHERE the money goes, not because of who
 * is asking. `delegate_core` and `delegate_seat` take the payer as their only
 * signer, so the funder can pay directly and the lamports land in delegation
 * buffers owned by the delegation program. They never pass through an account
 * the caller controls, so there is nothing here to steal — only rent to park,
 * and it comes back to the funder when the table returns to Solana.
 *
 * What remains is griefing: delegating tables nobody will play, to lock the
 * float up in buffers. The checks below are aimed at exactly that, and none of
 * them are about identity, because identity is not what is at risk.
 */

/** A start is only worth paying for once there is a game to play. */
const MIN_SEATED = 2;

/** Roughly what one step parks, for the daily cap's arithmetic. */
const CORE_LAMPORTS = 9_200_000;
const SEAT_LAMPORTS = 6_400_000;

/** One table cannot be re-delegated in a tight loop. */
const lastDelegatedAt = new Map<string, number>();
const PER_TABLE_COOLDOWN_MS = 20_000;

export async function POST(req: Request) {
  if (process.env.FUNDER_DISABLED === "1") {
    return NextResponse.json({ error: "house funding is off" }, { status: 503 });
  }
  const funder = getFunder();
  if (!funder) {
    return NextResponse.json({ error: "no funder configured" }, { status: 503 });
  }
  const url = serverRpc();
  if (!url) return NextResponse.json({ error: "no rpc configured" }, { status: 503 });

  let body: { tableId?: string; step?: string; index?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { tableId, step, index } = body;
  if (!tableId || !/^\d+$/.test(tableId)) {
    return NextResponse.json({ error: "bad table id" }, { status: 400 });
  }
  if (step !== "core" && step !== "seat") {
    return NextResponse.json({ error: "bad step" }, { status: 400 });
  }
  if (step === "seat" && (typeof index !== "number" || index < 0 || index >= MAX_SEATS)) {
    return NextResponse.json({ error: "bad seat index" }, { status: 400 });
  }

  const cost = step === "core" ? CORE_LAMPORTS : SEAT_LAMPORTS;
  if (!withinDailyCap(cost)) {
    return NextResponse.json({ error: "daily funding cap reached" }, { status: 429 });
  }

  try {
    const conn = new Connection(url, { commitment: "confirmed", fetch: serverFetch() });
    const id = new BN(tableId);
    const table = tablePda(id);

    // The table has to be real, ours, and worth starting. A table nobody is
    // sitting at does not need to be on the rollup, and paying to put it there
    // is the whole of the griefing case.
    const info = await conn.getAccountInfo(table);
    if (!info) return NextResponse.json({ error: "no such table" }, { status: 404 });

    /*
     * "Already delegated" is a question about the account being asked for, not
     * about the table.
     *
     * This checked the table for every step — and `delegate_core` is what makes
     * the table delegation-owned, so once it succeeded every following seat
     * request saw a table that was no longer ours and returned ok, having done
     * nothing. Six seats reported success, none moved, and the start went on to
     * secure hole accounts still sitting on Solana. That is the half-delegated
     * table this route was supposed to help build, not create: core on the
     * rollup, seats behind, and a room where nobody can be dealt in.
     *
     * So a seat step asks about its own seat, and a delegated table is exactly
     * what it should expect to find.
     */
    const subject =
      step === "core" ? info : await conn.getAccountInfo(seatPda(table, index as number));
    if (!subject) return NextResponse.json({ error: "no such account" }, { status: 404 });
    if (!subject.owner.equals(PROGRAM_ID)) {
      return NextResponse.json({ ok: true, alreadyDelegated: true });
    }
    const view = decodeTable(new Uint8Array(info.data), table.toBase58());
    const seated = view.seats.filter(Boolean).length;
    if (seated < MIN_SEATED) {
      return NextResponse.json(
        { error: `a table needs ${MIN_SEATED} players before the house will start it` },
        { status: 409 },
      );
    }

    const last = lastDelegatedAt.get(tableId) ?? 0;
    if (step === "core" && Date.now() - last < PER_TABLE_COOLDOWN_MS) {
      return NextResponse.json({ error: "that table was just started" }, { status: 429 });
    }

    const program = makeProgram(conn);
    const ix =
      step === "core"
        ? await delegateCoreIx(program, id, funder.publicKey)
        : await delegateSeatIx(program, table, index as number, funder.publicKey);

    const tx = new Transaction().add(ix);
    const bh = await conn.getLatestBlockhash();
    tx.feePayer = funder.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.sign(funder);

    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });

    /*
     * Confirmed by asking, not by subscribing.
     *
     * `confirmTransaction` opens a websocket and waits on `signatureSubscribe`.
     * On a server that is the wrong shape twice over: it fails outright in this
     * Node build (`bufferUtil.mask is not a function`) and, worse, it fails by
     * retrying forever rather than throwing, which wedges the whole route and
     * every request behind it. Polling is a handful of cheap calls and it
     * cannot hang: it has a deadline.
     */
    const deadline = Date.now() + 30_000;
    let err: unknown = null;
    let landed = false;
    while (Date.now() < deadline) {
      const { value } = await conn.getSignatureStatus(sig, { searchTransactionHistory: false });
      if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
        err = value.err;
        landed = true;
        break;
      }
      if (value?.err) {
        err = value.err;
        landed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 700));
    }
    if (!landed) throw new Error(`${step} did not confirm within 30s (${sig})`);
    if (err) throw new Error(JSON.stringify(err));

    recordSpend(cost);
    if (step === "core") lastDelegatedAt.set(tableId, Date.now());
    console.log(`[funder] ${step}${step === "seat" ? ` ${index}` : ""} table ${tableId} -> ${sig}`);
    return NextResponse.json({ ok: true, signature: sig });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[funder] ${step} failed for table ${tableId}:`, detail);
    return NextResponse.json({ error: detail }, { status: 502 });
  }
}

/** Whether the house is funding starts, and what it has left to do it with. */
export async function GET() {
  const funder = getFunder();
  const url = serverRpc();
  if (!funder || !url || process.env.FUNDER_DISABLED === "1") {
    return NextResponse.json({ available: false });
  }
  try {
    const conn = new Connection(url, { commitment: "confirmed", fetch: serverFetch() });
    const lamports = await conn.getBalance(funder.publicKey);
    // One whole start, or the client should ask the player instead of
    // discovering the shortfall halfway through delegating.
    const enough = lamports >= CORE_LAMPORTS + MAX_SEATS * SEAT_LAMPORTS + 5_000_000;
    return NextResponse.json({
      available: enough,
      funder: funder.publicKey.toBase58(),
      lamports,
    });
  } catch {
    return NextResponse.json({ available: false });
  }
}
