import { Skeleton } from "./Surface";

/**
 * Loading shapes that mirror the layouts they stand in for.
 *
 * The rule this file exists to keep: a skeleton has the same box model as the
 * component that replaces it — same padding, same heights, same grid columns —
 * so the swap is invisible and nothing on the page moves when data lands. A
 * stack of plain grey rectangles fails that twice over. It tells the reader
 * nothing about what is coming, and then the layout jumps.
 *
 * They are furniture, not content. Everything here is `aria-hidden` with the
 * live region announcing "Loading" once, because a screen reader read forty
 * anonymous boxes otherwise.
 */

/** Wraps any loading block so it announces once and is skipped when read. */
export function Loading({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <div aria-hidden>{children}</div>
    </div>
  );
}

/** Mirrors the profile's identity block: avatar, name, address. */
export function ProfileHeadSkeleton() {
  return (
    <div className="profile-head">
      <Skeleton width={64} height={64} radius="var(--r-lg)" />
      <div className="profile-ident" style={{ flex: 1, gap: "var(--sp-3)" }}>
        <Skeleton width={190} height={30} />
        <Skeleton width="46%" height={13} />
      </div>
    </div>
  );
}

/** Mirrors `.fig` on the profile: a small label over a money-sized figure. */
export function FigSkeleton() {
  return (
    <div className="skel-fig">
      <Skeleton width="42%" height={9} />
      <Skeleton width="68%" height={22} />
    </div>
  );
}

export function FigGridSkeleton({ count = 4, small = false }: { count?: number; small?: boolean }) {
  return (
    <div className={small ? "profile-grid profile-grid-sm" : "profile-grid"}>
      {Array.from({ length: count }, (_, i) => (
        <FigSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Mirrors `.chart-card` — heading, legend chips, and the plot itself.
 *
 * The grid lines are drawn for real: they are chrome rather than data, and
 * they sit exactly where the axis will. The curves beneath them are faint and
 * smooth by design — enough to say a line chart is landing, nowhere near
 * enough to be misread as a reading. A skeleton that looked like plausible
 * data would be worse than no skeleton at all.
 */
export function ChartCardSkeleton({
  chips = 4,
  height = 300,
}: {
  chips?: number;
  height?: number;
}) {
  const W = 720;
  const rows = [0.18, 0.42, 0.66, 0.9];
  return (
    <div className="skel-card">
      <div className="skel-spread" style={{ marginBottom: "var(--sp-4)" }}>
        <Skeleton width={170} height={22} />
        <Skeleton width={78} height={12} />
      </div>

      <div className="skel-chips">
        {Array.from({ length: chips + 1 }, (_, i) => (
          <Skeleton key={i} width={i === 0 ? 62 : 92} height={44} radius="var(--r-pill)" />
        ))}
      </div>

      {/* Height is pinned. With preserveAspectRatio="none" and no height the
          SVG keeps its intrinsic ratio, so a 720x300 box stretched to 1800
          wide rendered 750 tall — two and a half times the chart it stands in
          for, which is the layout jump a skeleton exists to prevent. */}
      <svg
        className="skel-plot"
        width="100%"
        height={height}
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        role="presentation"
      >
        {rows.map((r) => (
          <line
            key={r}
            className="skel-grid"
            x1={56}
            x2={W - 16}
            y1={height * r}
            y2={height * r}
          />
        ))}
        {/* Two quiet curves, offset, so the shape reads as a multi-series
            chart rather than as a single mystery line. */}
        <path
          className="skel-curve skel-curve-sweep"
          d={`M56,${height * 0.72} C${W * 0.28},${height * 0.6} ${W * 0.46},${height * 0.34} ${W - 16},${height * 0.26}`}
        />
        <path
          className="skel-curve skel-curve-sweep"
          style={{ animationDelay: "0.35s" }}
          d={`M56,${height * 0.82} C${W * 0.3},${height * 0.78} ${W * 0.55},${height * 0.6} ${W - 16},${height * 0.5}`}
        />
      </svg>

      <div className="skel-inline" style={{ marginTop: "var(--sp-4)" }}>
        <Skeleton width={52} height={12} />
      </div>
    </div>
  );
}

/** Mirrors `.rewards-row`: rank, avatar, wallet, figure — same four columns. */
export function BoardRowSkeleton() {
  return (
    <div className="skel-row">
      <Skeleton width={14} height={12} />
      <Skeleton width={28} height={28} radius="var(--r-pill)" />
      <Skeleton width="58%" height={13} />
      <Skeleton width={62} height={15} />
    </div>
  );
}

export function BoardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <BoardRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Mirrors `.table-card` in the lobby: title row, the two stat lines a player
 * chooses a table by, the activity line, and the seat strip.
 */
export function TableCardSkeleton() {
  return (
    <div className="skel-table-card">
      <div className="skel-spread">
        <Skeleton width="52%" height={17} />
        <Skeleton width={40} height={16} radius="var(--r-pill)" />
      </div>
      <div className="skel-inline">
        <Skeleton width={96} height={14} />
        <Skeleton width={104} height={14} />
      </div>
      <Skeleton width="76%" height={12} />
      <div className="skel-inline" style={{ marginTop: "auto" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} width={26} height={26} radius="var(--r-pill)" />
        ))}
      </div>
    </div>
  );
}

export function TableCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="lobby-cards">
      {Array.from({ length: count }, (_, i) => (
        <TableCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Mirrors a stored-hand row on the history page. */
export function HandRowSkeleton() {
  return (
    <div
      className="skel-table-card"
      style={{ minHeight: 82, gap: "var(--sp-3)", justifyContent: "center" }}
    >
      <div className="skel-spread">
        <Skeleton width={104} height={15} />
        <Skeleton width={72} height={13} />
      </div>
      <div className="skel-inline">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} width={26} height={36} radius="var(--r-card)" />
        ))}
      </div>
    </div>
  );
}

export function HandsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <HandRowSkeleton key={i} />
      ))}
    </div>
  );
}

/** Mirrors the glass stat tiles the rewards page opens with. */
export function StatTilesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="rewards-stats">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skel-fig" style={{ minHeight: 104 }}>
          <Skeleton width="46%" height={9} />
          <Skeleton width="62%" height={26} />
          <Skeleton width="84%" height={10} />
        </div>
      ))}
    </div>
  );
}
