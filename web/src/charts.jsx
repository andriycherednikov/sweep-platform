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
   effects, nothing to mock. The BOX is what is responsive, and its height is a
   decision the stylesheet makes (.ch-box) rather than a ratio that falls out of
   whatever width the card happened to get: the drawing is stretched into that box
   with preserveAspectRatio="none", and vector-effect="non-scaling-stroke" keeps every
   line and dot the weight it was drawn at however far it is stretched.

   Which is why no text is drawn in here any more. Text in a stretched viewBox is
   stretched with it — squat on a wide card, condensed on a narrow one, and 5px tall in
   the narrowest card the grid makes — so every label is an HTML element positioned on
   top of the drawing at a real font size, and the scatter, which is nothing BUT labels
   and round dots, is not drawn at all: it is six positioned elements over two dashed
   CSS rules.

   Colours come from the pane these are drawn on, which is the LIGHT one (.ac-main):
   grid in var(--edge), ink in var(--paper-ink), muted ink in var(--ink3). A series
   carries its own colour instead, because in the race that colour is the avatar the
   person already wears inside the sweep — the line and the face match.
   ============================================================ */

// The grid every chart is drawn on. Not a size: the box is stretched to fill whatever
// height CSS gives it, so these are units of arithmetic, and keeping them fixed is what
// lets the labels be positioned as a percentage of the same box.
const W = 640;
const H = 200;
// Stroke room top and bottom, so a line that peaks at the maximum is not sliced in half
// by the edge of the viewBox.
const PAD = 6;
// The gutter on the right where a line's end label sits, outside the plot.
const LABEL_W = 38;
// The scatter's dots, in real pixels — they carry initials, so they are a size rather
// than a fraction of anything.
const DOT = 26;

// One decimal is finer than any screen can show and keeps the path strings — which are
// what the tests read — short enough to hold in your head.
const num = (n) => Math.round(n * 10) / 10;

/** The values, spread evenly across `width` and flipped so up means more.
 *  Exported because it is the only real arithmetic in the file: the tests check the
 *  path string directly rather than trying to read geometry back out of the DOM. */
export function linePath(values, height, max, width) {
  if (!values.length) return "";
  const top = max > 0 ? max : 1;
  // One reading has nowhere to travel, so it sits at the left edge as a single point.
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i ? "L" : "M"}${num(i * step)},${num(height - (v / top) * height)}`)
    .join(" ");
}

/** True when no series has anywhere to travel — every reading is stamped with the same
 *  day. A line then draws a single moveto and nothing else, so the chart comes out as an
 *  empty box wearing grid lines, which is how a sweep set up this morning looks.
 *  Asked here rather than answered here: what to say instead is the card's copy, not the
 *  drawing's, and both callers of Lines need the same question. */
export const oneDay = (series) => series.every((s) => s.points.length < 2);

/** One line per series over a shared x axis, each ending in a dot and its own label.
 *  `dim` is the caller's call, not the chart's: the dashboard knows who is leading and
 *  who is context, and a chart that decided that for itself would be wrong the moment
 *  two lines meant something other than a race.
 *  `tall` is the page's one hero chart asking for the taller box, which is an intention
 *  rather than a measurement — the pixels are the stylesheet's business. */
export function Lines({ series, title, tall }) {
  const labelled = series.some((s) => s.label);
  const w = labelled ? W - LABEL_W : W;
  const plotH = H - PAD * 2;
  const max = Math.max(1, ...series.flatMap((s) => s.points));
  // Where a line stops, in grid units. Asked twice per series: once by the dot the SVG
  // draws there and once by the label the HTML puts beside it.
  const end = (s) => {
    const v = s.points.length ? s.points[s.points.length - 1] : 0;
    return { x: num(s.points.length > 1 ? w : 0), y: num(plotH - (v / max) * plotH) };
  };

  return (
    <div className={`ch-box${tall ? " is-tall" : ""}`} role="img" aria-label={title}>
      <svg className="ch" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <g transform={`translate(0,${PAD})`}>
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1="0" x2={w} y1={num(plotH * f)} y2={num(plotH * f)}
              stroke="var(--edge)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((s) => {
            const { x, y } = end(s);
            return (
              <g key={s.id} opacity={s.dim ? 0.45 : 1}>
                <path d={linePath(s.points, plotH, max, w)} fill="none" stroke={s.color}
                  strokeWidth={s.dim ? 2 : 3} strokeLinejoin="round" strokeLinecap="round"
                  vectorEffect="non-scaling-stroke" />
                {/* The dot on the end is a line going nowhere with a round cap, not a
                    <circle>: the box is stretched to the card, so a circle comes out an
                    egg, while a stroke that refuses to scale comes out round at any
                    width — and is measured in the pixels it is written in. */}
                {s.points.length > 0 && (
                  <path d={`M${x},${y}L${x},${y}`} stroke={s.color} strokeWidth={s.dim ? 6 : 9}
                    strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {series.map((s) => {
        const { x, y } = end(s);
        if (!s.label || !s.points.length) return null;
        return (
          <b key={s.id} className="ch-pin" style={{
            left: `${(x / W) * 100}%`, top: `${((PAD + y) / H) * 100}%`,
            color: s.color, opacity: s.dim ? 0.45 : 1,
          }}>{s.label}</b>
        );
      })}
    </div>
  );
}

/** A bar per bucket, sitting on a baseline, spaced evenly whatever the buckets are.
 *  That is a calendar only if the caller hands over one row per day: GET /api/account/stats
 *  ships a bucket for the days something happened and nothing at all for the rest, so
 *  the dashboard fills the gaps (daySpan) before the numbers get here. A day with a zero
 *  in it draws as an empty slot, which is the point — a quiet week is information. */
export function Bars({ values, title }) {
  const plotH = H - PAD * 2;
  const max = Math.max(1, ...values);
  const slot = W / values.length;
  const bw = num(Math.min(slot * 0.68, 26));

  return (
    <div className="ch-box" role="img" aria-label={title}>
      <svg className="ch" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <g transform={`translate(0,${PAD})`}>
          <line x1="0" x2={W} y1={plotH} y2={plotH} stroke="var(--edge)" strokeWidth="1"
            vectorEffect="non-scaling-stroke" />
          {values.map((v, i) => {
            const h = num((v / max) * plotH);
            return (
              <rect key={i} x={num(i * slot + (slot - bw) / 2)} y={num(plotH - h)}
                width={bw} height={h} rx="3" fill="var(--lp-accent)" />
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/** Initials on two axes, with the quadrants named. Points come in as 0..1 fractions of
 *  each axis: what counts as "a lot of wins" is a judgement about the sweep, and it
 *  belongs to the card asking the question rather than to the drawing.
 *  Positioned, not drawn. Everything on this chart is either a round dot with somebody's
 *  initials in it or a word naming a corner, and those are the two things a stretched
 *  viewBox cannot carry: the quadrant labels came out 7px tall on a phone and the dots
 *  came out as eggs too small to read. The axes are two dashed CSS rules instead.
 *  `quadrants` reads top-left, top-right, bottom-left, bottom-right. */
export function Scatter({ points, quadrants = [], title }) {
  // A dot is DOT pixels wide whatever the box is, so what a fraction is measured against
  // is the box less one dot — the arithmetic a range slider does with its thumb. Without
  // it a person at 0 or 1 hangs half outside the plot.
  const at = (f) => `calc(${DOT / 2}px + ${f} * (100% - ${DOT}px))`;

  return (
    <div className="ch-box is-plot" role="img" aria-label={title}>
      {/* Upper-cased by CSS rather than by JS, so the corner still reads as whatever the
          card wrote — it is the same small-caps furniture as .ac-comp-sport. */}
      {quadrants.map((q, i) => <b key={q + i} className={`ch-q is-q${i}`}>{q}</b>)}
      {points.map((p) => (
        <span key={p.id} className="ch-dot"
          style={{ left: at(p.x), top: at(1 - p.y), background: p.color }}>{p.label}</span>
      ))}
    </div>
  );
}
