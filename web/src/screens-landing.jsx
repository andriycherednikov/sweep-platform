/* ============================================================
   THE SWEEP — logged-out front door (platform host).

   A marketing surface, deliberately calmer than the app: mixed-case
   Bricolage display over the app's navy, glass panels, one accent.
   Price lives on /pricing — the front page sells the thing, the top
   bar is where you go to find what it costs.
   ============================================================ */
import { useEffect } from "react"

/** The app shell is a fixed-viewport frame (#appmount is 100vh on desktop, body is
 *  flex-centred). A marketing page has to scroll the document instead — otherwise
 *  anchors, the mobile URL bar and browser find all behave oddly inside a nested
 *  scroller. Marketing surfaces flag themselves on <body> and the shell relaxes. */
export function useMarketingShell() {
  useEffect(() => {
    document.body.classList.add("marketing")
    return () => document.body.classList.remove("marketing")
  }, [])
}

// The pairings in the draw band are the ones visible in the screenshots below,
// so the page and the shots tell the same story.
const SLIPS = [
  ["AM", "Houston Rockets"],
  ["JB", "Brooklyn Nets"],
  ["PN", "LA Lakers"],
  ["TA", "Milwaukee Bucks"],
  ["NF", "Toronto Raptors"],
  ["SW", "Indiana Pacers"],
]

const COMPETITIONS = [
  "Premier League", "La Liga", "Serie A", "Bundesliga", "Ligue 1", "NBA", "World Cup",
]

const STEPS = [
  ["Pick the competition",
   "Choose a league and season, or a tournament. The sweep binds to it and pulls its own fixtures."],
  ["Send one link",
   "Your group taps it and they're in. No accounts to make, nothing to install."],
  ["Draw the teams",
   "Allocate from the hat once. After that the results, the ladder and the finishing order look after themselves."],
]

export function LandingNav() {
  return (
    <header className="lp-nav">
      <div className="lp-nav-in">
        <a className="lp-brand" href="/">
          <img src="/trophy.png" alt="" width="26" height="26" />
          <span>The Sweep</span>
        </a>
        <nav className="lp-links">
          <a href="/#how">How it works</a>
          <a href="/#inside">Inside a sweep</a>
          <a href="/pricing">Pricing</a>
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
          <img src="/trophy.png" alt="" width="22" height="22" />
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
  return (
    <div data-testid="sweep-landing" className="lp">
      <LandingNav />

      <section className="lp-hero">
        <span className="lp-pill">Football, basketball — any two-team sport</span>
        <h1 className="lp-h1">The sweep your group already runs, minus the admin</h1>
        <p className="lp-lede">
          Everyone draws teams out of the hat. From there the fixtures, the scores,
          the ladder and who's still alive keep themselves up to date — all season,
          from one link.
        </p>
        <div className="lp-hero-cta">
          <a className="lp-btn lp-btn-lg" href="/account">Start free</a>
          <span className="lp-microcopy">14 days free · no card</span>
        </div>

        <figure className="lp-stage">
          <img className="lp-stage-img" src="/marketing/app-teams.webp" width="1400" height="706"
               alt="Every team in the sweep with the person who drew it, eliminated sides greyed out" />
        </figure>
      </section>

      <section className="lp-strip" aria-label="Competitions you can run a sweep on">
        {COMPETITIONS.map((c) => <span className="lp-chip" key={c}>{c}</span>)}
        <span className="lp-chip lp-chip-more">+ more each season</span>
      </section>

      <section className="lp-sec" id="how">
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
            {SLIPS.map(([who, team], i) => (
              <span className="lp-slip" key={team} style={{ "--i": i }}>
                <b>{who}</b>{team}
              </span>
            ))}
          </div>
          <p className="lp-draw-cap">A draw is ten people, thirty teams, one afternoon.</p>
        </div>
      </section>

      <section className="lp-sec" id="inside">
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

          <article className="lp-tile lp-tile-plain">
            <div className="lp-tile-copy">
              <h3 className="lp-tile-h">Wagering, only if you want it</h3>
              <p className="lp-tile-b">
                Switch it on and everyone gets play money for head-to-head, totals and
                handicap markets. Switch it off and nobody sees it. No real money, either way.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="lp-final">
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
