"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { motion } from "motion/react";
import { Modal } from "@/components/primitives/Surface";
import { Button } from "@/components/primitives/Button";
import { ChipGlyph } from "@/components/primitives/Chip";
import { ClockIcon } from "@/components/primitives/Icons";
import { spring } from "@/styles/theme";
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

// Chips are 0.001 SOL each, so these read directly in money: a Micro buy-in
// is 0.04 to 0.2 SOL, and the High table seats 1 to 5 SOL. The shape is the
// classic one — min 20 big blinds, max 100 — at every level.
const STAKES = [
  { label: "Micro", sb: 1, bb: 2, min: 40, max: 200 },
  { label: "Low", sb: 5, bb: 10, min: 200, max: 1_000 },
  { label: "High", sb: 25, bb: 50, min: 1_000, max: 5_000 },
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
      <Field label="Stakes">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {STAKES.map((s, i) => {
            const active = stake === i;
            return (
              <motion.button
                key={s.label}
                onClick={() => setStake(i)}
                aria-pressed={active}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                animate={{ scale: active ? 1.02 : 1 }}
                transition={spring.snappy}
                style={{
                  textAlign: "center",
                  padding: "14px 10px 12px",
                  borderRadius: "var(--r-panel)",
                  cursor: "pointer",
                  // The inner layer must be opaque: a translucent surface lets
                  // the border-box gradient wash across the whole card face
                  // and drown the small type.
                  border: "1.5px solid transparent",
                  background: active
                    ? "linear-gradient(var(--surface-solid), var(--surface-solid)) padding-box, var(--sol-grad-flat) border-box"
                    : "linear-gradient(var(--surface-solid), var(--surface-solid)) padding-box, var(--line) border-box",
                  color: "var(--text)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  boxShadow: active ? "0 10px 26px -14px rgba(20,241,149,0.35)" : "none",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: active ? "var(--text)" : "var(--text-faint)",
                  }}
                >
                  {s.label}
                </span>
                <span
                  className="tnum"
                  style={{ fontFamily: "var(--font-display)", fontSize: "var(--t-lg)", lineHeight: 1.1 }}
                >
                  {s.sb}/{s.bb}
                </span>
                <span
                  className="tnum"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: "var(--t-xs)",
                    color: "var(--gold)",
                  }}
                >
                  <ChipGlyph size={12} />
                  {s.min}–{s.max}
                </span>
                <span className="tnum" style={{ fontSize: "var(--t-xs)", color: "var(--text-dim)" }}>
                  {s.min / 1000}–{s.max / 1000} SOL
                </span>
              </motion.button>
            );
          })}
        </div>
      </Field>

      <Field label="Time to act">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--text-faint)", display: "inline-flex" }}>
            <ClockIcon size={17} />
          </span>
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

      <div style={{ marginTop: 22, display: "flex", gap: 10, alignItems: "center" }}>
        <Button variant="primary" fullWidth onClick={create} disabled={!publicKey} loading={busy}>
          {busy && progress ? progress : "Create table"}
        </Button>
        <Button variant="quiet" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
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
