"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Modal } from "@/components/primitives/Surface";
import { ChipGlyph } from "@/components/primitives/Chip";
import { TableIcon } from "@/components/primitives/Icons";
import { formatUsd } from "@/lib/money";

/**
 * Putting chips on the table you are already sitting at.
 *
 * The room had no answer for a busted player. Their stack read "no chips",
 * the felt said it could not deal, and the only verb offered to them was the
 * one that leaves — so the ending of every losing session was being quietly
 * shown the door. A poker room's answer to this is a rebuy, and it is not an
 * unusual event: it is the most ordinary thing that happens at a table.
 *
 * The sheet is the sit-down sheet again, deliberately, because it is the same
 * decision: how much of what you hold goes onto the cloth. What it adds is the
 * one honest sentence about what a rebuy costs here — the chair leaves the
 * table for a moment, the hand in progress finishes first — because that is a
 * pause everyone at the table sees and this player is the one causing it.
 *
 * Two things can be missing, and they are different problems with different
 * buttons. No chips in the balance is answered by buying chips, which is a
 * USDC trade and lives in its own sheet. Chips in the balance is answered
 * here.
 */
export function RebuyModal({
  open,
  onClose,
  stack,
  balance,
  minBuyIn,
  maxBuyIn,
  stakesKnown,
  tableLive,
  busy,
  onRebuy,
  onBuyChips,
}: {
  open: boolean;
  onClose: () => void;
  /** What is on the chair right now. Zero for a busted player. */
  stack: number;
  /** What the wallet holds off the table. */
  balance: number;
  minBuyIn: number;
  maxBuyIn: number;
  stakesKnown: boolean;
  /** The table is on the rollup, so this costs a pause. */
  tableLive: boolean;
  busy: string | null;
  onRebuy: (total: number) => Promise<void>;
  onBuyChips: () => void;
}) {
  /*
   * A rebuy sets the stack outright rather than adding to it — the chair is
   * vacated and retaken — so every figure here is a TOTAL. What the player can
   * reach is the table's own range, capped by everything they have: the
   * balance plus whatever is already on the chair, which comes back to them on
   * the way through.
   */
  const purse = balance + stack;
  const ceiling = Math.min(maxBuyIn, purse);
  const canRebuy = stakesKnown && ceiling >= minBuyIn;
  const [total, setTotal] = useState(0);

  /*
   * Opens at the table minimum, not at everything they hold.
   *
   * A player who has just lost a stack is the last person who should be met
   * with a slider pushed to the end of its travel. The minimum is the smallest
   * true answer to "you cannot sit here with nothing", and the slider is right
   * there for anyone who wants more.
   */
  useEffect(() => {
    if (open) setTotal(minBuyIn);
  }, [open, minBuyIn]);

  const clamped = Math.min(Math.max(total, minBuyIn), Math.max(minBuyIn, ceiling));
  const working = busy?.startsWith("rebuy") ?? false;

  return (
    <Modal open={open} onClose={onClose} title={stack > 0 ? "Add chips" : "Buy back in"}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-3)",
          padding: "var(--sp-4)",
          marginBottom: "var(--sp-4)",
          background: "var(--c-felt-raised)",
          border: "1px solid var(--c-rule)",
          borderRadius: "var(--r-lg)",
        }}
      >
        <ChipGlyph size={30} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            className="num"
            style={{
              fontSize: "var(--t-display-lg-size)",
              fontWeight: 700,
              color: "var(--c-ink)",
              lineHeight: 1.05,
            }}
          >
            {canRebuy ? clamped.toLocaleString() : "—"}
          </span>
          <span style={{ fontSize: "var(--t-body-sm-size)", color: "var(--c-ink-muted)" }}>
            chips on the table · <span className="num">{formatUsd(canRebuy ? clamped : 0)}</span>
          </span>
        </div>
      </div>

      {canRebuy && (
        <>
          <input
            type="range"
            min={minBuyIn}
            max={Math.max(minBuyIn, ceiling)}
            step={1}
            value={clamped}
            aria-label="Chips on the table"
            onChange={(e) => setTotal(Number(e.target.value))}
            style={{ width: "100%", marginBottom: "var(--sp-3)" }}
          />

          <div style={{ display: "flex", gap: "var(--sp-2)", marginBottom: "var(--sp-4)" }}>
            {([
              ["Min", minBuyIn],
              ["Half", Math.round((minBuyIn + ceiling) / 2 / 10) * 10],
              ["Max", ceiling],
            ] as const).map(([label, v]) => (
              <Button
                key={label}
                size="sm"
                variant={clamped === v ? "primary" : "ghost"}
                onClick={() => setTotal(Math.max(minBuyIn, Math.min(v, ceiling)))}
              >
                {label}
              </Button>
            ))}
          </div>
        </>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "var(--sp-3)",
          flexWrap: "wrap",
          marginBottom: "var(--sp-4)",
          fontSize: "var(--t-label-size)",
          color: "var(--c-ink-faint)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <TableIcon size={13} />
          {stakesKnown ? (
            <>
              buy-in{" "}
              <span className="num">
                {minBuyIn.toLocaleString()}–{maxBuyIn.toLocaleString()}
              </span>
            </>
          ) : (
            "reading this table's stakes…"
          )}
        </span>
        <span>
          you hold <span className="num">{balance.toLocaleString()}</span> chips
        </span>
      </div>

      {/* The one thing a player deserves to know before they press it: this is
          not free to the room. The chair genuinely leaves the table, and the
          hand being played is finished first. */}
      {canRebuy && tableLive && (
        <p
          style={{
            margin: "0 0 var(--sp-4)",
            padding: "var(--sp-3)",
            borderRadius: "var(--r-md)",
            background: "var(--c-felt-raised)",
            borderLeft: "2px solid var(--c-info)",
            fontSize: "var(--t-body-sm-size)",
            color: "var(--c-ink-muted)",
            lineHeight: 1.5,
          }}
        >
          The hand in play finishes first, then your chair takes its new stack
          and the table carries on. Your chips are on Solana the whole way.
        </p>
      )}

      {stakesKnown && !canRebuy && (
        <p
          role="status"
          style={{
            margin: "0 0 var(--sp-4)",
            padding: "var(--sp-3)",
            borderRadius: "var(--r-md)",
            background: "var(--c-felt-raised)",
            borderLeft: "2px solid var(--c-info)",
            fontSize: "var(--t-body-sm-size)",
            color: "var(--c-ink-muted)",
            lineHeight: 1.5,
          }}
        >
          Sitting here takes {minBuyIn.toLocaleString()} chips (
          {formatUsd(minBuyIn)}) and you hold {purse.toLocaleString()}. Buy some
          chips and this seat is yours again.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {canRebuy && (
          <Button
            variant="primary"
            fullWidth
            loading={working}
            onClick={async () => {
              await onRebuy(clamped);
            }}
          >
            {busy === "rebuy:pausing"
              ? "Letting the hand finish…"
              : busy === "rebuy:leaving"
                ? "Picking your chair up…"
                : busy === "rebuy:sitting"
                  ? "Sitting back down…"
                  : busy === "rebuy:resuming"
                    ? "Dealing everyone back in…"
                    : `Put ${clamped.toLocaleString()} chips on the table`}
          </Button>
        )}
        <Button
          variant={canRebuy ? "ghost" : "gradient"}
          fullWidth
          disabled={working}
          onClick={onBuyChips}
        >
          Buy chips with USDC
        </Button>
      </div>
    </Modal>
  );
}
