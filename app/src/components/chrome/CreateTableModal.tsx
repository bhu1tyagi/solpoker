"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { Modal } from "@/components/primitives/Surface";
import { Button } from "@/components/primitives/Button";
import { getBaseConnection } from "@/lib/connection";
import { makeProgram } from "@/lib/anchor";
import {
  createHistoryIx,
  createHoleIx,
  createSeatIx,
  createTableIx,
  initPlayerIx,
} from "@/lib/instructions";
import { MAX_SEATS } from "@/lib/constants";
import { playerPda, tablePda } from "@/lib/pdas";
import { friendlyError } from "@/lib/net";
import { sweepTransactions } from "@/lib/sweep";
import { toast } from "@/stores/ui-store";
import type { LobbyTable } from "@/hooks/use-tables";

const STAKES = [
  { label: "Micro", sb: 5, bb: 10, min: 200, max: 2_000 },
  { label: "Low", sb: 25, bb: 50, min: 1_000, max: 10_000 },
  { label: "High", sb: 100, bb: 200, min: 4_000, max: 40_000 },
];

/**
 * Creating a table takes several instructions, so they are batched into as few
 * transactions as the size limit allows. Three signatures instead of fifteen.
 */
export function CreateTableModal({
  open,
  onClose,
  onCreated,
  tables = [],
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  /** Used to tidy away abandoned tables in the same signature. */
  tables?: LobbyTable[];
}) {
  const { publicKey, signAllTransactions } = useWallet();
  const router = useRouter();
  const [stake, setStake] = useState(0);
  const [timeout, setTimeoutSecs] = useState(30);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  const create = async () => {
    if (!publicKey || !signAllTransactions) return;
    setBusy(true);
    try {
      const conn = getBaseConnection();
      const program = makeProgram(conn);
      const s = STAKES[stake];
      // Unique per creation, so two tables never collide on the same address:
      // milliseconds of wall clock with random low digits, still well inside
      // what a u64 and a double can both hold exactly.
      const tableId = new BN(Date.now()).muln(1000).addn(Math.floor(Math.random() * 1000));
      const table = tablePda(tableId);

      setProgress("Preparing");
      const first = [];
      // init_player is a plain init, so only include it if there is no account.
      if (!(await conn.getAccountInfo(playerPda(publicKey)))) {
        first.push(await initPlayerIx(program, publicKey));
      }
      first.push(
        await createTableIx(
          program,
          {
            tableId,
            smallBlind: s.sb,
            bigBlind: s.bb,
            minBuyIn: s.min,
            maxBuyIn: s.max,
            timeoutSecs: timeout,
          },
          publicKey,
        ),
        await createHistoryIx(program, table, publicKey),
      );

      const seatIxs = [];
      const holeIxs = [];
      for (let i = 0; i < MAX_SEATS; i++) {
        seatIxs.push(await createSeatIx(program, table, i, publicKey));
        holeIxs.push(await createHoleIx(program, table, i, publicKey));
      }

      const bh = await conn.getLatestBlockhash();
      const txs = [first, seatIxs, holeIxs].map((ixs) => {
        const tx = new Transaction().add(...ixs);
        tx.feePayer = publicKey;
        tx.recentBlockhash = bh.blockhash;
        return tx;
      });

      // Tidy away a couple of long-abandoned tables while we are here. Same
      // signature, so it costs the player nothing.
      const sweeps = await sweepTransactions(conn, program, tables, publicKey, bh.blockhash);

      setProgress("Waiting for your wallet");
      const signed = await signAllTransactions([...txs, ...sweeps]);

      // Order matters: seats and holes are seeded on the table address.
      const labels = ["table", "seats", "card slots"];
      for (let i = 0; i < txs.length; i++) {
        setProgress(`Creating ${labels[i]}`);
        const sig = await conn.sendRawTransaction(signed[i].serialize(), {
          skipPreflight: true,
        });
        const conf = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
        if (conf.value.err) {
          throw new Error(`${labels[i]} failed: ${JSON.stringify(conf.value.err)}`);
        }
      }

      // Best effort, and never allowed to fail the creation.
      for (let i = txs.length; i < signed.length; i++) {
        try {
          await conn.sendRawTransaction(signed[i].serialize(), { skipPreflight: true });
        } catch {
          // Someone else swept it first.
        }
      }

      toast("Table created", "good");
      onCreated();
      onClose();
      router.push(`/table/${tableId.toString()}`);
    } catch (e) {
      toast(friendlyError(e), "bad");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="New table">
      <p style={{ color: "var(--text-dim)", fontSize: "var(--t-sm)", marginTop: 0 }}>
        Six seats, no limit. Chips are bought with SOL and sell back at the
        same fixed rate, so the stakes here are the stakes.
      </p>

      <Field label="Stakes">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STAKES.map((s, i) => (
            <Button
              key={s.label}
              size="sm"
              variant={stake === i ? "primary" : "ghost"}
              onClick={() => setStake(i)}
            >
              {s.sb} / {s.bb}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="Time to act">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[15, 30, 60].map((t) => (
            <Button
              key={t}
              size="sm"
              variant={timeout === t ? "primary" : "ghost"}
              onClick={() => setTimeoutSecs(t)}
            >
              {t}s
            </Button>
          ))}
        </div>
      </Field>

      <div style={{ marginTop: 22, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="primary" onClick={create} disabled={!publicKey} loading={busy}>
          Create table
        </Button>
        <Button variant="quiet" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        {progress && (
          <span style={{ fontSize: "var(--t-xs)", color: "var(--text-faint)" }}>
            {progress}
          </span>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          fontSize: "var(--t-xs)",
          color: "var(--text-faint)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
