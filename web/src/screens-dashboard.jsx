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

   The cards are grouped into StoryGrid, which the sweep's own page reuses wholesale: the
   same six widgets about one sweep either way. Nothing here is rolled up across sweeps.
   "Getting in" and "The season" used to be, which put two cards on a different scope from
   the picker heading right above them — and made "The season", singular, the fixtures of
   every unrelated competition the account follows added together.
   ============================================================ */
import { useState, useEffect, useMemo } from "react";
import { Console, NoSweepsYet, fmtDay, BillingNotice } from "./screens-account.jsx";
import { getAccountSweeps, getAccountStats } from "./lib/accountClient.js";
import { Lines, Bars, Scatter, oneDay } from "./charts.jsx";

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

/** One line per person who has won something, as a running total over every day between
 *  the first win in the sweep and the last — the quiet ones included, or the axis is not
 *  a calendar. People with nothing yet are left out rather than drawn as a flat zero:
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

/** The joins buckets with the quiet days put back. The route ships one row per day
 *  somebody was added or claimed a seat and nothing at all for the rest, and this card is
 *  two lines over an even spread — so without this a fortnight of silence draws the same
 *  width as a busy afternoon. Filled inside the card rather than by whoever renders it:
 *  the sweep's own page renders the same card and was handing it the buckets raw. */
export const fillJoins = (joins) => {
  const byDate = new Map(joins.map((j) => [j.date, j]));
  return daySpan(joins.map((j) => j.date)).map((d) => byDate.get(d) ?? { date: d, created: 0, claimed: 0 });
};

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

/** Whole days between a 'YYYY-MM-DD' bucket and now, and then how anybody would say it.
 *  Floored rather than rounded, because these are calendar days: rounding made anything
 *  after midday "1 day ago" while it was still today. */
const daysSince = (date) => Math.max(0, Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / DAY_MS));
const ago = (date) => (daysSince(date) === 0 ? "today" : `${plural(daysSince(date), "day")} ago`);

/** Whether this is a phone. The one thing on this page that is a real behaviour change
 *  rather than a size: below 820px the rail lies down, the grid is one column and the
 *  race sheds lines rather than drawing a dozen of them 30px apart. How BIG anything is
 *  drawn is not asked here at all any more — the cards size themselves against the column
 *  they are in (a container query) and the charts take their height from the stylesheet.
 *
 *  Not components.jsx's useIsDesktop, which is the same eight lines: that one asks
 *  (min-width:900px), the sweep app's desktop frame, and the number that matters here is
 *  the 820px the console's rail lies down at. And importing it would pull components.jsx
 *  into a console that has never touched it: that module reaches App.jsx, the sweep stores
 *  and api/client.js, all of which the console deliberately mounts without
 *  (screens-account.jsx says the same about its own gear menu). The 820 is repeated from
 *  styles.css because matchMedia cannot read a breakpoint out of a stylesheet; the two
 *  live one grep apart. */
function useMedia(query) {
  const [on, setOn] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const onChange = () => setOn(m.matches);
    m.addEventListener ? m.addEventListener("change", onChange) : m.addListener(onChange);
    return () => {
      m.removeEventListener ? m.removeEventListener("change", onChange) : m.removeListener(onChange);
    };
  }, [query]);
  return on;
}

const useNarrow = () => useMedia("(max-width:820px)");

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
  // Every win on the same day is one column, and one column is not a line.
  const flat = series.length > 0 && oneDay(shown);
  // What the caption may claim. "Out in front" was a claim about the sweep's own
  // leaderboard, and this chart is not that one: a league sweep ranks people by where
  // their best club sits in the table (lib/assemble.js:249), so whoever has the most team
  // wins can be third on the group's People tab. The console cannot match that ranking —
  // GET /api/account/stats ships wins per day and no table at all — so the caption says
  // the thing the chart actually measures. And level is level: naming the first of two
  // people on the same number was naming whatever order the roster came back in, which is
  // by name.
  const top = series.length ? last(leader.points) : 0;
  const level = series.filter((l) => last(l.points) === top);
  const allWins = series.reduce((n, l) => n + last(l.points), 0);
  const headline = level.length > 1
    ? `${level.map((l) => l.label).join(", ")} level on ${plural(top, "win")}`
    : `${leader?.label} has the most team wins — ${top}`;

  return (
    // Two columns wherever there are two — which is the whole width until the grid runs
    // three. Its height is the stylesheet's business, not this width's.
    <section className="ac-card is-double">
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
          {/* A sweep whose results all landed today draws every line as a single point,
              which is an empty box. The score is the whole story on day one; say it. */}
          {flat ? (
            // The group's wins, not the leader's. This number stands where a chart of
            // EVERY line would be, and the two cards that pull the same trick — seats
            // claimed, wagers placed — both put the total in it, so a leader's count
            // under a bare "wins so far" read as the sweep's and was short. Whose the
            // biggest share is belongs to the caption below, which already says it.
            <p className="ch-big">
              {allWins}
              <span>{`${allWins === 1 ? "win" : "wins"} so far, all on the one day`}</span>
            </p>
          ) : (
            <Lines title="Wins per person, running total" series={shown} tall />
          )}
          <p className="ch-cap">
            {headline}
            {!flat && series.length > 1 ? ` · one line per person, running total` : ""}
            {!flat && narrow && series.length > shown.length ? ` · showing the top ${RACE_MAX} on a screen this size` : ""}
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

/** Two lines and the gap between them, for this sweep. The gap IS the "not joined yet"
 *  number the sweep card prints as text, which is worth drawing because it is the one
 *  thing on this page the owner can actually go and fix.
 *  claimedAt is the honest join moment — somebody opened the link and took the seat.
 *  createdAt is only when the owner typed their name in, so the upper line is a list of
 *  intentions and the lower one is a list of people. */
function JoinsCard({ joins: buckets, href }) {
  const joins = fillJoins(buckets);
  const made = cumulate(joins.map((j) => j.created));
  const claimed = cumulate(joins.map((j) => j.claimed));
  const invited = last(made);
  const joined = last(claimed);
  const waiting = invited - joined;
  // The last seat ADDED, which is not the last invite sent: person.created_at is the
  // moment the owner typed a name into the roster, and nothing anywhere records when the
  // link actually went out. The card's own note above says the same about the two lines.
  const lastAdded = [...joins].reverse().find((j) => j.created > 0)?.date;
  // Every seat added the same afternoon — the usual shape of a sweep set up this
  // morning — is one column, and two lines through one column each draw nothing.
  const flat = joins.length < 2;

  return (
    // is-double: a fortnight of joins across a third of a 1440px pane is a scribble.
    <section className="ac-card is-double">
      <h2 className="ac-card-h">Getting in</h2>
      {invited === 0 ? (
        <p className="ac-b">Nobody has been added yet — that is where a sweep starts.</p>
      ) : (
        <>
          {flat ? (
            <p className="ch-big">{`${joined} of ${invited}`}<span>seats claimed</span></p>
          ) : (
            <>
              <Lines
                title="Seats invited against seats joined"
                series={[
                  { id: "made", color: "var(--ink3)", label: String(invited), points: made },
                  { id: "in", color: "var(--lp-accent)", label: String(joined), points: claimed },
                ]}
              />
              <p className="ch-key">
                <span><i style={{ background: "var(--ink3)" }} />Invited</span>
                <span><i style={{ background: "var(--lp-accent)" }} />Actually joined</span>
              </p>
            </>
          )}
          <p className="ch-cap">
            {waiting > 0 ? (
              <>
                {`${plural(waiting, "seat")} still ${waiting === 1 ? "hasn't" : "haven't"} been claimed`}
                {lastAdded ? ` · last seat added ${ago(lastAdded)}` : ""}
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
          {/* `next` is the soonest kickoff STILL AHEAD (the route filters on `> now()`),
              so it is null on a stalled feed and on fixtures the provider has not dated
              yet as well as on a finished season — and the card was announcing the season
              over while the bar right above it showed a third of the games unplayed. */}
          <p className="ch-cap">
            {next ? `Next game ${untilText(next)}`
              : final >= total ? "Nothing left on the calendar."
              : `${plural(total - final, "game")} still to play, but nothing on the calendar ahead — the feed may be behind.`}
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
  // `calls` only carries fixtures that have finished AND that the feed gave a result for
  // (api/src/routes/account.js), while this is every pick anybody has made. A group that
  // has called all of next week's games has an empty scatter and a full "loud and quiet"
  // card beside it, which is a different sentence from nobody having picked.
  const picked = s.activity.reduce((n, a) => n + a.picks, 0);
  const called = s.calls.filter((c) => byId.has(c.personId) && c.picks > 0);
  // Scatter plots 0..1 fractions of each axis, so across is wins measured against the
  // best-off person rather than an absolute count: one hot streak drags everybody else to
  // the left-hand wall, and read as a count that says the rest of them have won nothing.
  // Measured against the best-off DOT, because `wins` counts the whole sweep and only the
  // people who have called a game are drawn — divided by a leader who never picks, the
  // right-hand wall the caption points at had nobody standing on it. And a group before
  // its first result divides by nothing at all: everybody is on the left wall, which is
  // true, so the caption below says that instead of promising a leader on the right.
  const mostWins = Math.max(0, ...called.map((c) => wins.get(c.personId) ?? 0));

  const points = called.map((c) => ({
    id: c.personId,
    x: mostWins ? (wins.get(c.personId) ?? 0) / mostWins : 0,
    y: c.right / c.picks,
    label: byId.get(c.personId).initials,
    color: byId.get(c.personId).avColor,
  }));

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Luck vs skill</h2>
      {points.length === 0 ? (
        <p className="ac-b">
          {picked > 0
            ? `${plural(picked, "pick")} in, and no result on any of them yet — this fills up as those games finish.`
            : "Nobody has called a game yet. This fills up as the group picks sides."}
        </p>
      ) : (
        <>
          <Scatter
            title="Luck against skill"
            points={points}
            quadrants={["Cursed", "Sharp", "Hopeless", "Blessed"]}
          />
          <p className="ch-cap">
            {mostWins > 0
              ? "Across: how your teams' wins compare with the group's best — the right-hand edge is whoever has won the most."
              : "Across: not one of anybody's teams has won a game yet, so everybody is on the left-hand wall until one does."}
            {" "}Up: how often you called one right.
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

/** Only for sweeps running wagering — the key is simply absent otherwise. The wagers per
 *  day are the pulse; the two lines under it are the bragging rights.
 *
 *  "Wager" is the word this card uses, everywhere. Every number on it is a count of the
 *  api's `wagers` union (api/src/routes/account.js:631), which folds a four-leg
 *  accumulator into the single row it is rather than four bets that staked nothing — so
 *  "3 bets" was already the wrong noun for the rows being counted, and the biggest-win
 *  line beside it said "wager" about the identical rows. One card, one word. */
function PulseCard({ s }) {
  const { daily, biggest, lead } = s.wagering;
  const byId = new Map(s.people.map((p) => [p.id, p]));
  const wagers = daily.reduce((n, d) => n + d.bets, 0);
  const staked = daily.reduce((n, d) => n + d.staked, 0);
  // A bar per day between the first wager and the last, not a bar per day that had one:
  // the quiet Tuesday is as much of the pulse as the busy Saturday.
  const byDate = new Map(daily.map((d) => [d.date, d.bets]));
  const perDay = daySpan([...byDate.keys()]).map((d) => byDate.get(d) ?? 0);
  // Whoever leaves it latest is the funnier end of the list, so that is the end shown.
  const latest = lead.reduce((low, l) => (!low || l.medianSec < low.medianSec ? l : low), null);
  // A bet needs its fixture to still be `upcoming` (api/src/routes/coins.js:70), so this
  // is never an in-play punt — a median that comes out negative is a kickoff that had
  // already passed: a fixture the feed had not moved on yet, or one the feed rescheduled
  // earlier after the bet was placed. Worth saying rather than hiding, because the line
  // picks the SMALLEST lead time and a negative one always wins it.
  const mins = latest ? Math.round(latest.medianSec / 60) : 0;
  const when = mins > 0 ? `a median ${plural(mins, "minute")} before kickoff`
    : mins < 0 ? `a median ${plural(-mins, "minute")} past the kickoff time`
    : "a median of right on the whistle";
  const winner = biggest && byId.get(biggest.personId);

  return (
    <section className="ac-card is-double">
      <h2 className="ac-card-h">Wagering</h2>
      {daily.length === 0 ? (
        <p className="ac-b">Wagering is on, but nobody has placed a wager yet.</p>
      ) : (
        <>
          {/* One day of betting is one bar, and one bar is always full height because it
              is its own maximum — a drawing that says the same thing whatever the number
              is. The number does not have that problem. */}
          {perDay.length < 2 ? (
            <p className="ch-big">
              {wagers}
              <span>{`${wagers === 1 ? "wager" : "wagers"} · ${plural(staked, "coin")} staked, all on the one day`}</span>
            </p>
          ) : (
            <>
              <Bars title="Wagers placed per day" values={perDay} />
              <p className="ch-cap">{`${plural(wagers, "wager")} · ${plural(staked, "coin")} staked`}</p>
            </>
          )}
          {winner && (
            // The fattest win on the board can be a parlay, and the payload does not say
            // which — so neither does this. "One wager" covers both, which is why it is
            // the word the rest of the card uses too.
            <p className="ac-b">
              {`Biggest win: ${winner.name}, ${plural(biggest.profit, "coin")} up on one wager.`}
            </p>
          )}
          {latest && byId.has(latest.personId) && (
            <p className="ac-b">
              {`${byId.get(latest.personId).name} leaves it latest — ${when}.`}
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

  // Picks and wagers, and no photos. "Wager" for the same reason the card above uses it:
  // this count is the same `wagers` union, so a person's four-leg accumulator is one row
  // here as well. A fan photo — the upload people actually make — is
  // stored with no person on it, so the count this used to print was of profile avatars,
  // which is one each. The route dropped the field rather than ship a number that meant
  // something other than its label, and adding an absent one in made every total NaN.
  const tally = (r) => {
    const parts = [
      r.picks ? plural(r.picks, "pick") : null,
      r.bets ? plural(r.bets, "wager") : null,
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
 *  story, the last one is a footnote. Every one of them is about the sweep it is handed,
 *  which is what lets the dashboard put a picker above the lot and have the heading mean
 *  something. */
/** `lean` is the sweep's own page: one column, the race, where the season is and who
 *  has joined — the group-story cards (luck, loud/quiet) are the dashboard's. */
export function StoryGrid({ s, lean = false }) {
  const admin = `/s/${s.sweepId}/admin`;
  return (
    // The wrapper is what the cards are measured against — .ac-story is the container
    // the grid's own breakpoints are asked of, so this grid lays out the same in a
    // 464px column of the sweep page as it does in a 464px window.
    <div className={"ac-story" + (lean ? " is-lean" : "")}><div className="ac-grid">
      <RaceCard s={s} />
      {lean && <SeasonCard season={s.season} />}
      <JoinsCard joins={s.joins} href={admin} />
      {!lean && <SeasonCard season={s.season} />}
      {!lean && <LuckCard s={s} />}
      {s.wagering && <PulseCard s={s} />}
      {!lean && <LoudCard s={s} href={admin} />}
    </div></div>
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
    // An unranked row goes after the ranked ones and level with the other unranked ones:
    // rank.size is one past the last place, and two of them subtract to nothing. That is
    // reachable rather than theoretical — the list request can fail while the stats
    // request lands, and then NOTHING is ranked, which is the case where a fallback of
    // Infinity would hand sort() a comparator returning NaN.
    const rankOf = (r) => rank.get(r.sweepId) ?? rank.size;
    return [...stats].sort((a, b) => rankOf(a) - rankOf(b));
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
        <div className="ac-story"><div className="ac-grid">
          <div className="ac-card is-double ch-skel" style={{ height: 260 }} />
          <div className="ac-card ch-skel" style={{ height: 190 }} />
          <div className="ac-card ch-skel" style={{ height: 190 }} />
        </div></div>
      </Console>
    );

  if (ordered.length === 0)
    return (
      <Console here="home" wide>
        <Header count={0} people={0} />
        <NoSweepsYet />
      </Console>
    );

  // Which sweep the PAGE is about — every card below follows it. The most interesting one
  // by default — the one with the most results in it — and after that, whichever one you
  // asked for. Deliberately a native <select> and not a filter UI: one question, one
  // answer.
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
      <StoryGrid s={focus} />
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
        {/* Seats, not people: the roster rows this counts carry no account id — GET
            /api/account/stats never selects one — so the same friend in three of your
            sweeps is three rows here with nothing to de-duplicate them by. */}
        {count ? `${plural(count, "sweep")} running · ${plural(people, "seat")} in them · ` : ""}
        <a className="ac-inline" href="/account/sweeps">Your sweeps and billing</a>
      </p>
      <BillingNotice />
    </>
  );
}
