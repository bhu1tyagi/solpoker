"use client";

import { useState } from "react";

/**
 * The rake, as a thing you can poke instead of a paragraph.
 *
 * Drag the pot size and watch the rake move: the 2.5% line, the three-big-
 * blind cap kicking in at 120 BB, and the two zero rules. Every number the
 * player sees is computed from the same constants the paragraph used to
 * state, so this cannot drift from the truth by being prettier than it.
 *
 * Amounts are in big blinds rather than dollars because the rule itself is
 * denominated in big blinds; a dollar figure would bake in one stake and be
 * wrong at every other. Tabular figures, because the number moves while the
 * player watches.
 */

const RATE = 0.025;
const CAP_BB = 3;

export function RakeMeter() {
  const [pot, setPot] = useState(40);

  const capped = pot * RATE > CAP_BB;
  const rake = pot <= 1 ? 0 : Math.min(pot * RATE, CAP_BB);

  return (
    <div className="rake-meter glass">
      <div className="rake-readout">
        <label htmlFor="rake-pot">
          <span className="label">Flopped pot</span>
          <strong className="num rake-fig">{pot} BB</strong>
        </label>
        <span className="rake-arrow" aria-hidden>
          &rarr;
        </span>
        <div>
          <span className="label">Rake</span>
          <strong className="num rake-fig rake-fig--out">
            {rake.toFixed(2)} BB
          </strong>
          <span className={capped ? "rake-cap is-on" : "rake-cap"}>
            {capped ? "capped at 3 BB" : "2.5% of the pot"}
          </span>
        </div>
      </div>

      <input
        id="rake-pot"
        type="range"
        min={1}
        max={200}
        step={1}
        value={pot}
        onChange={(e) => setPot(Number(e.target.value))}
        className="rake-slider"
        aria-label="Pot size in big blinds"
      />

      <p className="rake-rules">
        No flop, no rake. A pot of one big blind or less is never raked. The
        chips come out of the pot at showdown; none are minted to pay it.
      </p>
    </div>
  );
}
