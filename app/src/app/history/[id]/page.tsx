"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { TopBar } from "@/components/chrome/TopBar";
import { Panel } from "@/components/primitives/Surface";
import { HandsSkeleton, Loading } from "@/components/primitives/Skeletons";
import { Button } from "@/components/primitives/Button";
import { VerifyCard } from "@/components/poker/VerifyCard";
import { listHands, type StoredHand } from "@/lib/history-db";
import { getBaseConnection } from "@/lib/connection";
import { decodeHistory } from "@/lib/decode";
import { historyPda, tablePda } from "@/lib/pdas";
import { spring, stagger } from "@/styles/theme";
import BN from "bn.js";

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [hands, setHands] = useState<StoredHand[] | null>(null);
  const [onChain, setOnChain] = useState<{
    handsRecorded: number;
    lastHandNumber: number;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      setHands(await listHands(Number(id)));
      try {
        const table = tablePda(new BN(id));
        const info = await getBaseConnection().getAccountInfo(historyPda(table));
        if (info) {
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
  }, [id]);

  return (
    <>
      <TopBar />

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px 80px" }}>
        <Link
          href={`/table/${id}`}
          style={{ fontSize: "var(--t-body-sm-size)", color: "var(--c-ink-muted)", textDecoration: "none" }}
        >
          Back to the table
        </Link>

        <h1 style={{ fontSize: "var(--t-display-lg-size)", margin: "18px 0 8px" }}>Hand history</h1>
        <p style={{ color: "var(--c-ink-muted)", marginTop: 0, maxWidth: 620 }}>
          Every finished hand, with the randomness and salts it was dealt from.
          Press verify and your browser recomputes the deck to check the cards
          match. Nothing is sent anywhere to do it.
        </p>

        <Panel style={{ margin: "22px 0" }}>
          <p style={{ margin: 0, fontSize: "var(--t-body-sm-size)", color: "var(--c-ink-muted)" }}>
            Hands are recorded here as you play them, because the chain does not
            keep them: the accounts holding a hand&apos;s salts and seed are
            reused by the next hand. Solana keeps a digest of each settled hand,
            which is what ties these records to something you did not write
            yourself.
          </p>
          {onChain && (
            <p
              style={{
                margin: "10px 0 0",
                fontSize: "var(--t-label-size)",
                color: "var(--c-ink-faint)",
              }}
            >
              Solana has recorded {onChain.handsRecorded} commit
              {onChain.handsRecorded === 1 ? "" : "s"} for this table, through
              hand {onChain.lastHandNumber}.
            </p>
          )}
        </Panel>

        {hands === null ? (
          <Loading label="Loading recorded hands">
            <HandsSkeleton rows={3} />
          </Loading>
        ) : hands.length === 0 ? (
          <Panel style={{ textAlign: "center", padding: 40 }}>
            <p style={{ color: "var(--c-ink-muted)", margin: "0 0 12px" }}>
              No hands recorded in this browser yet.
            </p>
            <Link href={`/table/${id}`} style={{ textDecoration: "none" }}>
              <Button variant="ghost" size="sm">
                Go and play one
              </Button>
            </Link>
          </Panel>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
      </main>
    </>
  );
}
