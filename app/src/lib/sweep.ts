/**
 * Clearing away tables nobody came back to.
 *
 * Solana has no timers, so a table cannot delete itself. What happens instead
 * is that any client may remove one once it has sat empty for an hour, and the
 * rent goes back to whoever created it rather than to whoever swept it.
 *
 * The awkward part is that sweeping needs a signature, and a background job
 * that pops a wallet prompt every couple of minutes is worse than the clutter
 * it cleans up. So the sweep rides along with something the player is already
 * signing: creating a table batches in a couple of deletions, which costs no
 * extra prompt. Tables get tidied at roughly the rate they get made, which is
 * the rate that matters.
 */

import { PublicKey, Transaction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { SolpokerProgram } from "./anchor";
import { closeTableIx } from "./instructions";
import type { LobbyTable } from "@/hooks/use-tables";

/** How many to clear in one go, to keep the batch small. */
const PER_SWEEP = 2;

/**
 * Transactions that delete abandoned tables, for adding to a batch the player
 * is already signing. Returns an empty list when there is nothing to tidy.
 */
export async function sweepTransactions(
  connection: Connection,
  program: SolpokerProgram,
  tables: LobbyTable[],
  payer: PublicKey,
  blockhash: string,
): Promise<Transaction[]> {
  const targets = tables.filter((t) => t.abandoned).slice(0, PER_SWEEP);
  const out: Transaction[] = [];

  for (const t of targets) {
    try {
      const config = new PublicKey(t.table.config);
      const info = await connection.getAccountInfo(config);
      if (!info || info.data.length < 48) continue;
      // Rent returns to the creator, never to whoever swept it.
      const creator = new PublicKey(info.data.subarray(16, 48));

      const tx = new Transaction().add(
        await closeTableIx(
          program,
          new PublicKey(t.table.address),
          config,
          creator,
          payer,
        ),
      );
      tx.feePayer = payer;
      tx.recentBlockhash = blockhash;
      out.push(tx);
    } catch {
      // Housekeeping. If one cannot be prepared, skip it silently.
    }
  }
  return out;
}
