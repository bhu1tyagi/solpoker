"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * A multi-series line chart, drawn as SVG.
 *
 * Hand-built rather than pulled from a library, for the same reason the share
 * card is: the page's strict content policy blocks external scripts, and a
 * charting library is a large dependency to carry for two charts whose whole
 * job is one shape.
 *
 * Rules it holds to, each of which is a rule rather than a preference:
 *
 *   ONE AXIS. Every series in a chart shares a unit — money with money, counts
 *   with counts. A second y-scale is the most common way a chart lies, because
 *   two series drawn to different scales appear to cross when they never met.
 *   Splitting by unit is why this component is used twice on the page instead
 *   of once.
 *
 *   IDENTITY IS NEVER COLOUR ALONE. Every series is in the legend, the tooltip
 *   names each one beside its value, and the whole table is readable underneath
 *   for anyone who cannot use either.
 *
 *   THE COLOURS WERE VALIDATED, NOT CHOSEN. See COLOR.series* in tokens.ts —
 *   the interface palette failed colour-vision separation on this surface.
 *
 *   NOTHING IS INVENTED. Days with no play are not interpolated; the line steps
 *   between the days that exist, so time away reads as a flat run rather than
 *   as a decline that never happened.
 */

export interface Series {
  key: string;
  label: string;
  /** A CSS custom property name from tokens.ts, e.g. "--c-series1". */
  color: string;
  /** One value per point; null where the figure is genuinely unknown. */
  values: (number | null)[];
  /**
   * Overrides the chart's formatter for this series.
   *
   * Series can share a unit without sharing a sign convention: on the money
   * chart Net is a signed figure that can go either way, while Won, Lost and
   * Rake are magnitudes that only ever grow. Formatting all four as signed
   * printed "+$1,300 Lost", which reads as the opposite of what it means.
   */
  format?: (v: number) => string;
}

interface Props {
  series: Series[];
  /** Epoch millis per point, same length as every series' values. */
  points: number[];
  format: (v: number) => string;
  /** Short form for the axis, where space is tight. */
  formatAxis?: (v: number) => string;
  height?: number;
  /** Names the chart for screen readers and the table view caption. */
  caption: string;
}

const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

/** Ticks a person would choose: 1, 2, 5 and their powers of ten. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 0.001; t += step) {
    out.push(Math.round(t * 1e6) / 1e6);
  }
  return out;
}

const fmtDay = (at: number) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function LineChart({
  series,
  points,
  format,
  formatAxis,
  height = 300,
  caption,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  /** null means every series is at full strength. */
  const [focus, setFocus] = useState<string | null>(null);

  /*
   * Measured rather than scaled by viewBox. A viewBox that stretches to fit
   * scales the type with it, so a chart that reads correctly on a laptop sets
   * its axis labels at about six pixels on a phone.
   */
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(280, width);
  const H = height;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const { min, max, ticks } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    if (all.length === 0) return { min: 0, max: 1, ticks: [0, 1] };
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    // A money chart that can go negative needs zero on it, or a loss looks
    // like a smaller gain.
    if (lo > 0) lo = 0;
    if (hi < 0) hi = 0;
    if (lo === hi) hi = lo + 1;
    const pad = (hi - lo) * 0.08;
    return { min: lo - pad, max: hi + pad, ticks: niceTicks(lo, hi) };
  }, [series]);

  const x = useCallback(
    (i: number) =>
      PAD.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW),
    [points.length, plotW],
  );
  const y = useCallback(
    (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH,
    [min, max, plotH],
  );

  /** A path that breaks at nulls rather than bridging them. */
  const path = useCallback(
    (values: (number | null)[]) => {
      let d = "";
      let pen = false;
      values.forEach((v, i) => {
        if (v === null) {
          pen = false;
          return;
        }
        d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    },
    [x, y],
  );

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (points.length === 0) return;
    const t = (px - PAD.left) / (plotW || 1);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(t * (points.length - 1)))));
  };

  // Arrow keys move the crosshair, so the same readout is reachable without a
  // pointer. The chart is one tab stop, not one per point.
  const onKey = (e: React.KeyboardEvent) => {
    if (points.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setHover((h) => {
        const next = (h ?? points.length - 1) + (e.key === "ArrowRight" ? 1 : -1);
        return Math.max(0, Math.min(points.length - 1, next));
      });
    } else if (e.key === "Escape") {
      setHover(null);
    }
  };

  const single = points.length === 1;
  const zeroOnAxis = min < 0 && max > 0;

  return (
    <div className="chart" ref={wrap}>
      {/* Filters sit above the plot, in one row, and scope what is below. */}
      <div className="chart-legend" role="group" aria-label={`${caption} series`}>
        <button
          type="button"
          className={focus === null ? "chart-chip is-on" : "chart-chip"}
          aria-pressed={focus === null}
          onClick={() => setFocus(null)}
        >
          All
        </button>
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            className={focus === s.key ? "chart-chip is-on" : "chart-chip"}
            aria-pressed={focus === s.key}
            // Clicking the series already shown alone returns to all of them,
            // so the control is its own way back.
            onClick={() => setFocus((f) => (f === s.key ? null : s.key))}
          >
            <span className="chart-key" style={{ background: `var(${s.color})` }} />
            {s.label}
          </button>
        ))}
      </div>

      <svg
        width={W}
        height={H}
        role="img"
        aria-label={caption}
        tabIndex={0}
        className="chart-svg"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
      >
        {/* Grid and axis are recessive: they orient, they do not compete. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="chart-grid"
            />
            <text x={PAD.left - 10} y={y(t)} dy="0.32em" className="chart-axis-label">
              {(formatAxis ?? format)(t)}
            </text>
          </g>
        ))}
        {zeroOnAxis && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(0)}
            y2={y(0)}
            className="chart-zero"
          />
        )}

        {points.length > 0 && (
          <>
            <text x={PAD.left} y={H - 8} className="chart-axis-label chart-axis-x">
              {fmtDay(points[0])}
            </text>
            {points.length > 1 && (
              <text
                x={W - PAD.right}
                y={H - 8}
                textAnchor="end"
                className="chart-axis-label chart-axis-x"
              >
                {fmtDay(points[points.length - 1])}
              </text>
            )}
          </>
        )}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            className="chart-crosshair"
          />
        )}

        {/* Dulled series first, so the focused one is never drawn under one of
            the lines it is meant to stand out from. */}
        {[...series]
          .sort((a, b) => (a.key === focus ? 1 : b.key === focus ? -1 : 0))
          .map((s) => {
            const dull = focus !== null && focus !== s.key;
            return (
              <g key={s.key} className={dull ? "chart-line is-dull" : "chart-line"}>
                <path d={path(s.values)} stroke={`var(${s.color})`} />
                {single &&
                  s.values[0] !== null &&
                  s.values[0] !== undefined && (
                    // One day of play is a point, not a line. Drawn as a dot
                    // rather than hidden, because the figure is real.
                    <circle cx={x(0)} cy={y(s.values[0])} r={4} fill={`var(${s.color})`} />
                  )}
                {hover !== null && s.values[hover] !== null && (
                  <circle
                    cx={x(hover)}
                    cy={y(s.values[hover] as number)}
                    r={4}
                    fill={`var(${s.color})`}
                    className="chart-dot"
                  />
                )}
              </g>
            );
          })}
      </svg>

      {/* One tooltip, every series — the pointer never has to find a line. */}
      {hover !== null && points[hover] !== undefined && (
        <div
          className="chart-tip"
          style={{
            left: `${Math.min(Math.max(x(hover), 90), W - 90)}px`,
          }}
          role="status"
        >
          <div className="chart-tip-day">{fmtDay(points[hover])}</div>
          {series.map((s) => (
            <div key={s.key} className="chart-tip-row">
              <span className="chart-tip-key" style={{ background: `var(${s.color})` }} />
              {/* Value leads, label follows: the reader has the series and
                  wants the number. */}
              <span className="chart-tip-val">
                {s.values[hover] === null
                  ? "—"
                  : (s.format ?? format)(s.values[hover] as number)}
              </span>
              <span className="chart-tip-label">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Every figure the chart draws, reachable without hovering anything. */}
      <details className="chart-table">
        <summary>Table</summary>
        <div className="chart-table-scroll">
          <table>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points.map((at, i) => (
                <tr key={at}>
                  <th scope="row">{fmtDay(at)}</th>
                  {series.map((s) => (
                    <td key={s.key}>
                      {s.values[i] === null
                        ? "—"
                        : (s.format ?? format)(s.values[i] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
