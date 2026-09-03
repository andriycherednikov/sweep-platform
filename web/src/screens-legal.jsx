/* ============================================================
   THE SWEEP — /terms and /privacy. Stripe wants both before it
   will activate live mode, and a product that takes card details
   and stores photos of people needs them regardless.

   The facts here are read off the actual schema and code, not
   copied from a template: what we store is what api/src/db/schema.js
   stores. Anything marked OWNER is a detail only the operator can
   supply — legal entity, contact address, jurisdiction, retention.
   Fill those in before this goes anywhere near live mode.
   ============================================================ */
import { LandingNav, LandingFoot, useMarketingShell } from "./screens-landing.jsx"

// OWNER: replace all four before live mode. They are deliberately loud.
export const OPERATOR = "[OWNER: registered entity or trading name]"
export const CONTACT = "[OWNER: contact email]"
export const JURISDICTION = "[OWNER: state/territory], Australia"
export const UPDATED = "September 2026"

function LegalPage({ testid, kicker, title, lede, children }) {
  useMarketingShell()
  return (
    <div data-testid={testid} className="lp">
      <LandingNav />
      <section className="lp-hero lp-hero-tight">
        <p className="lp-kicker">{kicker}</p>
        <h1 className="lp-h1 lp-h1-sm">{title}</h1>
        <p className="lp-lede">{lede}</p>
      </section>
      <section className="lp-sec">
        <div className="lp-qa">{children}</div>
        <p className="lp-card-b" style={{ marginTop: "2rem", opacity: 0.7 }}>
          Last updated {UPDATED}. Questions about any of this: {CONTACT}.
        </p>
      </section>
      <LandingFoot />
    </div>
  )
}

const Clause = ({ h, children }) => (
  <article className="lp-qa-item">
    <h3 className="lp-card-h">{h}</h3>
    <p className="lp-card-b">{children}</p>
  </article>
)

export function Terms() {
  return (
    <LegalPage
      testid="terms" kicker="Terms" title="Terms of use"
      lede="Plain English, because the whole product is one group of friends and a competition."
    >
      <Clause h="Who you are agreeing with">
        The Sweep is operated by {OPERATOR}. These terms cover the site, the app and
        anything you run through them. Using it means you accept them.
      </Clause>
      <Clause h="What you get">
        A subscription runs one sweep: one group following one competition. It costs $5
        per month per running sweep, billed monthly, starting after a two-week trial
        that needs no card. You can cancel at any time from your account; the sweep
        keeps running until the period you have already paid for ends.
      </Clause>
      <Clause h="What happens if you stop paying">
        The sweep goes read-only. Nothing is deleted — the draw, the results and the
        history stay exactly where they are, and start updating again when you come
        back. We do not sell or repurpose a lapsed sweep's data.
      </Clause>
      <Clause h="The people in your sweep">
        They open a link; they do not need an account and they are never charged. If
        you are the person who set the sweep up, you are the one responsible for who
        you invite, for the names and photos that end up in it, and for having the say
        of anyone whose photo you upload. Photos are reviewed before they appear.
      </Clause>
      <Clause h="Wagering is play money">
        The optional wagering feature uses points with no cash value. Nothing can be
        bought with them, nothing can be cashed out, and there is no prize funded by
        us. It is off by default and can be turned off for the whole sweep. A sweep
        admin can mark anyone under 18 so the feature is closed to them, and anyone can
        self-exclude — an exclusion can be extended but never shortened.
      </Clause>
      <Clause h="Scores come from a third party">
        Fixtures, scores and tables come from an external sports data provider. We show
        what they send. They get things wrong sometimes, and their terms give us no
        remedy when they do. If a wrong result settles something in your sweep, tell us
        and we will correct it by hand — but we cannot promise the feed is perfect, and
        nothing in your sweep should be treated as an official record of a match.
      </Clause>
      <Clause h="Interruptions">
        This is a small service. It will occasionally be down, and the data feed will
        occasionally be late or stop. We will not owe you anything beyond a refund of
        the part of the month you could not use.
      </Clause>
      <Clause h="Things you should not do">
        Do not upload anything you do not have the right to upload, anything of a child
        that their parent has not agreed to, or anything abusive. Do not resell access,
        scrape the sports data out of the product, or try to reach another group's
        sweep. We can close a sweep that is being used this way.
      </Clause>
      <Clause h="Ending it">
        You can stop at any time. We can stop too, and if we do while you have paid for
        time you have not used, you get that part back. Team names and club crests
        belong to their owners and are shown to identify the teams, nothing more.
      </Clause>
      <Clause h="Which law">
        These terms are governed by the law of {JURISDICTION}. Nothing here removes any
        right you have under the Australian Consumer Law.
      </Clause>
    </LegalPage>
  )
}

export function Privacy() {
  return (
    <LegalPage
      testid="privacy" kicker="Privacy" title="What we hold, and why"
      lede="A short and specific list, not a template. If it is not here, we do not store it."
    >
      <Clause h="If you run a sweep">
        Your email address, and a name if you give one. The email is how you sign in —
        we send a link rather than keeping a password, so there is no password here to
        lose. Alongside it we keep your Stripe customer and subscription identifiers,
        your subscription status and renewal date, and when your trial ends.
      </Clause>
      <Clause h="If you are in someone's sweep">
        A display name, initials and a colour; a photo if one is uploaded for you; which
        team you drew; your predictions and, where wagering is on, your play-money
        wagers. A sweep admin can flag that you are under 18, which closes wagering to
        you, and can record a self-exclusion date. You do not have an account and we do
        not hold an email address for you.
      </Clause>
      <Clause h="Payments">
        Card details never reach our servers. Stripe takes the payment and we keep only
        the identifiers and the status they hand back. Their privacy terms cover what
        they do with the card itself.
      </Clause>
      <Clause h="Photos">
        Uploaded photos are stored on our own server, stripped of their EXIF metadata
        (which includes location) when they are processed, and held for review before
        anyone else can see them. A sweep admin can reject or remove any of them.
      </Clause>
      <Clause h="Cookies">
        Two, both functional, neither for advertising: a signed cookie that remembers
        which sweep you are looking at and whether you are its admin, and a sign-in
        token for account holders. No third-party advertising or tracking cookies are
        set. Analytics are currently switched off entirely; if that changes, this page
        changes with it.
      </Clause>
      <Clause h="Who else sees it">
        Nobody it is not needed by: Stripe for payments, our email sender for sign-in
        links, and the hosting provider the server runs on. The sports data provider
        sends us data and receives nothing about you. We do not sell anything to
        anyone, and we do not use your sweep to train anything.
      </Clause>
      <Clause h="How long">
        Your account and sweeps stay until you ask us to remove them — a lapsed sweep is
        kept read-only, not deleted, so it is still there if you come back.
        Sign-in links expire shortly after they are sent. OWNER: state a retention
        period for photos and for closed accounts before this goes live.
      </Clause>
      <Clause h="Asking for a copy, or deletion">
        Write to {CONTACT} and we will send you what we hold, correct it, or delete it.
        If you are in someone else's sweep and want your name or photo out of it, you
        can ask the person who runs it or ask us directly. There is no self-service
        delete button yet; the request goes to a human.
      </Clause>
      <Clause h="Where it lives">
        On a server in {JURISDICTION}, plus Stripe and our email sender, who operate
        internationally. Contact for anything on this page: {CONTACT}.
      </Clause>
    </LegalPage>
  )
}
