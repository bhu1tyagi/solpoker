"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import BN from "bn.js";
import { Modal } from "@/components/primitives/Surface";
import { HandsSkeleton, Loading } from "@/components/primitives/Skeletons";
import { VerifyCard } from "@/components/poker/VerifyCard";
import { listHands, type StoredHand } from "@/lib/history-db";
import { getBaseConnection } from "@/lib/connection";
import { decodeHistory } from "@/lib/decode";
import { historyPda, tablePda } from "@/lib/pdas";
import { spring, stagger } from "@/styles/theme";

/**
 * The hand history, over the table rather than instead of it.
 *
 * It used to be a page, which meant leaving the room to answer a question
 * about the room — and a player who wants to check the deal is by definition
 * mid-session, with a seat to come back to. So it opens in place: the table
 * stays behind the scrim, and closing it puts them back exactly where they
 * were, with no reload of a live table's subscriptions.
 *
 * Everything it reads is read when it opens. Hands come from this browser's
 * IndexedDB and the commit count from the base layer, and neither is worth a
 * request while the dialog is shut.
 */
export function HandHistoryModal({
  open,
  onClose,
  tableId,
}: {
  open: boolean;
  onClose: () => void;
  tableId: string;
}) {
  const [hands, setHands] = useState<StoredHand[] | null>(null);
  const [onChain, setOnChain] = useState<{
    handsRecorded: number;
    lastHandNumber: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    // Re-read on every open: hands land in the store as they are played, so a
    // dialog opened twice in a session must not show the first read twice.
    setHands(null);
    void (async () => {
      const stored = await listHands(Number(tableId));
      if (live) setHands(stored);
      try {
        const table = tablePda(new BN(tableId));
        const info = await getBaseConnection().getAccountInfo(historyPda(table));
        if (info && live) {
          const h = decodeHistory(new Uint8Array(info.data));
          setOnChain({
            handsRecorded: h.handsRecorded,
            lastHandNumber: h.lastHandNumber,
          });
        }
      } catch {
        // The base-layer record is extra context, not required.
      }
    })();
    return () => {
      live = false;
    };
  }, [open, tableId]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Hand history"
      width={620}
      hint={
        onChain
          ? `${onChain.handsRecorded} commit${
              onChain.handsRecorded === 1 ? "" : "s"
            } on Solana`
          : undefined
      }
    >
      {/* One line. This opens over a live table between hands, and the cards
          are the content — the paragraph the page used to carry was three
          sentences saying what one says. */}
      <p className="hh-lede">
        Verify recomputes the deck from the published seed, here in your
        browser.
      </p>

      {hands === null ? (
        <Loading label="Loading recorded hands">
          <HandsSkeleton rows={3} />
        </Loading>
      ) : hands.length === 0 ? (
        /*
         * The empty state has to answer a specific question, because the head
         * may be saying "8 commits on Solana" directly above an empty list:
         * why are the hands I played not here?
         *
         * Because nothing is ever backfilled. A hand is written down by the
         * tab that watched it settle — see use-hand-capture — so hands played
         * in another browser, or before this page was open, or across a reload
         * mid-hand, leave no record here to check. Saying "no hands yet" and
         * stopping would read as a bug, which is worse than the truth.
         */
        <div className="hh-empty">
          <p>No hands recorded in this browser.</p>
          <p className="hh-empty-sub">
            Records never leave the browser that made them, and nothing is
            backfilled.
            {onChain && (
              <>
                {" "}
                Solana&apos;s <span className="num">
                  {onChain.handsRecorded}
                </span>{" "}
                for this table {onChain.handsRecorded === 1 ? "was" : "were"}{" "}
                played on another browser or device.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="hh-list">
          {hands.map((h, i) => (
            <motion.div
              key={h.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.gentle, delay: Math.min(i, 8) * stagger.list }}
            >
              <VerifyCard hand={h} />
            </motion.div>
          ))}
        </div>
      )}

      {/* A footnote, under the hands and only when there are hands — the empty
          state above says this at more length because there it is the answer
          to a question, not a note. */}
      {hands !== null && hands.length > 0 && (
        <p className="hh-note">
          Kept in this browser: the chain reuses each hand&apos;s seed accounts
          for the next hand
          {onChain && (
            <>
              , and keeps a digest through hand{" "}
              <span className="num">{onChain.lastHandNumber}</span>
            </>
          )}
          .
        </p>
      )}
    </Modal>
  );
}
