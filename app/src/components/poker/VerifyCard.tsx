"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/primitives/Button";
import { PlayingCard } from "@/components/primitives/PlayingCard";
import { CheckIcon, CloseIcon } from "@/components/primitives/Icons";
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
 *
 * The row lives in a dialog now rather than on a page of its own, so it is
 * built to hold at 390px: the hand number and the verdict on one line, the
 * cards on the next, and the button on the end of the first line where it does
 * not move as the cards below it wrap.
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
  const board = (hand.board ?? []).filter((c) => c !== NO_CARD);

  return (
    <article className="vc">
      <div className="vc-head">
        <span className="vc-hand">
          hand <span className="num">{hand.handNumber}</span>
        </span>

        <AnimatePresence>
          {result && (
            <motion.span
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={spring.snappy}
              /* The word and the glyph both say it. Green against red is the
                 one pairing this product may not lean on alone. */
              className={result.ok ? "vc-verdict is-ok" : "vc-verdict is-bad"}
            >
              {result.ok ? <CheckIcon size={14} /> : <CloseIcon size={14} />}
              {result.ok ? "Verified" : "Failed"}
            </motion.span>
          )}
        </AnimatePresence>

        {/* Never the green fill, however central the action is. A dialog that
            lists twenty hands would carry twenty primary CTAs, and the one
            per region the system allows would stop meaning anything. The
            verdict is what earns the colour here. */}
        <Button size="sm" variant="ghost" loading={running} onClick={run}>
          {result ? "Check again" : "Verify this shuffle"}
        </Button>
      </div>

      <div className="vc-cards">
        {/* A hand everyone folded into has no board and nothing shown. Saying
            so beats an empty strip, and beats five card backs — nothing was
            dealt there, so nothing is hidden there either. */}
        {board.length === 0 && shown.length === 0 && (
          <span className="vc-tag">ended before the flop</span>
        )}

        {/* No "board" label. Five community cards in a row are the board to
            anyone who has played a hand, and the word only pushed the cards
            off the left edge every other line in the dialog sits on. */}
        {board.length > 0 && (
          <div className="vc-cardrow">
            {board.map((c, i) => (
              <PlayingCard key={i} card={c} size="sm" />
            ))}
          </div>
        )}

        {shown.length > 0 && (
          <div className="vc-group">
            <span className="vc-tag">shown</span>
            <div className="vc-cardrow is-holes">
              {shown.map((s) => (
                <div key={s.index} className="vc-hole">
                  {(s.revealed ?? []).map((c, i) => (
                    <PlayingCard key={i} card={c} size="sm" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
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
            <div className="vc-detail">
              {result.ok ? (
                <>
                  <p>
                    Recomputed the deck from the published seed. Every salt
                    matches the commitment posted before it, the seed is the
                    randomness combined with those salts, and the cards dealt are
                    the cards this deck gives.
                  </p>
                  <Mono label="seed" value={result.seed} />
                  <Mono
                    label="deck top"
                    value={result.deck.slice(0, 12).map(nameOf).join(" ")}
                  />
                </>
              ) : (
                <>
                  <p className="vc-detail-bad">
                    This hand does not match what was published:
                  </p>
                  <ul>
                    {result.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const nameOf = (b: number) =>
  b === NO_CARD ? "--" : `${RANKS[Math.floor(b / 4)]}${SUITS[b % 4]}`;

function Mono({ label, value }: { label: string; value: string }) {
  return (
    <div className="vc-mono">
      <span className="vc-mono-label">{label}</span>
      {/* Seeds, salts and signatures are chain data, which is the only thing
          set in the mono face. It was on a hardcoded stack here, which is how
          the one face with a single job quietly stops matching itself. */}
      <span className="chain vc-mono-value">{value}</span>
    </div>
  );
}
