/* ============================================================
   THE SWEEP — logged-out front door (platform host).

   Continuous with the app's field (navy + vermilion, Barlow
   Condensed) so the product and its pitch are obviously the same
   thing. The one bold element is the DRAW BAND: warm paper slips
   with a typed owner→team pairing, the artifact this whole product
   is built around. Everything else stays quiet.
   ============================================================ */

// A real allocation reads better than invented pairings — these are the
// ones in the screenshots below, so the page and the shots agree.
const SLIPS = [
  ["AM", "Houston Rockets"],
  ["JB", "Brooklyn Nets"],
  ["PN", "LA Lakers"],
  ["TA", "Milwaukee Bucks"],
  ["NF", "Toronto Raptors"],
  ["SW", "Indiana Pacers"],
]

const STEPS = [
  ["Pick the competition",
   "Premier League, La Liga, Serie A, Bundesliga, Ligue 1, the NBA or the World Cup — league or knockout, we handle both."],
  ["Send one link",
   "Your group taps the link and they're in. No accounts to make, nothing to install."],
  ["Draw the teams, then leave it",
   "Allocate from the hat and that's your job done. Fixtures, results, the ladder and the finishing order keep themselves up to date."],
]

const SHOTS = [
  ["/marketing/app-people.webp", "The sweep leaderboard sorted by team wins",
   "Who's actually winning",
   "Sorted by wins, predictions or finishing order, and it marks who's mathematically out. Settles the argument before it starts."],
  ["/marketing/app-standings.webp", "League tables grouped by conference",
   "The ladder, kept for you",
   "Real tables off the live feed — conferences, groups, goal difference, percentage, whatever that sport counts."],
  ["/marketing/app-today.webp", "Match day view showing the next game and both teams' owners",
   "Every game has a name on it",
   "Each fixture shows whose team is playing, so a Tuesday night game somebody would otherwise ignore turns into a group chat."],
]

export function Landing() {
  return (
    <div data-testid="sweep-landing" className="lp">
      <header className="lp-top">
        <div className="lp-word">
          <img src="/trophy.png" alt="" width="30" height="30" />
          <b>The Sweep</b>
        </div>
        <a className="lp-signin" href="/account">Sign in</a>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <p className="lp-eyebrow">Sweeps, for any season</p>
          <h1 className="lp-h1">Run the sweep,<br />not the spreadsheet</h1>
          <p className="lp-lede">
            Everyone draws teams out of the hat. From there the fixtures, the
            scores, the ladder and who's still alive all look after themselves —
            for a whole season, in one link.
          </p>
          <div className="lp-actions">
            <a className="lp-cta" href="/account">Start free</a>
            <span className="lp-note">14 days free, no card.<br />$5 a month per sweep after that.</span>
          </div>
        </div>
        <div className="lp-shot lp-shot-hero">
          <img src="/marketing/app-teams.webp" width="1400" height="706"
               alt="The Sweep showing every NBA team with the person who drew it, eliminated sides greyed out" />
        </div>
      </section>

      {/* signature: the draw itself — folded slips, owner initials, typed team */}
      <section className="lp-draw" aria-label="An example draw">
        <div className="lp-draw-rail">
          {SLIPS.map(([who, team], i) => (
            <span className="lp-slip" key={team} style={{ "--i": i }}>
              <b>{who}</b>{team}
            </span>
          ))}
        </div>
        <p className="lp-draw-cap">Ten people, thirty teams, one afternoon.</p>
      </section>

      <section className="lp-steps">
        {STEPS.map(([head, body], i) => (
          <article className="lp-step" key={head}>
            <span className="lp-step-n">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="lp-step-h">{head}</h2>
            <p className="lp-step-b">{body}</p>
          </article>
        ))}
      </section>

      {SHOTS.map(([src, alt, head, body], i) => (
        <section className={"lp-feat" + (i % 2 ? " lp-feat-flip" : "")} key={src}>
          <div className="lp-feat-copy">
            <h2 className="lp-feat-h">{head}</h2>
            <p className="lp-feat-b">{body}</p>
          </div>
          <div className="lp-shot">
            <img src={src} alt={alt} loading="lazy" />
          </div>
        </section>
      ))}

      <section className="lp-extra">
        <div className="lp-extra-card">
        <h2 className="lp-feat-h">Wagering, only if your group wants it</h2>
        <p className="lp-feat-b">
          Switch it on and everyone gets play money to bet on the matches — head
          to head, totals, the handicap. Switch it off and nobody sees it. No real
          money changes hands either way.
        </p>
        </div>
      </section>

      <section className="lp-price">
        <p className="lp-price-n">$5<span>/month</span></p>
        <p className="lp-price-b">
          Per sweep, however many people you invite. Two weeks free to try it,
          cancel from your account whenever you like.
        </p>
        <a className="lp-cta" href="/account">Start free</a>
      </section>

      <footer className="lp-foot">
        <p>Been sent an invite link? Just open it — joining a sweep needs no account.</p>
        <p className="lp-foot-sub">
          Running one already? <a href="/account">Sign in</a>
        </p>
      </footer>
    </div>
  )
}
