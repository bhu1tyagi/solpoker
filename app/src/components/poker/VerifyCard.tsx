"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/primitives/Button";
import { PlayingCard } from "@/components/primitives/PlayingCard";
import { verify, type VerifyResult } from "@/lib/verifier/verify-shuffle";
import type { StoredHand } from "@/lib/history-db";
import { spring } from "@/styles/theme";
import { NO_CARD } from "@/lib/engine/cards";

/**
 * Check a finished hand against its published seed.
 *
 * This runs entirely here, in your browser, on data the chain published. It
 * shares no code with the program, so agreement between them is evidence
 * rather than a tautology. If a deck had been rigged, this is where it shows.
 */
export function VerifyCard({ hand }: { hand: StoredHand }) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);

  const run = () => {
    setRunning(true);
    // Let the button state paint before the work starts.
    setTimeout(() => {
      try {
        setResult(verify(hand));
      } catch (e) {
        setResult({
          ok: false,
          problems: [String(e)],
          seed: "",
          deck: [],
          expectedBoard: [],
          expectedHoles: {},
        });
      } finally {
        setRunning(false);
        setOpen(true);
      }
    }, 40);
  };

  const shown = hand.seats?.filter((s) => s.revealed) ?? [];

  return (
    <div
      style={{
        background: "var(--c-felt-raised)",
        border: "1px solid var(--c-rule)",
        borderRadius: "var(--r-card)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: "var(--t-label-size)", color: "var(--c-ink-faint)" }}>
              hand
            </div>
            <div
              className="num"
              style={{ fontFamily: "var(--font-display)", fontSize: "var(--t-body-lg-size)" }}
            >
              {hand.handNumber}
            </div>
          </div>

          <div style={{ display: "flex", gap: 3 }}>
            {(hand.board ?? []).map((c, i) => (
              <PlayingCard key={i} card={c} size="sm" />
            ))}
          </div>

          {shown.length > 0 && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ fontSize: "var(--t-label-size)", color: "var(--c-ink-faint)" }}>
                shown
              </span>
              {shown.map((s) => (
                <div key={s.index} style={{ display: "flex", gap: 2 }}>
                  {(s.revealed ?? []).map((c, i) => (
                    <PlayingCard key={i} card={c} size="sm" />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AnimatePresence>
            {result && (
              <motion.span
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={spring.snappy}
                style={{
                  fontSize: "var(--t-body-sm-size)",
                  color: result.ok ? "var(--c-win)" : "var(--c-loss)",
                  fontWeight: 600,
                }}
              >
                {result.ok ? "Verified" : "Failed"}
              </motion.span>
            )}
          </AnimatePresence>
          <Button size="sm" variant={result?.ok ? "ghost" : "primary"} loading={running} onClick={run}>
            {result ? "Check again" : "Verify this shuffle"}
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {open && result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: "1px solid var(--c-rule)",
                fontSize: "var(--t-body-sm-size)",
                color: "var(--c-ink-muted)",
              }}
            >
              {result.ok ? (
                <>
                  <p style={{ margin: "0 0 8px" }}>
                    Recomputed the deck from the published seed. Every salt
                    matches the commitment posted before it, the seed is the
                    randomness combined with those salts, and the cards dealt are
                    the cards this deck gives.
                  </p>
                  <Mono label="seed" value={result.seed} />
                  <Mono
                    label="deck top"
                    value={result.deck
                      .slice(0, 12)
                      .map(nameOf)
                      .join(" ")}
                  />
                </>
              ) : (
                <>
                  <p style={{ margin: "0 0 8px", color: "var(--c-loss)" }}>
                    This hand does not match what was published:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {result.problems.map((p, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {p}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const nameOf = (b: number) =>
  b === NO_CARD ? "--" : `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}`;

function Mono({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
      <span style={{ color: "var(--c-ink-faint)", minWidth: 62, fontSize: "var(--t-label-size)" }}>
        {label}
      </span>
      <span
        className="chain"
        style={{
          // Seeds, salts and signatures are chain data, which is the only
          // thing set in the mono face. It was on a hardcoded stack here,
          // which is how the one face with a single job quietly stops
          // matching itself.
          wordBreak: "break-all",
          color: "var(--c-ink-muted)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
