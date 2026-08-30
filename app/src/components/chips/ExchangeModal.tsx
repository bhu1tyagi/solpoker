"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Modal } from "@/components/primitives/Surface";
import { ChipGlyph } from "@/components/primitives/Chip";
import { UsdcMark } from "@/components/primitives/Icons";
import { formatUsd } from "@/lib/money";

/**
 * Buying chips and cashing out.
 *
 * The one screen where the currency has to be unambiguous, so it says USDC in
 * as many ways as it can without nagging: in the title, on the badge beside the
 * amount, and in the line that names what leaves or arrives. The dollar figure
 * is the large number and the chip count is the small one, because dollars are
 * what a person is deciding about.
 */
export function ExchangeModal({
  mode,
  setMode,
  onClose,
  chips,
  affordable,
  busy,
  onBuy,
  onSell,
  blocked,
  ready,
}: {
  mode: "buy" | "sell" | null;
  setMode: (m: "buy" | "sell") => void;
  onClose: () => void;
  chips: number;
  affordable: number;
  busy: "buy" | "sell" | null;
  onBuy: (chips: number) => Promise<void>;
  onSell: (chips: number) => Promise<void>;
  blocked: string | null;
  ready: boolean;
}) {
  const [amount, setAmount] = useState(0);
  // The dollar field keeps its own text while it is being typed in, or the
  // derived value would rewrite the box mid-keystroke and eat the cursor.
  const [usdText, setUsdText] = useState("");
  const editingUsd = useRef(false);
  const buying = mode === "buy";
  const max = buying ? affordable : chips;
  const clamped = Math.min(Math.max(amount, 0), max);

  // Presets scaled to what this wallet actually has, not a fixed ladder.
  // Cashing out $4.60 used to offer $10 / $50 / $100 and disable all three,
  // which is a row of buttons whose only message is that you cannot afford
  // anything. Quarter, half, all — always reachable, always meaningful.
  const presets: [string, number][] = [
    ["25%", Math.floor(max * 0.25)],
    ["Half", Math.floor(max * 0.5)],
    ["Max", max],
  ];

  // Open at something sensible rather than at zero with a dead CTA.
  useEffect(() => {
    if (mode) setAmount(max);
  }, [mode, max]);

  useEffect(() => {
    if (!editingUsd.current) setUsdText((clamped / 100).toFixed(2));
  }, [clamped]);
  // Until the balances land, every control here would be disabled with nothing
  // to explain why. Say so instead: a dead row of buttons reads as broken.
  const waiting = !ready;

  const chipField = (
    <label className="xchg-field" key="chips">
      <ChipGlyph size={17} />
      <input
        className="num"
        inputMode="numeric"
        aria-label={buying ? "Chips to buy" : "Chips to cash out"}
        value={clamped === 0 ? "" : String(clamped)}
        placeholder="0"
        disabled={max === 0}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^\d]/g, ""));
          setAmount(Number.isFinite(n) ? n : 0);
        }}
      />
    </label>
  );

  const usdField = (
    <label className="xchg-field" key="usd">
      <UsdcMark size={17} />
      <input
        className="num"
        inputMode="decimal"
        aria-label="Amount in USDC"
        value={usdText}
        placeholder="0.00"
        disabled={max === 0}
        onFocus={() => (editingUsd.current = true)}
        onBlur={() => {
          editingUsd.current = false;
          setUsdText((clamped / 100).toFixed(2));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, "");
          setUsdText(t);
          const n = Number(t);
          if (Number.isFinite(n)) setAmount(Math.round(n * 100));
        }}
      />
    </label>
  );

  return (
    <Modal
      open={mode !== null}
      onClose={onClose}
      title="Chips"
    >
      {/* Buying and cashing out are the same dialog with the direction
          flipped, so they are tabs rather than two ways in. */}
      <div className="xchg-tabs" role="tablist" aria-label="Direction">
        <button
          type="button"
          role="tab"
          aria-selected={buying}
          className={buying ? "xchg-tab is-on" : "xchg-tab"}
          onClick={() => setMode("buy")}
        >
          Buy chips
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!buying}
          className={!buying ? "xchg-tab is-on" : "xchg-tab"}
          onClick={() => setMode("sell")}
        >
          Cash out
        </button>
      </div>

      <p className="xchg-balance">
        <ChipGlyph size={15} />
        <span className="num">{chips.toLocaleString()}</span> chips
        <span className="xchg-balance-sep" aria-hidden />
        <span className="num">{formatUsd(chips)}</span>
      </p>

      <div className="xchg-presets">
        {presets.map(([label, v]) => (
          <button
            key={label}
            type="button"
            className={clamped === v && v > 0 ? "xchg-preset is-on" : "xchg-preset"}
            aria-pressed={clamped === v && v > 0}
            disabled={max === 0}
            onClick={() => setAmount(v)}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        Both sides are editable and each drives the other: some players think
        in chips, some in dollars, and neither should do the arithmetic.

        The LEFT field is always what you give up. Buying, that is USDC
        leaving the wallet; cashing out, it is chips leaving the table. The
        pair reads left to right as the trade actually happens, so the
        direction is legible without reading the tab.
      */}
      <div className="xchg-convert">
        {buying ? usdField : chipField}
        <span className="xchg-eq" aria-hidden>
          =
        </span>
        {buying ? chipField : usdField}
      </div>

      {/* The facts, as facts. This replaced a paragraph nobody read, and the
          SOL line stays because a wallet can hold plenty of dollars and still
          be unable to sit down. */}
      <ul className="xchg-facts">
        <li>
          Min <span className="num">{formatUsd(1)}</span>
        </li>
        <li>
          1 chip = <span className="num">{formatUsd(1)}</span>
        </li>
        <li>{buying ? "Fees in SOL" : "Table chips must be picked up first"}</li>
      </ul>

      {(waiting || blocked) && (
        <p role="status" className="xchg-status">
          {waiting ? "Checking your balance" : blocked}
        </p>
      )}

      <div className="xchg-actions">
        <Button
          variant="gradient"
          size="lg"
          fullWidth
          disabled={clamped === 0 || blocked !== null || waiting}
          loading={busy !== null}
          onClick={async () => {
            if (buying) await onBuy(clamped);
            else await onSell(clamped);
            onClose();
          }}
        >
          {buying ? `Buy for ${formatUsd(clamped)}` : `Cash out ${formatUsd(clamped)}`}
        </Button>
      </div>
    </Modal>
  );
}
