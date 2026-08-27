"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * The trust model as a machine diagram.
 *
 * Six boxes are the actors; six numbered, dashed arrows are the data that
 * moves between them. Clicking a box or an arrow's number selects that stage
 * and the panel below explains it in plain words. The dashes on the arrows
 * march in the direction the data flows, which is what makes it read as a
 * living system rather than a poster; the march stops under reduced motion.
 *
 * The colour split IS the argument and the diagram carries it structurally:
 * green flows are checkable by anyone from public data, and the one purple
 * region, the enclave and everything it emits, is where the player is
 * trusting hardware and an operator instead. That boundary is drawn as a
 * dashed purple box because it is exactly that: a boundary you cannot see
 * into, only attest.
 *
 * SVG interactivity notes: SVG has no <button>, so the nodes are <g
 * role="button" tabIndex=0> with Enter/Space handled by hand, and the focus
 * ring is a stroke change because CSS outlines do not trace SVG shapes.
 * Colour is never the only signal: the selected stage is also named in the
 * panel, numbered on the rail, and marked aria-pressed.
 */

type Kind = "verify" | "trust";

const STAGES: {
  id: string;
  title: string;
  kind: Kind;
  detail: string;
}[] = [
  {
    id: "salts",
    title: "Commit, then reveal",
    kind: "verify",
    detail:
      "Everyone commits to a hash of a secret salt, then reveals. The hashes bind, so nobody can pick a salt after seeing another's.",
  },
  {
    id: "draw",
    title: "The randomness draw",
    kind: "verify",
    detail:
      "The shuffle seed is the VRF output XOR every salt. Rigging it needs the oracle plus every player, so one honest player keeps it fair.",
  },
  {
    id: "seal",
    title: "The sealed deal",
    kind: "trust",
    detail:
      "The deck is dealt inside Intel TDX, run by MagicBlock, and cards go only to their seats. This is trust, not proof: an enclave break would expose cards, and the shuffle check would not notice.",
  },
  {
    id: "play",
    title: "Play, chips conserved",
    kind: "verify",
    detail:
      "The rollup moves chips between seats but cannot mint, change the table total, or touch balances. Disconnect and the table plays on without you.",
  },
  {
    id: "settle",
    title: "Settlement",
    kind: "verify",
    detail:
      "Winners are paid on Solana. One chip is one cent of USDC, vault-backed, and only your wallet can cash out.",
  },
  {
    id: "verify",
    title: "Anyone can recheck",
    kind: "verify",
    detail:
      "Every salt, commitment and the VRF output are published. Your browser recomputes the whole deck from them; a rigged deck fails the check.",
  },
];

/* The six actors. Coordinates live here, not in CSS, because the arrows are
   computed against them and the two must never drift apart. */
const BOX = {
  players: { x: 30, y: 150, w: 175, h: 105 },
  oracle: { x: 305, y: 25, w: 180, h: 70 },
  enclave: { x: 360, y: 160, w: 225, h: 120 },
  rollup: { x: 730, y: 60, w: 200, h: 95 },
  solana: { x: 730, y: 275, w: 200, h: 95 },
  browser: { x: 30, y: 305, w: 190, h: 90 },
} as const;

/* Which actor highlights for which stage. */
const STAGE_NODE: (keyof typeof BOX)[] = [
  "players",
  "oracle",
  "enclave",
  "rollup",
  "solana",
  "browser",
];

/* The six flows: path, label, where the number badge sits, direction. */
const FLOWS: {
  d: string;
  kind: Kind;
  label: string;
  lx: number;
  ly: number;
  bx: number;
  by: number;
}[] = [
  // 1 players -> enclave: salts
  {
    d: "M 205 185 H 356",
    kind: "verify",
    label: "salts: commit, then reveal",
    lx: 215, ly: 143, bx: 240, by: 185,
  },
  // 2 oracle -> enclave: randomness
  {
    d: "M 400 95 V 156",
    kind: "verify",
    label: "VRF randomness",
    lx: 412, ly: 130, bx: 400, by: 122,
  },
  // 3 enclave -> players: sealed cards
  {
    d: "M 356 245 H 209",
    kind: "trust",
    label: "sealed hole cards",
    lx: 228, ly: 270, bx: 320, by: 245,
  },
  // 4 enclave -> rollup: the dealt hand
  {
    d: "M 589 195 C 650 195, 660 130, 726 112",
    kind: "trust",
    label: "the dealt hand",
    lx: 598, ly: 136, bx: 655, by: 162,
  },
  // 5 rollup -> solana: settlement
  {
    d: "M 830 159 V 271",
    kind: "verify",
    label: "showdown settles",
    lx: 842, ly: 219, bx: 830, by: 205,
  },
  // 6 solana -> browser: published proof
  {
    d: "M 726 340 C 560 360, 400 355, 224 348",
    kind: "verify",
    label: "published proof: salts, VRF, seed",
    lx: 470, ly: 335, bx: 470, by: 352,
  },
];

function Node({
  id,
  title,
  caption,
  selected,
  kind,
  onSelect,
}: {
  id: keyof typeof BOX;
  title: string;
  caption: string;
  selected: boolean;
  kind: Kind;
  onSelect: () => void;
}) {
  const b = BOX[id];
  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${title}: ${caption}`}
      className={`td-node td-node--${kind}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} />
      <text className="td-title" x={b.x + 16} y={b.y + 30}>
        {title}
      </text>
      {caption.split("\n").map((line, i) => (
        <text key={i} className="td-caption" x={b.x + 16} y={b.y + 52 + i * 17}>
          {line}
        </text>
      ))}
    </g>
  );
}

export function TrustFlow() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const stage = STAGES[active];
  const activeNode = STAGE_NODE[active];

  return (
    <div className="tflow">
      <div className="tflow-legend" aria-hidden>
        <span className="tflow-key tflow-key--verify">You can check this</span>
        <span className="tflow-key tflow-key--trust">You are trusting this</span>
      </div>

      <div className="td-scroll">
        <div className="td-wrap">
        <svg
          viewBox="0 0 960 430"
          className="td-svg"
          role="group"
          aria-label="How a hand moves through the system"
        >
          <defs>
            <marker
              id="td-arrow-verify"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-green)" />
            </marker>
            <marker
              id="td-arrow-trust"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--c-purple)" />
            </marker>
          </defs>

          {/* Flows under the nodes, so arrowheads tuck against box edges. */}
          {FLOWS.map((f, i) => (
            <g
              key={i}
              className={`td-flow td-flow--${f.kind}${i === active ? " is-active" : ""}`}
            >
              <path
                d={f.d}
                markerEnd={`url(#td-arrow-${f.kind})`}
                pathLength={100}
              />
              <text className="td-flow-label" x={f.lx} y={f.ly}>
                {f.label}
              </text>
              {/* The number badge doubles as the stage selector. */}
              <g
                role="button"
                tabIndex={0}
                aria-pressed={i === active}
                aria-label={`Stage ${i + 1}: ${STAGES[i].title}`}
                className="td-badge"
                onClick={() => setActive(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActive(i);
                  }
                }}
              >
                <circle cx={f.bx} cy={f.by} r={13} />
                <text x={f.bx} y={f.by + 4.5}>
                  {i + 1}
                </text>
              </g>
            </g>
          ))}

          <Node
            id="players"
            title="Players"
            caption={"you, plus up to\nfive opponents"}
            kind="verify"
            selected={activeNode === "players"}
            onSelect={() => setActive(0)}
          />
          <Node
            id="oracle"
            title="VRF oracle"
            caption="verifiable randomness"
            kind="verify"
            selected={activeNode === "oracle"}
            onSelect={() => setActive(1)}
          />
          <Node
            id="enclave"
            title="TDX enclave"
            caption={"the dealer\nIntel TDX · trusted"}
            kind="trust"
            selected={activeNode === "enclave"}
            onSelect={() => setActive(2)}
          />
          <Node
            id="rollup"
            title="Ephemeral rollup"
            caption="your actions run here"
            kind="verify"
            selected={activeNode === "rollup"}
            onSelect={() => setActive(3)}
          />
          <Node
            id="solana"
            title="Solana"
            caption={"the vault, USDC,\nsettlement"}
            kind="verify"
            selected={activeNode === "solana"}
            onSelect={() => setActive(4)}
          />
          <Node
            id="browser"
            title="Your browser"
            caption={"recomputes the deck\nfrom the proof"}
            kind="verify"
            selected={activeNode === "browser"}
            onSelect={() => setActive(5)}
          />
        </svg>

        {/*
          The annotation is a caption fused to the diagram's bottom edge, not
          a panel below it: one slim line that reads as part of the figure,
          the way a plate caption does. It keeps one fixed position rather
          than chasing the selected node around, because a card that jumps is
          motion without information, and it stays inside the scrolling wrap
          so it lines up with the picture on small screens too.
        */}
        <motion.aside
          key={stage.id}
          className={`td-card td-card--${stage.kind}`}
          initial={reduce ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          aria-live="polite"
        >
          <span className="td-card-dot" aria-hidden />
          <span className="td-card-title">
            {active + 1} · {stage.title}
          </span>
          <span className="td-card-body">{stage.detail}</span>
        </motion.aside>
        </div>
      </div>
    </div>
  );
}
