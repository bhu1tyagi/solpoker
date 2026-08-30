"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { Modal } from "@/components/primitives/Surface";
import { Button } from "@/components/primitives/Button";
import { ChipGlyph } from "@/components/primitives/Chip";
import { ClockIcon, TableIcon } from "@/components/primitives/Icons";
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
import { formatUsd, formatUsdRange } from "@/lib/money";
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

const TIMEOUTS = [15, 30, 60];

const ROUND = { borderRadius: "var(--r-pill)" } as const;

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

  const s = STAKES[stake];

  /*
   * The same dialog the chips sheet is.
   *
   * Buying chips and cashing out already settled what a decision looks like in
   * this product: a pill track for the choice, a quiet line of facts under it,
   * a rounded field, one gradient CTA across the bottom. This screen used to
   * answer the same question with boxed cards, three uppercase section
   * headings, and every stake carrying four stacked figures — two of which
   * were the same number in chips and in dollars. Two dialogs one click apart
   * were speaking in two different accents.
   *
   * So the containers are gone. The stake is a track like the buy/sell track,
   * what that stake means is one line of facts like the chips sheet's, and the
   * clock is a row of pills like its 25% / Half / Max. Nothing here needed a
   * box; a box was standing in for a decision about hierarchy.
   */
  return (
    <Modal open={open} onClose={busy ? () => {} : onClose} title="New table">
      {/* A label, not an identity: 31 chars, plain charset, named once.
          Left empty, the table gets its generated name. */}
      <label className="xchg-field ct-name">
        <TableIcon size={17} />
        <input
          type="text"
          value={name}
          maxLength={31}
          placeholder="Table name (optional)"
          aria-label="Table name (optional)"
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
      </label>

      <div className="xchg-tabs" role="radiogroup" aria-label="Stakes">
        {STAKES.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="radio"
            aria-checked={stake === i}
            disabled={busy}
            className={stake === i ? "xchg-tab is-on" : "xchg-tab"}
            onClick={() => setStake(i)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* What the chosen stake actually costs, as facts rather than as a card.
          The figures are in dollars because chips are USDC and the lobby's own
          filter rail already names the tiers that way. */}
      <ul className="xchg-facts ct-facts">
        <li>
          <span className="num">
            {formatUsd(s.sb)} / {formatUsd(s.bb)}
          </span>{" "}
          blinds
        </li>
        <li>
          <ChipGlyph size={13} />
          <span className="num">{formatUsdRange(s.min, s.max)}</span> buy-in
        </li>
      </ul>

      <p className="xchg-balance ct-legend">
        <ClockIcon size={15} />
        Time to act
      </p>
      <div className="xchg-presets" role="radiogroup" aria-label="Time to act">
        {TIMEOUTS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={timeout === t}
            disabled={busy}
            className={timeout === t ? "xchg-preset is-on" : "xchg-preset"}
            onClick={() => setTimeoutSecs(t)}
          >
            <span className="num">{t}s</span>
          </button>
        ))}
      </div>

      {/* Side by side, and not the same size. Cancel takes the width of its
          own label; the affirmative takes the rest, so the row says which of
          the two the dialog is for without either of them shouting. */}
      <div className="xchg-actions ct-foot">
        {/* Pill-radius, to finish the shape the track and the presets above
            start. Set here rather than in the stylesheet because Button
            writes its radius as an inline style, which no rule outranks. */}
        <Button variant="ghost" size="lg" onClick={onClose} disabled={busy} style={ROUND}>
          Cancel
        </Button>
        <Button
          variant="gradient"
          size="lg"
          onClick={create}
          disabled={!publicKey}
          loading={busy}
          style={ROUND}
        >
          {busy && progress ? progress : "Create table"}
        </Button>
      </div>
    </Modal>
  );
}
