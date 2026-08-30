"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { CheckIcon, CopyIcon } from "@/components/primitives/Icons";
import { shortKey } from "@/components/primitives/Avatar";
import { formatSignedUsd, formatUsd } from "@/lib/money";
import { useUiStore } from "@/stores/ui-store";

/**
 * A result, drawn as an image a player can post.
 *
 * Painted on a canvas rather than screenshotted from the DOM, for two reasons.
 * A screenshot library is a large dependency to add for one card, and more to
 * the point the thing a player shares should be composed for the medium it
 * lands in — 1200x630, legible as a thumbnail, readable with the sound off —
 * rather than being whatever the page happened to look like at that width.
 *
 * Every figure on it comes from the same props the panel behind it renders,
 * so a card can never claim a number the page is not also showing. There is no
 * "estimated", no projected token value, and no rank the server did not
 * return: a share card is the most quotable surface this product has, and a
 * flattering figure invented here would be repeated everywhere.
 */

export interface ShareStats {
  wallet: string;
  displayName: string | null;
  /** Profit: what came out of pots, less what went in. May be negative. */
  netChips: number;
  handsPlayed: number;
  handsWon: number;
  biggestPotChips: number;
}

const W = 1200;
const H = 630;

/*
 * `roundRect` and `brandGradient` used to live here. Both went with the
 * container: there is no inset panel to round any more, and the one place that
 * still paints the chain's purple-to-green builds its gradient inline because
 * it needs its own stops rather than a straight two-colour ramp.
 */

/**
 * The mascot, loaded once for the canvas to stamp.
 *
 * Null until it arrives, and null forever if it does not — the card is drawn
 * either way, with set type standing in for the brand. A share card that waits
 * on an image is a share card that is sometimes blank, and this is the one
 * surface where a player is already holding a screenshot key.
 *
 * This is `hero-mark.png` rather than the horizontal lockup, because it
 * carries the wordmark inside its own smoke: as a centred watermark it brands
 * the card and IS the background, so nothing has to sit in a corner labelling
 * the thing.
 */
function useArt() {
  const [art, setArt] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let live = true;
    const img = new Image();
    // Same-origin today, so this changes nothing; it is here so that moving
    // /public to a CDN cannot silently taint the canvas and break the export.
    img.crossOrigin = "anonymous";
    img.onload = () => live && setArt(img);
    img.src = "/hero-mark.png";
    return () => {
      live = false;
    };
  }, []);
  return art;
}

/*
 * The card is one column of type over one full-bleed image.
 *
 * Every coordinate lives here rather than sprinkled through the drawing calls,
 * because the composition IS the design: read together, these numbers are the
 * layout, and changing one is visibly a change to the rhythm rather than a
 * magic number nudged until it looked right.
 *
 * The type column is left-aligned and the art sits to its right, because a
 * centred stack over a centred image does not work with THIS image: the
 * mascot is a dark figure on transparent, so at any opacity low enough to
 * print text over, his dark mass disappears entirely and only stray neon
 * survives. Measured, a centred version left him at a peak luminance of 45 on
 * a 255 scale — invisible. Giving the type its own side lets the art run at an
 * opacity where it actually reads.
 */
const COL = 80; // the type column's left edge
const COL_R = 640; // and its right edge — NOTHING is drawn past this line
const Y = {
  eyebrow: 132, // "PROFIT", small and tracked, naming the figure below
  money: 246, // the figure itself, the reason the card exists
  claim: 296, // what the product actually promises
  rule: 336, // the gradient hairline closing the top half
  factLabel: 410, // HANDS / WON / BIGGEST POT
  factValue: 456,
  foot: 554, // whose result this is, and where from
};

/*
 * The facts row and the footer share ONE left edge and ONE right edge.
 *
 * The row used to step across on a fixed grid from the left, so its right end
 * fell wherever the last number happened to stop while the footer ran on to
 * the column edge — two rows that were meant to bracket the card, ending in
 * two different places. Now the outer two facts are pinned to the column's
 * edges and the middle one is centred between them, which gives the block a
 * hard right edge for the footer to line up with.
 */
const FACT_SLOT = (COL_R - COL) / 3;
const FACTS = [
  { x: COL, align: "left" as const },
  { x: (COL + COL_R) / 2, align: "center" as const },
  { x: COL_R, align: "right" as const },
];

/**
 * The mascot's centre and height. He is sized to land his left edge just past
 * the column and his right edge on the card's, so nothing is cropped and
 * nothing crowds the type.
 */
const ART_CX = 942;
const ART_H = 600;
/** Where he fades in: absent at the column, whole by the time he matters. */
const ART_FADE_FROM = 668;
const ART_FADE_TO = 850;

function paint(
  canvas: HTMLCanvasElement,
  stats: ShareStats,
  origin: string,
  art: HTMLImageElement | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  /*
   * The canvas IS the card. There is no inset face and nothing behind it.
   *
   * This used to draw a page — a background, then a rounded panel floating on
   * it — and export the whole thing, so what a player posted was a screenshot
   * of a card rather than the card. One object, full bleed, edge to edge.
   */
  ctx.fillStyle = "#0A0A0B";
  ctx.fillRect(0, 0, W, H);

  /*
   * The ambient wash the whole product carries — purple falling from the top
   * left, green rising from the bottom right, the same diagonal the landing
   * page runs its orbs on. It is the app's background, not decoration invented
   * for this card, which is what makes a posted result look like it came from
   * somewhere rather than from a template.
   *
   * This is the GROUND: it goes down before the mascot, so the green rising
   * from the bottom right is light behind him rather than a haze over him.
   */
  const orb = (cx: number, cy: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  };
  orb(150, -70, 620, "#9945FF", 0.5);
  orb(W - 60, H + 60, 560, "#14F195", 0.34);

  /*
   * The mascot, faded out across the column rather than covered up.
   *
   * This used to work the other way round: he was drawn whole and then a black
   * wipe was laid over the left of the card to make room for the type. That
   * wipe could not tell him apart from the background, so it erased the purple
   * gradient with him — the top-left corner measured rgb(10,10,14), the
   * gradient present and entirely painted out.
   *
   * So the fade is applied to HIM, on his own layer, with `destination-in` and
   * a horizontal ramp. He is simply absent over the column and whole to the
   * right of it, and the ground underneath is never touched: both gradients
   * survive at full strength, and both are behind him where they overlap.
   *
   * He carries the wordmark in his own smoke, which is why this card has no
   * lockup in a corner. The background IS the branding.
   */
  if (art) {
    const w = (art.naturalWidth / art.naturalHeight) * ART_H;
    const layer = document.createElement("canvas");
    layer.width = W * dpr;
    layer.height = H * dpr;
    const lc = layer.getContext("2d");
    if (lc) {
      lc.scale(dpr, dpr);
      lc.drawImage(art, ART_CX - w / 2, H - ART_H, w, ART_H);
      lc.globalCompositeOperation = "destination-in";
      const mask = lc.createLinearGradient(ART_FADE_FROM, 0, ART_FADE_TO, 0);
      mask.addColorStop(0, "rgba(0,0,0,0)");
      mask.addColorStop(1, "rgba(0,0,0,1)");
      lc.fillStyle = mask;
      lc.fillRect(0, 0, W, H);
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(layer, 0, 0, W, H);
      ctx.restore();
    }
  }

  // The eyebrow. Small, tracked and quiet — it names the figure below it and
  // then gets out of the way.
  ctx.font = "700 17px Satoshi, system-ui, sans-serif";
  ctx.letterSpacing = "0.22em";
  ctx.fillStyle = "#98A0B4";
  ctx.fillText("PROFIT", COL, Y.eyebrow);
  ctx.letterSpacing = "0px";

  /*
   * The figure, and a losing card is drawn as readily as a winning one.
   *
   * The sign is in the STRING, so the number states which it is without
   * relying on colour — the card gets posted, screenshotted and recompressed,
   * and the one thing that must survive all of that is whether it is a win or
   * a loss. Colour is the second signal, not the only one.
   *
   * The glow follows the sign rather than the design: green light behind a win
   * because there is something to celebrate, and none behind a loss, because a
   * red halo around a bad night is rubbing it in.
   */
  const up = stats.netChips >= 0;
  const money = formatSignedUsd(stats.netChips);

  /*
   * The figure is fitted, not assumed.
   *
   * A six-figure night sets a string twice the width of a two-figure one, and
   * a size picked to look right on the happy case runs off the column on the
   * unhappy one. This steps down until it fits, so the card is never wrong —
   * only sometimes smaller.
   */
  let moneySize = 108;
  ctx.letterSpacing = "-0.025em";
  do {
    ctx.font = `800 ${moneySize}px Archivo, system-ui, sans-serif`;
    if (ctx.measureText(money).width <= COL_R - COL) break;
    moneySize -= 4;
  } while (moneySize > 52);

  ctx.save();
  if (up) {
    ctx.shadowColor = "rgba(20,241,149,0.42)";
    ctx.shadowBlur = 52;
  }
  ctx.fillStyle = up ? "#14F195" : "#FF6B6B";
  ctx.fillText(money, COL, Y.money);
  ctx.restore();
  ctx.letterSpacing = "0px";

  // The claim, and no more than the claim.
  ctx.font = "500 22px Satoshi, system-ui, sans-serif";
  ctx.fillStyle = "#B4BECE";
  ctx.fillText("Provably fair shuffle · TEE-protected hole cards", COL, Y.claim);

  // The chain's gradient, as a hairline. The one place the card draws the
  // brand colours as themselves rather than as light in the background.
  const rw = 260;
  const grad = ctx.createLinearGradient(COL, 0, COL + rw, 0);
  grad.addColorStop(0, "rgba(153,69,255,0.95)");
  grad.addColorStop(0.55, "rgba(20,241,149,0.8)");
  grad.addColorStop(1, "rgba(20,241,149,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(COL, Y.rule, rw, 2);

  /*
   * The three supporting facts: outer two pinned to the column's edges, middle
   * one centred. That is what gives the row the same hard left and right edges
   * as the footer below it, so the two bracket the card instead of ending in
   * two different places.
   */
  const facts: [string, string][] = [
    ["Hands", String(stats.handsPlayed)],
    ["Won", String(stats.handsWon)],
    ["Biggest pot", formatUsd(stats.biggestPotChips)],
  ];

  /*
   * One size for the whole row, chosen by the widest value in it.
   *
   * Fitting each value on its own would put three different sizes in one row,
   * which reads as a bug rather than as a fit. Fitting the row means a normal
   * night gets the full 40px and only a card carrying a genuinely huge number
   * steps everything down together — and it can never collide, because the
   * check is against the slot each value has to live in.
   */
  let factSize = 40;
  while (factSize > 22) {
    ctx.font = `700 ${factSize}px Archivo, system-ui, sans-serif`;
    if (facts.every(([, v]) => ctx.measureText(v).width <= FACT_SLOT - 24)) break;
    factSize -= 2;
  }

  facts.forEach(([label, value], i) => {
    const { x, align } = FACTS[i];
    ctx.textAlign = align;
    ctx.font = "600 15px Satoshi, system-ui, sans-serif";
    ctx.letterSpacing = "0.14em";
    ctx.fillStyle = "#8992A6";
    ctx.fillText(label.toUpperCase(), x, Y.factLabel);
    ctx.letterSpacing = "0px";
    ctx.font = `700 ${factSize}px Archivo, system-ui, sans-serif`;
    ctx.fillStyle = "#F2F4F8";
    ctx.fillText(value, x, Y.factValue);
  });
  ctx.textAlign = "left";

  // Dividers on the slot boundaries, so they sit between the columns whatever
  // each one happens to contain.
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for (const i of [1, 2]) {
    ctx.fillRect(COL + FACT_SLOT * i, Y.factLabel - 17, 1, 48);
  }

  /*
   * The footer line: who on the left, where from on the right.
   *
   * No rule above it. The hairline that used to sit here was the last piece of
   * furniture on the card, and with the column already reading as a column it
   * was separating things that were not running together.
   *
   * The domain is right-aligned to the column's edge, NOT to the card's — that
   * edge is the line the mascot starts at, so the attribution lands as far
   * right as it can go while still leaving him whole.
   *
   * Widths are resolved right to left, and the domain is measured before
   * anything else is drawn, because it is the element with no natural bound:
   * a long host would otherwise grow leftward into the address. It gets at
   * most 55% of the column and steps its own size down to fit, so the line
   * holds for a hostname of any length.
   */
  let domain = origin.replace(/^https?:\/\//, "");
  const domainMax = (COL_R - COL) * 0.55;
  let domainSize = 21;
  ctx.letterSpacing = "0.04em";
  do {
    ctx.font = `700 ${domainSize}px Satoshi, system-ui, sans-serif`;
    if (ctx.measureText(domain).width <= domainMax) break;
    domainSize -= 1;
  } while (domainSize > 11);

  /*
   * If it still does not fit at the smallest size, take characters off the
   * FRONT.
   *
   * Shrinking alone bottoms out: a ninety-character host measured 181px past
   * the identity even at 11px, so the two collided — the exact overlap this
   * layout exists to prevent. Trimming the head keeps the registrable domain,
   * which is the half that says where the card came from; subdomains are the
   * disposable part.
   */
  while (domain.length > 4 && ctx.measureText(domain).width > domainMax) {
    domain = "…" + domain.slice(2);
  }
  const domainWidth = ctx.measureText(domain).width;

  ctx.textAlign = "right";
  ctx.fillStyle = "#B07CFF";
  ctx.fillText(domain, COL_R, Y.foot);
  ctx.letterSpacing = "0px";

  /*
   * The identity, in what the domain left behind.
   *
   * The name, when there is one, and the address either way — a card showing
   * only a chosen name would be a card anyone could make about anyone. The
   * address is the part that cannot be chosen, so it is never dropped or
   * shortened; a long name is truncated around it instead, which keeps the
   * line inside the column however someone has named themselves.
   */
  ctx.textAlign = "left";
  const budget = COL_R - COL - domainWidth - 28;
  let x = COL;
  if (stats.displayName) {
    ctx.font = "400 19px 'JetBrains Mono', ui-monospace, monospace";
    const keyWidth = ctx.measureText(shortKey(stats.wallet)).width;
    ctx.font = "600 22px Satoshi, system-ui, sans-serif";
    let name = stats.displayName;
    const room = budget - keyWidth - 14;
    while (name.length > 1 && ctx.measureText(name).width > room) {
      name = name.slice(0, -2) + "…";
    }
    // A name with no room left at all is dropped rather than printed as a bare
    // ellipsis, which says nothing and costs a word of space.
    if (ctx.measureText(name).width <= room) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(name, x, Y.foot);
      x += ctx.measureText(name).width + 14;
    }
  }
  ctx.font = "400 19px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = "#98A0B4";
  ctx.fillText(shortKey(stats.wallet), x, Y.foot);
}

export function ShareCard({ stats }: { stats: ShareStats }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const toast = useUiStore((s) => s.toast);
  const art = useArt();

  useEffect(() => setOrigin(window.location.origin), []);

  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el || !origin) return;
    paint(el, stats, origin, art);
  }, [stats, origin, art]);

  useEffect(() => {
    // The fonts are self-hosted and may not have arrived when this first
    // paints. Canvas silently substitutes a system face rather than waiting,
    // so the card is drawn again once they are ready.
    draw();
    void document.fonts?.ready.then(draw).catch(() => {});
  }, [draw]);

  const download = () => {
    canvas.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pokerable-${shortKey(stats.wallet)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const copy = () => {
    canvas.current?.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Safari and Firefox refuse image writes outside a narrow gesture
        // window, and a silent no-op would look like a broken button. Say
        // what to do instead.
        toast("Copying images is blocked here. Download it instead.");
      }
    }, "image/png");
  };

  return (
    <div className="share-card">
      {/* Sized by CSS, painted at 1200x630, so the export is full resolution
          whatever the card is displayed at. */}
      <canvas
        ref={canvas}
        className="share-card-canvas"
        role="img"
        aria-label={`Your Pokerable results: ${formatSignedUsd(stats.netChips)} over ${stats.handsPlayed} hands`}
      />
      <div className="share-card-actions">
        <Button variant="quiet" size="md" onClick={copy}>
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? "Copied" : "Copy image"}
        </Button>
        <Button variant="quiet" size="md" onClick={download}>
          Download
        </Button>
      </div>
    </div>
  );
}
