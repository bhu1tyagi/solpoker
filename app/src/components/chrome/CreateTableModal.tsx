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
import { CREATE_TABLE_LAMPORTS, MAX_SEATS } from "@/lib/constants";
import { playerPda, tablePda } from "@/lib/pdas";
import { friendlyError } from "@/lib/net";
import { formatUsdRange } from "@/lib/money";
import { sweepTransactions } from "@/lib/sweep";
import { toast } from "@/stores/ui-store";
import type { LobbyTable } from "@/hooks/use-tables";

// Chips are a cent each, so these read directly in money: a Micro buy-in is
// $4 to $20, and the High table seats $100 to $500. The shape is the classic
// one — min 20 big blinds, max 100 — at every level. Chip counts are ten times
// what they were when a chip was a dime; the dollar stakes are unchanged.
const STAKES = [
  { label: "Micro", sb: 10, bb: 20, min: 400, max: 2_000 },
  { label: "Low", sb: 50, bb: 100, min: 2_000, max: 10_000 },
  { label: "High", sb: 250, bb: 500, min: 10_000, max: 50_000 },
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
  const [name, setName] = useState("");
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

      // Ask before spending. Creation is three transactions and the last one —
      // the card slots — is the expensive one, so a wallet that is merely
      // short does not fail cleanly: it builds a table with seats and no cards
      // that the lobby then advertises to other players. Checking first turns
      // that into a sentence.
      setProgress("Checking your balance");
      const balance = await conn.getBalance(publicKey);
      if (balance < CREATE_TABLE_LAMPORTS) {
        throw new Error(
          `Opening a table needs about ${(CREATE_TABLE_LAMPORTS / 1e9).toFixed(3)} SOL for the ` +
            `accounts it creates, and this wallet holds ${(balance / 1e9).toFixed(4)}. ` +
            `Most of it comes back when the table is deleted.`,
        );
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

      // Register the name, set-once, fire-and-forget: the table exists
      // whether or not the registry hears about it, and the lobby falls back
      // to a generated name if this never lands.
      if (name.trim()) {
        void fetch("/api/table-name", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tableId: tableId.toString(), name: name.trim() }),
          keepalive: true,
        }).catch(() => {});
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
      <Field label="Table name (optional)">
        {/* A label, not an identity: 31 chars, plain charset, named once.
            Left empty, the table gets its generated name. */}
        <input
          type="text"
          value={name}
          maxLength={31}
          placeholder="Left blank, we pick one"
          onChange={(e) => setName(e.target.value)}
          className="modal-name-input"
          disabled={busy}
        />
      </Field>

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
                  borderRadius: "var(--r-lg)",
                  cursor: "pointer",
                  // The inner layer must be opaque: a translucent surface lets
                  // the border-box gradient wash across the whole card face
                  // and drown the small type.
                  border: "1.5px solid transparent",
                  background: active
                    ? "linear-gradient(var(--c-felt-raised), var(--c-felt-raised)) padding-box, var(--c-green) border-box"
                    : "linear-gradient(var(--c-felt-raised), var(--c-felt-raised)) padding-box, var(--c-rule) border-box",
                  color: "var(--c-ink)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                  boxShadow: active ? "var(--e-raised)" : "none",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: active ? "var(--c-ink)" : "var(--c-ink-faint)",
                  }}
                >
                  {s.label}
                </span>
                <span
                  className="num"
                  style={{ fontSize: "var(--t-display-md-size)", fontWeight: 600, lineHeight: 1.1 }}
                >
                  {s.sb}/{s.bb}
                </span>
                <span
                  className="num"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: "var(--t-label-size)",
                    fontWeight: 700,
                    color: "var(--c-ink)",
                  }}
                >
                  <ChipGlyph size={12} />
                  {s.min}–{s.max}
                </span>
                <span className="num" style={{ fontSize: "var(--t-label-size)", color: "var(--c-ink-muted)" }}>
                  {formatUsdRange(s.min, s.max)}
                </span>
              </motion.button>
            );
          })}
        </div>
      </Field>

      <Field label="Time to act">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--c-ink-faint)", display: "inline-flex" }}>
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
          fontSize: "var(--t-label-size)",
          color: "var(--c-ink-faint)",
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
