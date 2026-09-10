/* ============================================================
   THE SWEEP — the account console's front page: how it is actually going.

   This is entertainment, not analytics. The person reading it runs a sweep for their
   mates, and what they came for is the sentence they can paste into the group chat:
   who is in front, who has gone quiet, who leaves their bets until ninety seconds
   before kickoff. Platform numbers — accounts, revenue, sweeps created this week —
   are somebody else's job and already have a page, /super. Nothing here is a KPI.

   Everything is drawn from ONE request, GET /api/account/stats, which answers with raw
   daily buckets per sweep — and only for the days something happened on. The running
   totals are made here, in cumulate() and raceSeries(), so the client can re-window them
   without another round trip and so the payload does not carry the same numbers twice;
   daySpan() puts the empty days back, because every chart here is an even spread and an
   even spread over "the days with rows in them" is not a calendar.

   The cards are grouped into StoryGrid, which the sweep's own page reuses wholesale —
   the widgets are the same six either way, and the only difference is whether the joins
   and the season are one sweep's or every sweep's added together.
   ============================================================ */
import { useState, useEffect, useMemo } from "react";
import { Console, NoSweepsYet, fmtDay, BillingNotice } from "./screens-account.jsx";
import { getAccountSweeps, getAccountStats } from "./lib/accountClient.js";
import { Lines, Bars, Scatter } from "./charts.jsx";

const DAY_MS = 86400000;
// How many lines the race keeps on a phone. A 220px chart carrying a dozen labelled
// lines is a scribble at that width, and reflowing it into something taller just moves
// the problem down the page.
//
// ponytail: the top five, rather than the top four plus whoever is reading. The stats
// payload carries no "this seat is you" flag — person.accountId exists in the schema
// (POST /api/account/sweeps/:id/session reads it) but GET /api/account/stats does not
// ship it, and matching the account's name against a seat name is a guess that would be
// wrong for anyone who typed a nickname. The upgrade is one boolean on the people rows
// of that route; until then the leader is always shown, which is the line most people
// are looking for anyway.
const RACE_MAX = 5;

const last = (a) => (a.length ? a[a.length - 1] : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------------- the arithmetic ---------------- */

/** Daily counts in, running total out. Every line on this page is this function. */
export const cumulate = (values) => {
  let total = 0;
  return values.map((v) => (total += v));
};

/** Every day from the first of these to the last, the empty ones included.
 *
 *  The route ships one bucket per day something HAPPENED and no bucket at all for the
 *  rest, which is the right payload and the wrong axis: plotted straight, the buckets
 *  are spaced evenly, so a fortnight of international break draws as one quiet day and
 *  a busy weekend draws the same width as a month. Filling the gaps here rather than
 *  teaching the charts about dates keeps them what they are — arrays of numbers, evenly
 *  spread — and makes that even spread true. Nothing in, nothing out: the parse of an
 *  absent date is NaN and the loop never starts. */
function daySpan(dates) {
  const sorted = [...new Set(dates)].sort();
  const end = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`);
  const out = [];
  for (let t = Date.parse(`${sorted[0]}T00:00:00Z`); t <= end; t += DAY_MS)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** One line per person who has won something, as a running total over the days any of
 *  them did — every day of them, including the ones nobody won on. People with nothing yet are left out rather than drawn as a flat zero:
 *  twelve lines pinned to the floor is not information, it is a fence.
 *  Sorted by where everyone ended up, so the leader is first and undimmed — the caller
 *  does not have to work out who the story is about. */
export function raceSeries(s) {
  const dates = daySpan(s.race.map((r) => r.date));
  const column = new Map(dates.map((d, i) => [d, i]));
  const daily = new Map();
  for (const r of s.race) {
    const row = daily.get(r.personId) ?? daily.set(r.personId, dates.map(() => 0)).get(r.personId);
    row[column.get(r.date)] += r.wins;
  }
  return s.people
    .filter((p) => daily.has(p.id))
    .map((p) => ({
      id: p.id, name: p.name, label: p.initials, color: p.avColor,
      points: cumulate(daily.get(p.id)),
    }))
    .sort((a, b) => last(b.points) - last(a.points))
    .map((line, i) => ({ ...line, dim: i > 0 }));
}

/** Seats invited and seats claimed, added up across every sweep, day by day — every
 *  day, so the week nobody joined in is drawn as the flat week it was. This is the one
 *  number on the page that means something rolled up: people joining is people joining,
 *  whichever sweep it was. */
export function mergeJoins(stats) {
  const byDate = new Map();
  for (const s of stats) {
    for (const j of s.joins) {
      const row = byDate.get(j.date) ?? byDate.set(j.date, { date: j.date, created: 0, claimed: 0 }).get(j.date);
      row.created += j.created;
      row.claimed += j.claimed;
    }
  }
  return daySpan([...byDate.keys()]).map((d) => byDate.get(d) ?? { date: d, created: 0, claimed: 0 });
}

const sooner = (a, b) => (!a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b);

/** Games played and games left, across every competition being followed, and the very
 *  next kickoff among them — which is the question "is anything happening tonight".
 *
 *  Per COMPETITION, not per sweep: the route groups the fixtures by competition and
 *  hands two sweeps following the same season the identical block, so adding the rows up
 *  as they arrive counts that season's games once per sweep. Two office pools on the
 *  same league is the obvious way to end up with two sweeps, so this is the common case
 *  rather than the exotic one. */
export function mergeSeason(stats) {
  const perCompetition = new Map(stats.map((s) => [s.competitionId, s.season]));
  return [...perCompetition.values()].reduce(
    (acc, season) => ({
      final: acc.final + season.final,
      total: acc.total + season.total,
      next: sooner(acc.next, season.next),
    }),
    { final: 0, total: 0, next: null },
  );
}

/** "in 2 days" — how long until the next game, at the resolution anyone cares about. */
function untilText(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "any minute now";
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return "within the hour";
  if (hours < 36) return `in ${plural(hours, "hour")}`;
  return `in ${plural(Math.round(hours / 24), "day")}`;
}

const daysSince = (date) => Math.max(0, Math.round((Date.now() - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));

/** Is the rail lying down? Below 820px it does, and so does this grid — the race has to
 *  drop lines rather than shrink them.
 *
 *  Not components.jsx's useIsDesktop, which is the same eight lines: that one asks
 *  (min-width:900px), the sweep app's desktop frame, and the number that matters here is
 *  the 820px .ac-grid drops to one column at — between the two the race would shed lines
 *  while its card was still full width. And importing it would pull components.jsx into
 *  a console that has never touched it: that module reaches App.jsx, the sweep stores and
 *  api/client.js, all of which the console deliberately mounts without (screens-account.jsx
 *  says the same about its own gear menu). The 820 is repeated from styles.css because
 *  matchMedia cannot read a breakpoint out of a stylesheet; the two live one grep apart. */
function useNarrow() {
  const query = "(max-width:820px)";
  const [narrow, setNarrow] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const onChange = () => setNarrow(m.matches);
    m.addEventListener ? m.addEventListener("change", onChange) : m.addListener(onChange);
    return () => {
      m.removeEventListener ? m.removeEventListener("change", onChange) : m.removeListener(onChange);
    };
  }, []);
  return narrow;
}

/* ---------------- the cards ---------------- */

/** The screenshot. One line per member, in the colour of the avatar they already wear
 *  inside the sweep, so the chart and the app agree about who is who. This is the
 *  group's story — you were level until the third weekend and then Dave's teams woke
 *  up — which is why it is first, full width and the only chart with any size to it. */
function RaceCard({ s }) {
  const series = raceSeries(s);
  const narrow = useNarrow();
  const shown = narrow ? series.slice(0, RACE_MAX) : series;
  const leader = series[0];

  return (
    <section className="ac-card is-full">
      <h2 className="ac-card-h">The race</h2>
      {series.length === 0 ? (
        // A sweep whose season has not started is the likeliest sweep to be looked at —
        // it was just made. An empty box says nothing; the first kickoff says everything.
        <p className="ac-b">
          {s.season.next
            ? `Nobody's teams have won anything yet. It starts ${fmtDay(s.season.next)}.`
            : "Nobody's teams have won anything yet, and there is nothing on the calendar yet either."}
        </p>
      ) : (
        <>
          <Lines title="Wins per person, running total" series={shown} height={220} />
          <p className="ch-cap">
            {`${leader.label} out in front on ${plural(last(leader.points), "win")}`}
            {series.length > 1 ? ` · one line per person, running total` : ""}
            {narrow && series.length > shown.length ? ` · showing the top ${RACE_MAX} on a screen this size` : ""}
            {/* Said out loud because the chart cannot help it: `ownership` records who
                owns a team, not since when, so every win a team has ever had is drawn
                under whoever holds it today. The alternative is a timestamped ownership
                history and a re-draw of the whole join — for a chart whose job is to be
                fun in the group chat, the sentence is the honest price. */}
            {` · a team that changes hands takes its old wins with it`}
          </p>
        </>
      )}
    </section>
  );
}

/** Two lines and the gap between them. The gap IS the "not joined yet" number the sweep
 *  card prints as text, which is worth drawing because it is the one thing on this page
 *  the owner can actually go and fix.
 *  claimedAt is the honest join moment — somebody opened the link and took the seat.
 *  createdAt is only when the owner typed their name in, so the upper line is a list of
 *  intentions and the lower one is a list of people. */
function JoinsCard({ joins, href }) {
  const made = cumulate(joins.map((j) => j.created));
  const claimed = cumulate(joins.map((j) => j.claimed));
  const invited = last(made);
  const joined = last(claimed);
  const waiting = invited - joined;
  const lastInvite = [...joins].reverse().find((j) => j.created > 0)?.date;

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Getting in</h2>
      {invited === 0 ? (
        <p className="ac-b">Nobody has been added yet — that is where a sweep starts.</p>
      ) : (
        <>
          <Lines
            title="Seats invited against seats joined"
            height={150}
            series={[
              { id: "made", color: "var(--ink3)", label: String(invited), points: made },
              { id: "in", color: "var(--lp-accent)", label: String(joined), points: claimed },
            ]}
          />
          <p className="ch-key">
            <span><i style={{ background: "var(--ink3)" }} />Invited</span>
            <span><i style={{ background: "var(--lp-accent)" }} />Actually joined</span>
          </p>
          <p className="ch-cap">
            {waiting > 0 ? (
              <>
                {`${plural(waiting, "seat")} still haven't been claimed`}
                {lastInvite ? ` · last invite went out ${plural(daysSince(lastInvite), "day")} ago` : ""}
                {" · "}<a className="ac-inline" href={href}>go and chase them</a>
              </>
            ) : (
              `Everybody is in — all ${plural(invited, "seat")} claimed.`
            )}
          </p>
        </>
      )}
    </section>
  );
}

/** The cheapest card here, and the only one that answers the question the console could
 *  not answer at all: is anything actually happening. The same flexed-<i> bar the match
 *  probabilities use, on the light pane's own line colour. */
function SeasonCard({ season }) {
  const { final, total, next } = season;
  const played = total ? Math.round((final / total) * 100) : 0;

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">The season</h2>
      {total === 0 ? (
        <p className="ac-b">The fixtures haven't landed yet — give the feed a minute.</p>
      ) : (
        <>
          <p className="ch-big">{`${final} of ${total}`}<span>games played</span></p>
          <div className="prob-bar" style={{ background: "var(--line2)", height: 12, borderRadius: 7, marginTop: 14 }}>
            <i style={{ width: `${played}%`, background: "var(--lp-accent)" }} />
          </div>
          <p className="ch-cap">
            {next ? `Next game ${untilText(next)}` : "Nothing left on the calendar."}
          </p>
        </>
      )}
    </section>
  );
}

/** The most on-brief card on the page. Across is what the draw handed you, which is
 *  luck and nothing else — the draw is random. Up is how often you called a game right,
 *  which is the only thing here anybody can take credit for. The quadrants are therefore
 *  a funny and completely true accusation, and the diagonal is the joke. */
function LuckCard({ s }) {
  const byId = new Map(s.people.map((p) => [p.id, p]));
  const wins = new Map();
  for (const r of s.race) wins.set(r.personId, (wins.get(r.personId) ?? 0) + r.wins);
  const mostWins = Math.max(1, ...wins.values());

  const points = s.calls
    .filter((c) => byId.has(c.personId) && c.picks > 0)
    .map((c) => ({
      id: c.personId,
      x: (wins.get(c.personId) ?? 0) / mostWins,
      y: c.right / c.picks,
      label: byId.get(c.personId).initials,
      color: byId.get(c.personId).avColor,
    }));

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Luck vs skill</h2>
      {points.length === 0 ? (
        <p className="ac-b">Nobody has called a game yet. This fills up as the group picks sides.</p>
      ) : (
        <>
          <Scatter
            title="Luck against skill"
            points={points}
            height={200}
            quadrants={["Cursed", "Sharp", "Hopeless", "Blessed"]}
          />
          <p className="ch-cap">
            Across: how many games your teams have won. Up: how often you called one right.
            The draw was random, so anything you see along the diagonal is your imagination.
            {/* `support` has no timestamp either, and the baseline sync deletes the picks
                on any fixture the provider stops listing (worker/baseline-sync.js:173) —
                so the denominator of that percentage can shrink after the fact. */}
            {" "}Up counts the fixtures the feed still lists: drop a game, and it drops
            the pick with it.
          </p>
        </>
      )}
    </section>
  );
}

/** Only for sweeps running wagering — the key is simply absent otherwise. The bets per
 *  day are the pulse; the two lines under it are the bragging rights. */
function PulseCard({ s }) {
  const { daily, biggest, lead } = s.wagering;
  const byId = new Map(s.people.map((p) => [p.id, p]));
  const bets = daily.reduce((n, d) => n + d.bets, 0);
  const staked = daily.reduce((n, d) => n + d.staked, 0);
  // A bar per day between the first bet and the last, not a bar per day that had one:
  // the quiet Tuesday is as much of the pulse as the busy Saturday.
  const byDate = new Map(daily.map((d) => [d.date, d.bets]));
  const perDay = daySpan([...byDate.keys()]).map((d) => byDate.get(d) ?? 0);
  // Whoever leaves it latest is the funnier end of the list, so that is the end shown.
  const latest = lead.reduce((low, l) => (!low || l.medianSec < low.medianSec ? l : low), null);
  const winner = biggest && byId.get(biggest.personId);

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Wagering</h2>
      {daily.length === 0 ? (
        <p className="ac-b">Wagering is on, but nobody has had a bet on yet.</p>
      ) : (
        <>
          <Bars title="Bets placed per day" values={perDay} height={130} />
          <p className="ch-cap">{`${plural(bets, "bet")} · ${staked} coins staked`}</p>
          {winner && (
            <p className="ac-b">
              {`Biggest win: ${winner.name}, ${biggest.profit} coins up on one bet.`}
            </p>
          )}
          {latest && byId.has(latest.personId) && (
            <p className="ac-b">
              {`${byId.get(latest.personId).name} leaves it latest — a median ${plural(Math.round(latest.medianSec / 60), "minute")} before kickoff.`}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Five names beat a bar chart of five names. The loud ones are the top of the list, the
 *  quiet ones are the bottom, and the bottom is the half worth acting on — so those rows
 *  are links into the sweep's own admin, where the owner can go and poke them. */
function LoudCard({ s, href }) {
  const byId = new Map(s.people.map((p) => [p.id, p]));
  const rows = s.activity
    .filter((a) => byId.has(a.personId))
    .map((a) => ({ ...a, person: byId.get(a.personId), total: a.picks + a.bets }))
    .sort((a, b) => b.total - a.total);
  // Past five people the middle is the boring part: keep the three loudest and the two
  // quietest, which is the whole joke.
  const shown = rows.length <= 5 ? rows : [...rows.slice(0, 3), ...rows.slice(-2)];

  // Picks and bets, and no photos: a fan photo — the upload people actually make — is
  // stored with no person on it, so the count this used to print was of profile avatars,
  // which is one each. The route dropped the field rather than ship a number that meant
  // something other than its label, and adding an absent one in made every total NaN.
  const tally = (r) => {
    const parts = [
      r.picks ? plural(r.picks, "pick") : null,
      r.bets ? plural(r.bets, "bet") : null,
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "nothing yet";
  };

  const line = (r) => (
    <>
      <span className="ch-av" style={{ background: r.person.avColor }}>{r.person.initials}</span>
      <span className="ch-name">{r.person.name}</span>
      <span className="ch-tally">{tally(r)}</span>
    </>
  );

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">The loud and the quiet</h2>
      {rows.length === 0 ? (
        <p className="ac-b">Nobody in this one yet.</p>
      ) : (
        shown.map((r) =>
          r.total === 0 ? (
            <a className="ch-row is-quiet" key={r.personId} href={href} title="Go and chase them">{line(r)}</a>
          ) : (
            <div className="ch-row" key={r.personId}>{line(r)}</div>
          ),
        )
      )}
    </section>
  );
}

/** The six cards, in the order that makes the page read top to bottom: the race is the
 *  story, the last one is a footnote. `joins` and `season` default to this sweep's own,
 *  which is the whole of what the sweep's page needs; the dashboard passes its rolled-up
 *  versions instead, because those two are the only numbers here that mean anything
 *  added together. */
export function StoryGrid({ s, joins = s.joins, season = s.season, joinsHref }) {
  const admin = `/s/${s.sweepId}/admin`;
  return (
    <div className="ac-grid">
      <RaceCard s={s} />
      <JoinsCard joins={joins} href={joinsHref ?? admin} />
      <SeasonCard season={season} />
      <LuckCard s={s} />
      {s.wagering && <PulseCard s={s} />}
      <LoudCard s={s} href={admin} />
    </div>
  );
}

/** The console's front page. */
export function Dashboard() {
  const [sweeps, setSweeps] = useState(null);
  const [stats, setStats] = useState(null);
  const [failed, setFailed] = useState(false);
  const [focusId, setFocusId] = useState(null);

  // Two requests, two fates. The list is the cached one the rail is already drawn from,
  // and the charts are the risky half of this page: if the stats fall over, the page
  // says so and everything else — the rail, the way to your sweeps — still works.
  useEffect(() => {
    let alive = true;
    getAccountSweeps().then((rows) => { if (alive) setSweeps(rows); }, () => { if (alive) setSweeps([]); });
    getAccountStats().then((rows) => { if (alive) setStats(rows); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // The stats route has no ORDER BY either, so the order comes from the list beside it —
  // newest first, the same order the rail is in, so the picker and the rail agree.
  const ordered = useMemo(() => {
    if (!stats || !sweeps) return null;
    const rank = new Map(
      [...sweeps]
        .filter((s) => !s.archivedAt && s.role !== "member")
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((s, i) => [s.id, i]),
    );
    // Infinity, not a number the list could reach: the two requests are answered
    // separately, so a sweep created between them has a stats row and no rank yet, and
    // it belongs at the end rather than at whatever position the fallback happens to be.
    return [...stats].sort((a, b) => (rank.get(a.sweepId) ?? Infinity) - (rank.get(b.sweepId) ?? Infinity));
  }, [stats, sweeps]);

  if (failed)
    return (
      <Console here="home" wide>
        <Header count={null} people={null} />
        <p className="ac-warn">Couldn't work out your numbers just now. Reload the page.</p>
      </Console>
    );

  if (!ordered)
    return (
      <Console here="home" wide>
        <Header count={null} people={null} />
        {/* One skeleton, not six: the shape of the page arrives before the numbers do. */}
        <div className="ac-grid">
          <div className="ac-card is-full ch-skel" style={{ height: 260 }} />
          <div className="ac-card ch-skel" style={{ height: 190 }} />
          <div className="ac-card ch-skel" style={{ height: 190 }} />
        </div>
      </Console>
    );

  if (ordered.length === 0)
    return (
      <Console here="home" wide>
        <Header count={0} people={0} />
        <NoSweepsYet />
      </Console>
    );

  // Which sweep the race is about. The most interesting one by default — the one with
  // the most results in it — and after that, whichever one you asked for. Deliberately
  // a native <select> and not a filter UI: it is one question with one answer.
  const nameOf = (id) => sweeps.find((s) => s.id === id)?.name ?? "Your sweep";
  const liveliest = [...ordered].sort((a, b) => b.race.length - a.race.length || b.people.length - a.people.length)[0];
  const focus = ordered.find((s) => s.sweepId === focusId) ?? liveliest;
  const people = ordered.reduce((n, s) => n + s.people.length, 0);

  return (
    <Console here="home" wide>
      <Header count={ordered.length} people={people} />
      {ordered.length > 1 && (
        <label className="ch-focus">
          <span>Showing</span>
          <select value={focus.sweepId} onChange={(e) => setFocusId(e.target.value)}>
            {ordered.map((s) => <option key={s.sweepId} value={s.sweepId}>{nameOf(s.sweepId)}</option>)}
          </select>
        </label>
      )}
      <StoryGrid
        s={focus}
        joins={mergeJoins(ordered)}
        season={mergeSeason(ordered)}
        // Only when there is more than one sweep, and then the list: with one sweep the
        // card's own default — that sweep's admin — is already the right door.
        joinsHref={ordered.length > 1 ? "/account/sweeps" : null}
      />
    </Console>
  );
}

/** The same three lines above the page whatever state it is in, so a failure and a load
 *  do not each invent their own heading. The link is load-bearing: billing lives on the
 *  list, and the rail only offers the list once you run more sweeps than it will show.
 *
 *  BillingNotice sits here rather than in the branches below for the same reason: this
 *  is the one thing all four states share, and a lapsed owner arrives on this page from
 *  the sweep's read-only warning whether their charts loaded or not. It says nothing at
 *  all unless there is a bill to settle. */
function Header({ count, people }) {
  return (
    <>
      <p className="lp-eyebrow">My account</p>
      <h1 className="ac-h1">How it's going</h1>
      <p className="ac-sub">
        {count ? `${plural(count, "sweep")} running · ${people} ${people === 1 ? "person" : "people"} in them · ` : ""}
        <a className="ac-inline" href="/account/sweeps">Your sweeps and billing</a>
      </p>
      <BillingNotice />
    </>
  );
}
