/* ============================================================
   THE SWEEP — /pricing. Kept off the front page on purpose: the
   landing sells the ritual, this page answers "what does it cost".
   ============================================================ */
import { LandingNav, LandingFoot, useMarketingShell } from "./screens-landing.jsx"

const INCLUDED = [
  "One competition — a league season or a tournament",
  "As many people in the sweep as you like",
  "Fixtures, scores, tables and finishing order synced for you",
  "Draw-from-the-hat allocation and an admin console",
  "Optional play-money wagering, off by default",
  "Photos, reactions and live updates during matches",
]

const QA = [
  ["What counts as one sweep?",
   "One group following one competition. Run a Premier League sweep and an NBA sweep and that's two."],
  ["What happens after the free two weeks?",
   "Add a card and the sweep keeps running. Don't, and it goes read-only — the data stays exactly where it is until you come back."],
  ["Can I cancel?",
   "Any time, from your account. You keep the sweep until the period you've paid for ends."],
  ["Do the people in my sweep pay?",
   "No. They open a link. The only account on the whole thing is yours."],
]

export function Pricing() {
  useMarketingShell()
  return (
    <div data-testid="pricing" className="lp">
      <LandingNav />

      <section className="lp-hero lp-hero-tight">
        <p className="lp-kicker">Pricing</p>
        <h1 className="lp-h1 lp-h1-sm">One price, per sweep, per month</h1>
        <p className="lp-lede">
          Start with two weeks free and no card. Keep it running for the price of a
          coffee — however many people you bring in.
        </p>
      </section>

      <section className="lp-plan">
        <div className="lp-plan-card">
          <p className="lp-plan-n">$5<span>/month</span></p>
          <p className="lp-plan-sub">per running sweep · billed monthly · cancel any time</p>
          <a className="lp-btn lp-btn-lg" href="/account">Start free</a>
          <ul className="lp-plan-list">
            {INCLUDED.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </section>

      <section className="lp-sec">
        <p className="lp-eyebrow">Questions</p>
        <div className="lp-qa">
          {QA.map(([q, a]) => (
            <article className="lp-qa-item" key={q}>
              <h3 className="lp-card-h">{q}</h3>
              <p className="lp-card-b">{a}</p>
            </article>
          ))}
        </div>
      </section>

      <LandingFoot />
    </div>
  )
}
