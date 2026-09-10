/* ============================================================
   THE SWEEP — the three shapes the account console draws with.

   Hand-drawn inline SVG rather than a charting library. Three charts do not pay for
   one: this workspace has seven runtime dependencies and no code splitting, so every
   kilobyte of a chart bundle lands on the phone of somebody who only came to look at
   a sweep. The app already draws its knockout bracket out of ::before pseudo-elements
   and its probability bars out of flexed <i> children — this is the same house style,
   one level up. The day somebody asks for tooltips, zoom or a second axis is the day
   to buy the dependency.

   Everything here is a pure function of its props: no state, no measurement, no
   effects, nothing to mock. The viewBox does the responsive work — each chart is
   drawn at 640 units wide and stretched to the card by CSS, so one unit is one pixel
   on a full-width card and the whole drawing shrinks together on a phone.

   Colours come from the pane these are drawn on, which is the LIGHT one (.ac-main):
   grid in var(--edge), ink in var(--paper-ink), muted ink in var(--ink3). A series
   carries its own colour instead, because in the race that colour is the avatar the
   person already wears inside the sweep — the line and the face match.
   ============================================================ */

// The coordinate space every chart is drawn in. Nothing measures the real element, so
// this is a scale rather than a size: CSS decides how wide the drawing actually lands.
const W = 640;
// Stroke room top and bottom, so a line that peaks at the maximum is not sliced in half
// by the edge of the viewBox.
const PAD = 6;
// The gutter on the right where a line's end label sits, outside the plot.
const LABEL_W = 38;

// Same numerals as .mstat-val, so a figure in a chart and a figure in the sweep app
// are the same figure. Set on the <svg> and inherited by every <text> under it.
const FONT = {
  fontFamily: "'Barlow Semi Condensed',system-ui,sans-serif",
  fontVariantNumeric: "tabular-nums",
};

// One decimal is finer than any screen can show and keeps the path strings — which are
// what the tests read — short enough to hold in your head.
const num = (n) => Math.round(n * 10) / 10;

/** The values, spread evenly across `width` and flipped so up means more.
 *  Exported because it is the only real arithmetic in the file: the tests check the
 *  path string directly rather than trying to read geometry back out of the DOM. */
export function linePath(values, height, max, width = W) {
  if (!values.length) return "";
  const top = max > 0 ? max : 1;
  // One reading has nowhere to travel, so it sits at the left edge as a single point.
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i ? "L" : "M"}${num(i * step)},${num(height - (v / top) * height)}`)
    .join(" ");
}

/** One line per series over a shared x axis, each ending in a dot and its own label.
 *  `dim` is the caller's call, not the chart's: the dashboard knows who is leading and
 *  who is context, and a chart that decided that for itself would be wrong the moment
 *  two lines meant something other than a race. */
export function Lines({ series, height = 160, title }) {
  const labelled = series.some((s) => s.label);
  const w = labelled ? W - LABEL_W : W;
  const plotH = height - PAD * 2;
  const max = Math.max(1, ...series.flatMap((s) => s.points));

  return (
    <svg className="ch" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} style={FONT}>
      <g transform={`translate(0,${PAD})`}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1="0" x2={w} y1={num(plotH * f)} y2={num(plotH * f)}
            stroke="var(--edge)" strokeWidth="1" />
        ))}
        {series.map((s) => {
          const last = s.points.length ? s.points[s.points.length - 1] : 0;
          const x = num(s.points.length > 1 ? w : 0);
          const y = num(plotH - (last / max) * plotH);
          return (
            <g key={s.id} opacity={s.dim ? 0.45 : 1}>
              <path d={linePath(s.points, plotH, max, w)} fill="none" stroke={s.color}
                strokeWidth={s.dim ? 2 : 3} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.length > 0 && <circle cx={x} cy={y} r={s.dim ? 3 : 4.5} fill={s.color} />}
              {s.label && (
                <text x={x + 7} y={y + 4.5} fontSize="13" fontWeight="700" fill={s.color}>{s.label}</text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** A bar per bucket, sitting on a baseline, spaced evenly whatever the buckets are.
 *  That is a calendar only if the caller hands over one row per day: GET /api/account/stats
 *  ships a bucket for the days something happened and nothing at all for the rest, so
 *  the dashboard fills the gaps (daySpan) before the numbers get here. A day with a zero
 *  in it draws as an empty slot, which is the point — a quiet week is information. */
export function Bars({ values, height = 130, color = "var(--lp-accent)", title }) {
  const plotH = height - PAD * 2;
  const max = Math.max(1, ...values);
  const slot = values.length ? W / values.length : W;
  const bw = num(Math.min(slot * 0.68, 26));

  return (
    <svg className="ch" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} style={FONT}>
      <g transform={`translate(0,${PAD})`}>
        <line x1="0" x2={W} y1={plotH} y2={plotH} stroke="var(--edge)" strokeWidth="1" />
        {values.map((v, i) => {
          const h = num((v / max) * plotH);
          return (
            <rect key={i} x={num(i * slot + (slot - bw) / 2)} y={num(plotH - h)}
              width={bw} height={h} rx="3" fill={color} />
          );
        })}
      </g>
    </svg>
  );
}

/** Initials on two axes, with the quadrants named. Points come in as 0..1 fractions of
 *  each axis: what counts as "a lot of wins" is a judgement about the sweep, and it
 *  belongs to the card asking the question rather than to the drawing.
 *  `quadrants` reads top-left, top-right, bottom-left, bottom-right. */
export function Scatter({ points, height = 200, quadrants = [], title }) {
  const INSET = 20; // a dot at the very edge of an axis still has to fit inside the box
  const plotW = W - INSET * 2;
  const plotH = height - INSET * 2;
  const midX = INSET + plotW / 2;
  const midY = INSET + plotH / 2;
  const corners = [
    { x: INSET + 2, y: INSET - 6, anchor: "start" },
    { x: W - INSET - 2, y: INSET - 6, anchor: "end" },
    { x: INSET + 2, y: height - INSET + 14, anchor: "start" },
    { x: W - INSET - 2, y: height - INSET + 14, anchor: "end" },
  ];

  return (
    <svg className="ch" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} style={FONT}>
      <line x1={midX} x2={midX} y1={INSET} y2={height - INSET} stroke="var(--edge)" strokeDasharray="4 4" />
      <line x1={INSET} x2={W - INSET} y1={midY} y2={midY} stroke="var(--edge)" strokeDasharray="4 4" />
      {/* Upper-cased by CSS rather than by JS, so the corner still reads as whatever the
          card wrote — it is the same small-caps furniture as .ac-comp-sport. */}
      {quadrants.map((q, i) => (
        <text key={q + i} x={corners[i].x} y={corners[i].y} textAnchor={corners[i].anchor}
          fontSize="12" fontWeight="700" letterSpacing="1" fill="var(--ink3)"
          style={{ textTransform: "uppercase" }}>{q}</text>
      ))}
      {points.map((p) => {
        const cx = num(INSET + p.x * plotW);
        const cy = num(INSET + (1 - p.y) * plotH);
        return (
          <g key={p.id}>
            <circle cx={cx} cy={cy} r="13" fill={p.color} />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
