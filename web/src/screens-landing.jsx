/* ============================================================
   THE SWEEP — logged-out front door (platform host).

   A marketing surface, deliberately calmer than the app: an
   Instrument Serif headline over the app's navy, DM Sans for prose,
   one accent. Price lives on /pricing — the front page sells the
   thing, the top bar is where you go to find what it costs.

   Motion has one job here: the results rail is live data, so the page
   demonstrates the promise (the season keeps its own score) instead
   of only claiming it. Everything else reveals once, on entry.
   ============================================================ */
import { useEffect, useRef, useState } from "react"

/** The app shell is a fixed-viewport frame (#appmount is 100vh on desktop, body is
 *  flex-centred). A marketing page has to scroll the document instead — otherwise
 *  anchors, the mobile URL bar and browser find all behave oddly inside a nested
 *  scroller. Marketing surfaces flag themselves on <body> and the shell relaxes. */
export function useMarketingShell() {
  useEffect(() => {
    document.body.classList.add("marketing")
    document.documentElement.classList.add("marketing-scroll")
    return () => {
      document.body.classList.remove("marketing")
      document.documentElement.classList.remove("marketing-scroll")
    }
  }, [])
}

// The pairings in the draw band are the ones visible in the screenshots below,
// so the page and the shots tell the same story.
// [face, team, crest]. The faces are generated, not photographs of anyone —
// a sweep is a group of people, so the slips show people, not initials.
const SLIPS = [
  ["p3", "Houston Rockets", "hou"],
  ["p2", "Brooklyn Nets", "bkn"],
  ["p5", "LA Lakers", "lal"],
  ["p4", "Milwaukee Bucks", "mil"],
  ["p6", "Toronto Raptors", "tor"],
  ["p1", "Indiana Pacers", "ind"],
]

const COMPETITIONS = [
  "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "NBA", "World Cup",
]

// The hero line rotates per visit — same promise, three different angles at it.
// Two lines each; *stars* mark the word that gets the hand-written Caveat.
// ponytail: random on load, not a timed cycle; a line that swaps under you mid-read
// is a gimmick, and re-running the entrance mask animation costs more than it buys.
const HEADLINES = [
  ["Be the one who *runs* the sweep.", "Not the one updating it."],
  ["*You* start it.", "The group never shuts up about it."],
  ["Be the reason *everyone*", "cares about a Tuesday night game."],
]

/** "Not the one *updating* it." → text with the starred word in <em> (Caveat). */
function HeroLine({ line }) {
  return (
    <span className="lp-mask">
      <span>{line.split(/\*(.+?)\*/).map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))}</span>
    </span>
  )
}

const STEPS = [
  ["Pick the competition",
   "Football, basketball — any two-team sport. Choose a league and season, or a tournament, and the sweep pulls its own fixtures."],
  ["Send one link",
   "Your group taps it and they're in. No accounts to make, nothing to install."],
  ["Draw the teams",
   "Allocate from the hat once. After that the results, the ladder and the finishing order look after themselves."],
]

/** Reveal-on-scroll for anything marked data-reveal. One observer for the page;
 *  elements start hidden in CSS and stay visible once seen (no re-hiding on scroll
 *  back, which reads as jitter). Reduced-motion callers get everything at once. */
export function useReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll("[data-reveal]"))
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"))
      return
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        e.target.classList.add("is-in")
        io.unobserve(e.target)
      })
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.12 })
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])
}

/** The results rail: real finished games off /api/public/results, newest first.
 *  Renders nothing at all when the feed is empty or unreachable — an empty
 *  scoreboard is worse than no scoreboard. */
export function ResultsTicker() {
  const [rows, setRows] = useState([])
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    fetch("/api/public/results")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive.current && Array.isArray(d)) setRows(d.slice(0, 12)) })
      .catch(() => {})
    return () => { alive.current = false }
  }, [])

  if (!rows.length) return null

  const item = (r, k) => {
    // a drawn game has no winner to lead with — keep it in home order and let both
    // sides read level, rather than implying the home side won it
    const drawn = !r.home.won && !r.away.won
    const [first, second] = drawn || r.home.won ? [r.home, r.away] : [r.away, r.home]
    return (
      <span className="lp-tick" key={k}>
        {drawn ? <span>{first.name}</span> : <b>{first.name}</b>}
        <span className="lp-tick-score">{first.score}</span>
        <span className="lp-tick-dash">–</span>
        <span className={"lp-tick-score" + (drawn ? "" : " lp-tick-lost")}>{second.score}</span>
        <span className={drawn ? "" : "lp-tick-lost"}>{second.name}</span>
      </span>
    )
  }

  return (
    <div className="lp-ticker" aria-label="Recent results">
      <span className="lp-ticker-tag"><i className="lp-ticker-dot" />Recent results</span>
      <div className="lp-ticker-window">
        {/* two identical runs so the loop has no seam */}
        <div className="lp-ticker-rail">
          <span className="lp-ticker-run">{rows.map((r, i) => item(r, `a${i}`))}</span>
          <span className="lp-ticker-run" aria-hidden="true">{rows.map((r, i) => item(r, `b${i}`))}</span>
        </div>
      </div>
    </div>
  )
}

/** Which nav item is "here": the pricing page by path, or whichever section of
 *  the landing is currently in view. Highlighting the wrong one is worse than
 *  highlighting none, so nothing is active until a section actually arrives. */
export function useActiveNav() {
  const [active, setActive] = useState(
    () => (typeof location !== "undefined" && location.pathname === "/pricing" ? "pricing" : null))

  useEffect(() => {
    if (location.pathname === "/pricing") return
    const sections = ["how", "inside"].map((id) => document.getElementById(id)).filter(Boolean)
    if (!sections.length || !("IntersectionObserver" in window)) return
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting)
      if (seen.length) setActive(seen[seen.length - 1].target.id)
      else if (window.scrollY < 200) setActive(null)   // back at the top: nothing is "here"
    }, { rootMargin: "-45% 0px -45% 0px" })
    sections.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return active
}

export function LandingNav() {
  const active = useActiveNav()
  const cls = (key) => (active === key ? "is-here" : undefined)
  return (
    <header className="lp-nav">
      <div className="lp-nav-in">
        <a className="lp-brand" href="/">
          <span>The Sweep</span>
        </a>
        <nav className="lp-links">
          <a className={cls("how")} href="/#how">How it works</a>
          <a className={cls("inside")} href="/#inside">Inside a sweep</a>
          <a className={cls("pricing")} href="/pricing">Pricing</a>
        </nav>
        <div className="lp-nav-cta">
          <a className="lp-ghost" href="/account">Sign in</a>
          <a className="lp-btn" href="/account">Start free</a>
        </div>
      </div>
    </header>
  )
}

export function LandingFoot() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot-in">
        <div className="lp-brand lp-brand-sm">
          <span>The Sweep</span>
        </div>
        <p className="lp-foot-note">
          Been sent an invite link? Just open it — joining a sweep needs no account.
        </p>
        <nav className="lp-foot-links">
          <a href="/pricing">Pricing</a>
          <a href="/account">Sign in</a>
        </nav>
      </div>
    </footer>
  )
}

export function Landing() {
  useMarketingShell()
  useReveal()
  const [headline] = useState(() => HEADLINES[Math.floor(Math.random() * HEADLINES.length)])
  return (
    <div data-testid="sweep-landing" className="lp">
      <LandingNav />
      <ResultsTicker />

      <section className="lp-hero">
        <h1 className="lp-h1">
          {headline.map((line) => <HeroLine key={line} line={line} />)}
        </h1>
        <p className="lp-lede lp-in lp-in-2">
          Pick a competition, send one link, pull the teams out of the hat. From there
          the fixtures, the scores and the ladder look after themselves — right through
          to the finishing order.
        </p>
        <div className="lp-hero-cta lp-in lp-in-2">
          <a className="lp-btn lp-btn-lg" href="/account">Start free</a>
          <span className="lp-microcopy">14 days free · no card</span>
        </div>

        <figure className="lp-stage lp-in lp-in-3">
          <img className="lp-stage-img" src="/marketing/app-teams.webp" width="1400" height="706"
               alt="Every team in the sweep with the person who drew it, eliminated sides greyed out" />
        </figure>
      </section>

      <section className="lp-strip" data-reveal aria-label="Competitions you can run a sweep on">
        <p>{COMPETITIONS.join("  ·  ")}<span className="lp-strip-more">  ·  more each season</span></p>
        <p className="lp-strip-note">1,600+ leagues and tournaments, one sweep at a time</p>
      </section>

      <section className="lp-sec" id="how" data-reveal>
        <p className="lp-eyebrow">How it works</p>
        <h2 className="lp-h2">Three steps, then it runs itself</h2>
        <div className="lp-cards">
          {STEPS.map(([head, body], i) => (
            <article className="lp-card" key={head}>
              <span className="lp-card-n">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="lp-card-h">{head}</h3>
              <p className="lp-card-b">{body}</p>
            </article>
          ))}
        </div>

        <div className="lp-draw">
          <div className="lp-draw-rail" aria-label="An example draw">
            {SLIPS.map(([face, team, crest], i) => (
              <span className="lp-slip" key={team} style={{ "--i": i }}>
                <img className="lp-av" src={`/marketing/faces/${face}.webp`} alt="" loading="lazy" />
                <img className="lp-crest" src={`/marketing/teams/${crest}.webp`} alt="" loading="lazy" />
                {team}
              </span>
            ))}
          </div>
          <p className="lp-draw-cap">A draw is ten people, thirty teams, one afternoon.</p>
        </div>
      </section>

      <section className="lp-sec" id="inside" data-reveal>
        <p className="lp-eyebrow">Inside a sweep</p>
        <h2 className="lp-h2">Everything the group argues about, on screen</h2>

        <div className="lp-bento">
          <article className="lp-tile lp-tile-wide">
            <div className="lp-tile-copy">
              <h3 className="lp-tile-h">Who's actually winning</h3>
              <p className="lp-tile-b">
                The only table your group cares about: sorted by wins, predictions or
                finishing order, with everyone mathematically out marked as out.
              </p>
            </div>
            <img src="/marketing/app-people.webp" alt="The sweep leaderboard sorted by team wins" loading="lazy" />
          </article>

          <article className="lp-tile">
            <div className="lp-tile-copy">
              <h3 className="lp-tile-h">The real ladder</h3>
              <p className="lp-tile-b">
                Live tables straight off the feed — conferences, groups, goal difference,
                percentage, whatever that sport counts.
              </p>
            </div>
            <img src="/marketing/app-standings.webp" alt="League tables grouped by conference" loading="lazy" />
          </article>

          <article className="lp-tile">
            <div className="lp-tile-copy">
              <h3 className="lp-tile-h">Every game has a name on it</h3>
              <p className="lp-tile-b">
                Each fixture shows whose team is playing, so a Tuesday night game nobody
                would watch turns into a group chat.
              </p>
            </div>
            <img src="/marketing/app-today.webp" alt="Match day view showing the next game and both teams' owners" loading="lazy" />
          </article>
        </div>

        <div className="lp-aside">
          <h3 className="lp-aside-h">Wagering, only if you want it</h3>
          <p className="lp-aside-b">
            Switch it on and everyone gets play money for head-to-head, totals and handicap
            markets. Switch it off and nobody sees it. No real money changes hands either way.
          </p>
        </div>
      </section>

      <section className="lp-final" data-reveal>
        <h2 className="lp-h2">Start one before the season does</h2>
        <p className="lp-final-b">
          Two weeks free, no card. Bring the group in with a link and let the feed do
          the rest.
        </p>
        <a className="lp-btn lp-btn-lg" href="/account">Start free</a>
      </section>

      <LandingFoot />
    </div>
  )
}
