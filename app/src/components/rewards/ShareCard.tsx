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

/** The one gradient, as canvas understands it. */
function brandGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, "#9945FF");
  g.addColorStop(1, "#14F195");
  return g;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function paint(canvas: HTMLCanvasElement, stats: ShareStats, origin: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  // The base. Never pure black: it gives no depth and kills the hairlines.
  ctx.fillStyle = "#0A0A0B";
  ctx.fillRect(0, 0, W, H);

  // Two orbs, the same ambient wash the site carries, kept far from the text
  // so nothing composites over a figure and drops it below contrast.
  const orb = (cx: number, cy: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  };
  orb(W - 120, -40, 420, "#9945FF", 0.22);
  orb(-60, H + 60, 460, "#14F195", 0.16);

  // The card face, inset, so the orbs read as light behind an object.
  roundRect(ctx, 48, 48, W - 96, H - 96, 28);
  ctx.fillStyle = "#101013";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.stroke();

  const L = 104;

  // Wordmark. Gradient is permitted on the mark, and this is the mark.
  ctx.font = "800 30px Archivo, system-ui, sans-serif";
  ctx.fillStyle = brandGradient(ctx, L, 110, L + 240, 140);
  ctx.letterSpacing = "0.08em";
  ctx.fillText("POKERABLE", L, 132);
  ctx.letterSpacing = "0px";

  // The claim, and no more than the claim.
  ctx.font = "500 19px Satoshi, system-ui, sans-serif";
  ctx.fillStyle = "#A8B2C6";
  ctx.fillText("Provably fair shuffle, TEE-protected hole cards", L, 168);

  // The figure. This is the whole point of the card, so it gets the display
  // face at its largest and nothing competes with it.
  ctx.font = "500 22px Satoshi, system-ui, sans-serif";
  ctx.fillStyle = "#9CA3AF";
  ctx.fillText("Profit", L, 268);

  /*
   * A losing card is drawn as readily as a winning one.
   *
   * The sign is in the string, so the figure states which it is without
   * relying on the colour — the card gets posted, screenshotted and
   * recompressed, and the one thing that must survive all of that is whether
   * the number is a win or a loss. The glow follows the sign rather than
   * being decoration: green when there is something to celebrate, and a plain
   * neutral card when there is not, because a red glow on a loss would be
   * rubbing it in.
   */
  const up = stats.netChips >= 0;
  const money = formatSignedUsd(stats.netChips);
  ctx.font = "800 108px Archivo, system-ui, sans-serif";
  ctx.letterSpacing = "-0.02em";
  ctx.save();
  if (up) {
    ctx.shadowColor = "rgba(20,241,149,0.45)";
    ctx.shadowBlur = 44;
  }
  ctx.fillStyle = up ? "#FFFFFF" : "#FF5C5C";
  ctx.fillText(money, L, 366);
  ctx.restore();
  ctx.letterSpacing = "0px";

  // The supporting facts, evenly spaced along the bottom of the card.
  const facts: [string, string][] = [
    ["Hands", String(stats.handsPlayed)],
    ["Won", String(stats.handsWon)],
    ["Biggest pot", formatUsd(stats.biggestPotChips)],
  ];
  // Spread across the full content width rather than bunched at the left
  // margin: three columns in the leftmost third of a 1200px card reads as a
  // layout that ran out of things to say.
  const column = (W - L * 2) / facts.length;
  let x = L;
  for (const [label, value] of facts) {
    ctx.font = "600 15px Satoshi, system-ui, sans-serif";
    ctx.letterSpacing = "0.06em";
    ctx.fillStyle = "#9CA3AF";
    ctx.fillText(label.toUpperCase(), x, 448);
    ctx.letterSpacing = "0px";
    ctx.font = "700 34px Archivo, system-ui, sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(value, x, 490);
    x += column;
  }

  // A rule, then the identity line: whose result this is, and where from.
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(L, 528);
  ctx.lineTo(W - L, 528);
  ctx.stroke();

  // The name, when there is one, and the address either way. A card showing
  // only a chosen name would be a card anyone could make about anyone.
  if (stats.displayName) {
    ctx.font = "600 19px Satoshi, system-ui, sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(stats.displayName, L, 562);
    const nameWidth = ctx.measureText(stats.displayName).width;
    ctx.font = "400 17px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "#9CA3AF";
    ctx.fillText(shortKey(stats.wallet), L + nameWidth + 16, 562);
  } else {
    ctx.font = "400 19px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillStyle = "#A8B2C6";
    ctx.fillText(shortKey(stats.wallet), L, 562);
  }

  ctx.font = "600 19px Satoshi, system-ui, sans-serif";
  ctx.fillStyle = "#B07CFF";
  ctx.textAlign = "right";
  ctx.fillText(origin.replace(/^https?:\/\//, ""), W - L, 562);
  ctx.textAlign = "left";
}

export function ShareCard({ stats }: { stats: ShareStats }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const toast = useUiStore((s) => s.toast);

  useEffect(() => setOrigin(window.location.origin), []);

  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el || !origin) return;
    paint(el, stats, origin);
  }, [stats, origin]);

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
