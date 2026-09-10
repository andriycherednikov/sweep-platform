/* ============================================================
   THE SWEEP — account home: my-sweeps + billing (SaaS front door)
   Header-token auth via accountClient; mounted OUTSIDE SweepProvider,
   same standalone pattern as screens-super.jsx.
   ============================================================ */
import { useState, useEffect, useCallback, useRef } from "react";
import { useMarketingShell } from "./screens-landing.jsx";
import {
  getAccount, getBilling, getAccountSweeps,
  startCheckout, openPortal, clearAccountToken, revokeSession, revokeAllSessions,
  patchAccount, requestEmailChange, confirmEmailChange,
} from "./lib/accountClient.js";

const DAY_MS = 86400000;
// Where the rail stops being an index and starts being a scroll. Past this it hands
// over to the full list rather than growing without limit.
const RAIL_MAX = 6;

export function goTo(url) { window.location.assign(url); }

/** The account console shell: a dark rail carrying the brand and where you are,
 *  a light pane carrying the work. Every signed-in page outside a sweep uses it. */
/** Initials from a name, or from the address when nobody has told us a name yet. */
function initialsOf(name, email) {
  const src = (name || "").trim();
  if (src) return src.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??";
  return (email || "?").slice(0, 2).toUpperCase();
}

/** The gear beside your name in the console rail. Deliberately its own small component
 *  rather than the sweep app's: the console mounts standalone, and importing
 *  components.jsx would drag the whole sweep bundle in behind it.
 *
 *  No role="menu"/role="menuitem" here, on purpose. That pair is a contract — focus into
 *  the menu on open, arrow keys between the items, Escape back to the trigger — and this
 *  implements none of it, so claiming it told a screen reader to expect keys that do
 *  nothing. What the markup actually is, is a disclosure button and three buttons, and
 *  that is what it now says it is: Tab reaches them, Enter presses them, and
 *  aria-expanded reports the state. The roles come back the day the key handling does. */
function AccountMenu({ onSettings, onSignOut, onSignOutAll }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const items = [
    { key: "settings", label: "Account settings", onClick: onSettings },
    { key: "out", label: "Log out", onClick: onSignOut },
    // Revokes a credential that grants admin over every sweep the account owns, so it
    // says which one it is rather than sitting unlabelled next to the other.
    { key: "all", label: "Log out everywhere", onClick: onSignOutAll, danger: true },
  ];
  return (
    <div className="ac-menu" ref={boxRef}>
      <button className="ac-me-out" aria-label="Settings" title="Settings"
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 0 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/></svg>
      </button>
      {open && (
        <div className="ac-menu-pop">
          {items.map((it) => (
            <button key={it.key}
              className={"ac-menu-i" + (it.danger ? " is-danger" : "")}
              onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The console's rail is its index, so `here` names the nav item you are standing on:
 *  "home" for /account, "sweeps" for the full list, a SWEEP ID for that sweep's own
 *  page, "new" for the catalog. Anything else (settings, the email-change landing)
 *  simply matches nothing, and the rail shows no active item. */
export function Console({ here, wide, children }) {
  useMarketingShell();
  // Who you are, in the rail, the same as inside a sweep — the console knew your
  // account and greeted you with two unlabelled sign-out buttons.
  const [who, setWho] = useState(null);
  const [sweeps, setSweeps] = useState([]);
  // What the phone picker is pointing at, which is not where you are until you say Go.
  const [pick, setPick] = useState("");
  useEffect(() => {
    let alive = true;
    getAccount().then((a) => { if (alive) setWho(a); }).catch(() => {});
    // The same promise the page inside {children} reads — see getAccountSweeps. A rail
    // that cannot load its list just has nothing in it: the page beside it is what
    // reports a failure, and saying so twice on one screen helps nobody.
    getAccountSweeps().then((s) => { if (alive) setSweeps(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Two filters the API does not do for us. The owned half of GET /api/account/sweeps
  // carries no archived filter server-side, so a sweep you archived does come back here;
  // and the route has no ORDER BY at all, so without a sort of our own Postgres is free
  // to reshuffle the rail between two loads of the same page.
  const live = sweeps.filter((s) => !s.archivedAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const owned = live.filter((s) => s.role !== "member");
  const joined = live.filter((s) => s.role === "member");

  // A real <a>, not a button with an onClick: cmd-click, middle-click, "copy link
  // address" and the keyboard all work without being implemented. The nav key doubles
  // as the React key, which is why sweeps use their own id for it — and why the two
  // overflow items, which lead to the SAME page and so share a nav key, need a React key
  // of their own to stay distinct children of the nav.
  const item = (key, href, label, extra = "", reactKey = key) => (
    <a key={reactKey} className={"ac-nav-i" + extra + (here === key ? " is-here" : "")} href={href}>
      {label}
    </a>
  );

  // The logo is decoration beside a name that already says it, so it is out of the
  // accessible name either way — including the initial block that stands in when the
  // feed gave us no logo.
  const sweepItem = (s, href) => item(s.id, href, (
    <>
      {s.competition?.logo
        ? <img className="ac-nav-logo" src={s.competition.logo} alt="" loading="lazy" />
        : <span className="ac-nav-logo" aria-hidden="true">{(s.name || "?").trim().charAt(0).toUpperCase()}</span>}
      <span className="ac-nav-name">{s.name}</span>
    </>
  ), " is-sweep");

  // Which option the picker below is standing on. Pages with no nav item of their own
  // (settings, the catalog) fall through to a placeholder rather than pointing at Home,
  // which would say you were somewhere you are not.
  const hereHref = here === "home" ? "/account" : owned.some((s) => s.id === here) ? `/account/s/${here}` : "";

  // Best-effort server-side revoke, then forget locally either way: a failed DELETE
  // (offline, already-expired session) must not strand this device signed in.
  async function signOutHere() {
    try { await revokeSession(); } catch { /* ignore */ }
    clearAccountToken();
    window.location.reload();
  }
  // This is the only way to revoke a credential that grants admin over every sweep
  // the account owns, reached for exactly when a device is lost or a token may have
  // leaked — a failure here must not be swallowed like signOutHere's. Still clear
  // locally and leave (staying signed in here would be worse), but land on /account
  // with a flag Entry can show, surviving the reload: other sessions are still live.
  async function signOutEverywhere() {
    let failed = false;
    try { await revokeAllSessions(); } catch { failed = true; }
    clearAccountToken();
    if (failed) window.location.assign("/account?signout=partial");
    else window.location.reload();
  }

  return (
    <div className="lp ac">
      <aside className="ac-side">
        <a className="lp-brand ac-brand" href="/"><span>The Sweep</span></a>
        <nav className="ac-nav">
          {item("home", "/account", "Home")}
          {/* A sweep you run is a place to configure; a sweep you are only in has
              nothing here to configure, so it goes straight into the app. */}
          {owned.length > 0 && <p className="ac-sec">Your sweeps</p>}
          {owned.slice(0, RAIL_MAX).map((s) => sweepItem(s, `/account/s/${s.id}`))}
          {owned.length > RAIL_MAX && item("sweeps", "/account/sweeps", `All ${owned.length} sweeps`, " is-more")}
          {/* Same cap, and this is the half that needed it: you set up a handful of
              sweeps of your own, and you join however many your friends set up. */}
          {joined.length > 0 && <p className="ac-sec">You're in</p>}
          {joined.slice(0, RAIL_MAX).map((s) => sweepItem(s, `/s/${s.id}`))}
          {joined.length > RAIL_MAX && item("sweeps", "/account/sweeps", `All ${joined.length} sweeps you're in`, " is-more", "sweeps-in")}
          {/* At 820px and under the rail lies down into a horizontal strip, which
              survives two items and not twelve. The same places as the platform's own
              picker: no drawer to build, and the keyboard and VoiceOver come free. It
              carries every sweep rather than the first six — a native list scrolls, so
              there is nothing for an overflow item to solve. CSS shows exactly one of
              the two, so the rail is never both. */}
          <select className="ac-pick" aria-label="Go to" value={pick || hereHref}
                  onChange={(e) => setPick(e.target.value)}>
            {!hereHref && <option value="">Go to…</option>}
            <option value="/account">Home</option>
            {owned.length > 0 && (
              <optgroup label="Sweeps you run">
                {owned.map((s) => <option key={s.id} value={`/account/s/${s.id}`}>{s.name}</option>)}
              </optgroup>
            )}
            {joined.length > 0 && (
              <optgroup label="Sweeps you're in">
                {joined.map((s) => <option key={s.id} value={`/s/${s.id}`}>{s.name}</option>)}
              </optgroup>
            )}
          </select>
          {/* Picking is not going. Navigating on change is a change of context on input,
              and where the arrow keys move a closed select it walks you off the page
              before you reach the option you wanted — every choice past the adjacent one
              out of the keyboard's reach. One more tap on a phone, and the only way to
              use this at all with a keyboard. */}
          <button className="ac-ghost ac-pick-go" disabled={!(pick || hereHref)}
                  onClick={() => goTo(pick || hereHref)}>Go</button>
        </nav>
        <div className="ac-side-foot">
          <button className={"lp-btn ac-btn" + (here === "new" ? " is-here" : "")}
                  onClick={() => goTo("/account/new")}>New sweep</button>
          {/* Not behind `who`. Knowing your name is a nice-to-have from a request that
              is allowed to fail quietly here; the gear below it is the app's only
              sign-out and its only route to /account/settings, and a swallowed GET
              /api/account used to take both off the screen. initialsOf already answers
              "?" when it has nothing to go on. */}
          <div className="ac-me">
            <span className="ac-me-av">{initialsOf(who?.name, who?.email)}</span>
            <span className="ac-me-tx">
              <small>Signed in as</small>
              <b>{who?.name || who?.email || "your account"}</b>
            </span>
            {/* Same gear as the sweep's rail: everything you can DO about being signed
                in lives behind it, said out loud, rather than as loose icons. */}
            <AccountMenu
              onSettings={() => goTo("/account/settings")}
              onSignOut={signOutHere}
              onSignOutAll={signOutEverywhere}
            />
          </div>
        </div>
      </aside>
      <main className="ac-main">
        {/* The dashboard's two columns of cards need more room than a settings form
            does, and a form stretched to 980px is worse than one that isn't. */}
        <div className={"ac-col" + (wide ? " is-wide" : "")}>{children}</div>
      </main>
    </div>
  );
}

/** A share link is here to be copied, so the copy sits on the field itself.
 *  The input stays a real input — selecting the text by hand still works, and
 *  clipboard access is not a given in every browser or embedded webview. */
export function LinkField({ label, value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* no clipboard: the field is still selectable */ }
  }

  return (
    <label className="ac-link">
      <span className="ac-link-l">{label}</span>
      <span className="ac-link-row">
        <input readOnly value={value} onFocus={(e) => e.target.select()} onClick={(e) => e.target.select()} />
        <button type="button" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </span>
    </label>
  );
}

/** Billing is one account-level subscription priced per running sweep, so the
 *  state is shared: the sweep cards show what it means for that sweep, the
 *  panel speaks for the account before the first sweep exists. */
function useBilling(billing) {
  const now = Date.now();
  const trialEndsMs = billing.trialEndsAt ? new Date(billing.trialEndsAt).getTime() : null;
  return {
    fresh: !billing.subscribed && !trialEndsMs,
    trialing: !billing.subscribed && trialEndsMs && trialEndsMs > now,
    lapsed: !billing.subscribed && trialEndsMs && trialEndsMs <= now,
    daysLeft: trialEndsMs ? Math.ceil((trialEndsMs - now) / DAY_MS) : 0,
    stopping: !!(billing.subscribed && billing.cancelAtPeriodEnd),
    endsOn: billing.currentPeriodEnd ? fmtDay(billing.currentPeriodEnd) : null,
  };
}

/** "12 Sep 2026" — the only thing an owner actually wants after cancelling. */
export function fmtDay(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : null;
}

function useBillingActions() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function subscribe() {
    setBusy(true); setErr(false);
    try { goTo((await startCheckout()).url); }
    catch (e) {
      if (e.code === "already_subscribed") {
        try { goTo((await openPortal()).url); } catch { setErr(true); }
      } else setErr(true);
    } finally { setBusy(false); }
  }

  async function manage(flow) {
    setBusy(true); setErr(false);
    try { goTo((await openPortal(flow)).url); }
    catch (e) {
      if (e.code === "not_subscribed") {
        try { goTo((await startCheckout()).url); } catch { setErr(true); }
      } else setErr(true);
    } finally { setBusy(false); }
  }

  return { busy, err, subscribe, manage };
}

/** Account-level billing, shown while there is no sweep to hang it off. */
function BillingPanel({ billing }) {
  const { fresh, trialing, lapsed, daysLeft } = useBilling(billing);
  const { busy, err, subscribe, manage } = useBillingActions();
  const state = billing.subscribed ? "Subscribed" : trialing ? "Trial" : lapsed ? "Trial ended" : "Not started";

  return (
    <section className="ac-card">
      <div className="ac-card-top">
        <div>
          <h2 className="ac-card-h">The Sweep subscription</h2>
          <p className="ac-price">$5<span>/month per running sweep</span></p>
        </div>
        <span className={"ac-pill" + (lapsed || billing.subscriptionStatus === "past_due" ? " is-warn" : "")}>{state}</span>
      </div>

      {fresh && <p className="ac-b">Your 14-day free trial starts with your first sweep.</p>}

      {trialing && (
        <>
          <p className="ac-b">{daysLeft} day{daysLeft === 1 ? "" : "s"} left in your free trial.</p>
          <button className="lp-btn ac-btn" disabled={busy} onClick={subscribe}>Subscribe</button>
        </>
      )}

      {lapsed && (
        <>
          <p className="ac-warn">Your trial has ended — sweeps are read-only until you subscribe.</p>
          <button className="lp-btn ac-btn" disabled={busy} onClick={subscribe}>Subscribe</button>
        </>
      )}

      {billing.subscribed && (
        <>
          <p className="ac-b">{billing.liveSweeps} live sweep{billing.liveSweeps === 1 ? "" : "s"}</p>
          {billing.subscriptionStatus === "past_due" && (
            <p className="ac-warn">Your last payment failed — update your card to avoid losing access.</p>
          )}
          <button className="ac-ghost" disabled={busy} onClick={() => manage()}>Manage billing</button>
        </>
      )}

      {err && <p className="ac-warn">Something went wrong. Try again.</p>}
    </section>
  );
}

/** The same panel, on the console's front page, and only when the account has something
 *  to do about its bill.
 *
 *  /account used to BE the list, which is where billing lives. It is the dashboard now,
 *  and the dashboard reads no billing at all — yet the read-only warning on a sweep's
 *  page, the catalog's "Go to billing" and every "Back to my account" out of Stripe
 *  still land here. A lapsed owner following the warning arrived at a page of charts
 *  with no way to pay.
 *
 *  One panel for the account, not one per sweep, and quiet when the bill is healthy: a
 *  paid-up subscriber does not need an invoice on the page that exists to be fun, and
 *  the header beside this already carries a link to the list where the controls are. */
export function BillingNotice() {
  const [billing, setBilling] = useState(null);
  // Its own request. The dashboard's two loads have their own fates and this is a third:
  // a billing call that falls over must not cost anyone their charts, so it says nothing.
  useEffect(() => {
    let alive = true;
    getBilling().then((b) => { if (alive) setBilling(b); }, () => {});
    return () => { alive = false; };
  }, []);

  // Read unconditionally — an early return above this would make the call order depend
  // on whether the request has landed.
  const { trialing, lapsed } = useBilling(billing ?? {});
  if (!billing) return null;
  if (!trialing && !lapsed && billing.subscriptionStatus !== "past_due") return null;

  return <div style={{ margin: "0 0 22px" }}><BillingPanel billing={billing} /></div>;
}

/** What the sweep follows. The name is whatever the owner typed — "Office Pool" says
 *  nothing — so this is the line that makes a list of sweeps readable at a glance. */
export function CompetitionLine({ s, note }) {
  const c = s.competition;
  if (!c && !note) return null;
  return (
    <p className="ac-comp">
      {c?.logo && <img className="ac-comp-logo" src={c.logo} alt="" loading="lazy" />}
      {c && <span className="ac-comp-name">{c.name}</span>}
      {c && <span className="ac-comp-sport">{c.sport}</span>}
      {note && <span className="ac-comp-note">{note}</span>}
    </p>
  );
}

/** A sweep you run, as one row of a list. Every control it used to carry — the member
 *  link, Replace link, Archive, the deep-link into the roster — now lives on the
 *  sweep's own page, which is the point of that page: a list of twelve sweeps was
 *  twelve copies of the same six buttons and nowhere to actually configure anything.
 *  What is left is what a list is for: which sweep this is, how many people are in it,
 *  what it costs, and the two ways onward.
 *
 *  The pill and nothing else, on the billing side. The state it names is genuinely per
 *  sweep — this one is paid, that one is read-only — but the SUBSCRIPTION behind it is
 *  one per account, priced by how many sweeps you run, so the row's own Manage billing
 *  and Cancel were twelve buttons all working the same one subscription: pressing
 *  Cancel on any card stopped every sweep on the page. The controls live once, in the
 *  panel above this list. */
function SweepRow({ s, billing }) {
  const { trialing, lapsed, daysLeft, stopping, endsOn } = useBilling(billing);

  const tier = stopping
    ? { label: endsOn ? `Paid · stops ${endsOn}` : "Paid · stops at period end", tone: " is-warn" }
    : billing.subscribed
    ? { label: "Paid", tone: "" }
    : trialing
      ? { label: `Free trial · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`, tone: "" }
      : lapsed
        ? { label: "Read-only", tone: " is-warn" }
        : { label: "Free", tone: "" };

  return (
    <section className="ac-card">
      <div className="ac-card-top">
        {/* The card still carries the billing controls, so it cannot be one big link the
            way a member row is — the name opens the sweep, and Settings is the way to
            everything the card used to hold. */}
        <div className="ac-card-id">
          <h3 className="ac-card-h"><a className="ac-open-name" href={`/s/${s.id}`}>{s.name}</a></h3>
          <CompetitionLine s={s} />
        </div>
        <div className="ac-card-acts">
          <a className="ac-ghost" href={`/account/s/${s.id}`}>Settings</a>
          <a className="ac-open" href={`/s/${s.id}`} aria-label={`Open ${s.name}`} title="Open">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </a>
        </div>
      </div>
      {/* who is actually in there — the question this screen could not answer */}
      {s.members && (
        <p className="ac-b">
          {s.members.total} in the sweep
          {s.members.total > s.members.registered
            ? ` · ${s.members.total - s.members.registered} not joined yet`
            : ""}
        </p>
      )}
      <div className="ac-tier">
        <span className={"ac-pill" + tier.tone}>{tier.label}</span>
      </div>
    </section>
  );
}

/** A sweep you are simply in. No link to hand out, no billing, nothing to archive —
 *  those are the owner's. Just a way back into it. */
function MemberRow({ s }) {
  return (
    /* The whole card is the link — there is one thing to do with a sweep you only play
       in, so a target the size of the row beats a 36px chevron. An <a> rather than an
       onClick keeps middle-click, cmd-click and the keyboard working for free. */
    <a className="ac-card ac-row ac-rowlink" href={`/s/${s.id}`}>
      <div className="ac-card-id">
        <h3 className="ac-card-h">{s.name}</h3>
        {/* "Member" carries what the paragraph used to say: the billing and the roster
            are the owner's. It rides in the meta line so the row stays one line tall. */}
        <CompetitionLine s={s} note="Member" />
      </div>
      <span className="ac-open" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
      </span>
    </a>
  );
}

/** The same dead end from two directions: an account with no sweeps has nothing to list
 *  and nothing to chart, and in both places the answer is the one button. */
export function NoSweepsYet() {
  return (
    <section className="ac-card ac-empty">
      <h3 className="ac-card-h">No sweeps yet</h3>
      <p className="ac-b">Pick a competition and spin one up — the fixtures come with it.</p>
      <button className="lp-btn ac-btn" onClick={() => goTo("/account/new")}>Set up your first sweep</button>
    </section>
  );
}

function SweepList({ sweeps, billing }) {
  const active = sweeps.filter((s) => !s.archivedAt);
  const owned = active.filter((s) => s.role !== "member");
  const joined = active.filter((s) => s.role === "member");

  if (active.length === 0) return <NoSweepsYet />;

  return (
    <>
      {/* Only label the groups when there are two of them — a heading over a single
          list is noise, and most people will only ever have one kind. */}
      {owned.length > 0 && joined.length > 0 && <h2 className="ac-group">Sweeps you run</h2>}
      {owned.map((s) => <SweepRow key={s.id} s={s} billing={billing} />)}
      {joined.length > 0 && owned.length > 0 && <h2 className="ac-group">Sweeps you're in</h2>}
      {joined.map((s) => <MemberRow key={s.id} s={s} />)}
      {/* Last, not first: somebody who already plays in a sweep came here to find it,
          not to be told what they haven't done. */}
      {owned.length === 0 && (
        <section className="ac-card ac-row">
          <div className="ac-card-id">
            <h3 className="ac-card-h">You don't run one yet</h3>
            <p className="ac-b" style={{ margin: "4px 0 0" }}>Pick a competition and spin one up — the fixtures come with it.</p>
          </div>
          <button className="lp-btn ac-row-btn" onClick={() => goTo("/account/new")}>Set up your first sweep</button>
        </section>
      )}
    </>
  );
}

/** `here` because this same list answers on two addresses: /account, and /account/sweeps
 *  which is where the rail sends you once you run more sweeps than it will list. */
export function AccountHome({ here = "home" }) {
  const [billing, setBilling] = useState(null);
  const [sweeps, setSweeps] = useState([]);
  const [loadErr, setLoadErr] = useState(false);

  // No `fresh` here: nothing on this page changes the list any more — archiving and
  // rotating moved to the sweep's own page, and both leave by a real navigation.
  const reload = useCallback(async () => {
    setLoadErr(false);
    try {
      const [b, s] = await Promise.all([getBilling(), getAccountSweeps()]);
      setBilling(b); setSweeps(s);
    } catch { setLoadErr(true); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    // A list of cards, so it takes the pane's width the way the dashboard does.
    <Console here={here} wide>
      <p className="lp-eyebrow">My account</p>
      <h1 className="ac-h1">Your sweeps</h1>
      <p className="ac-sub">Sign in on any device you own it from — admin follows your account, not a link.</p>
      {loadErr && <p className="ac-warn">Something went wrong. Try again.</p>}
      <div className="ac-stack">
        {/* First, full width, and whether or not any sweep exists. This is the page every
            "subscribe" and "go to billing" link in the app lands on, and the one
            subscription it speaks for is what decides whether the sweeps under it are
            live or read-only — so it reads as the heading for the list, not a footnote
            after it, and it is outside the list's own grid because it speaks for the
            account rather than for any one sweep. */}
        {billing && <BillingPanel billing={billing} />}
        {billing && <div className="ac-list"><SweepList sweeps={sweeps} billing={billing} /></div>}
      </div>
    </Console>
  );
}

/* ---------------- ACCOUNT SETTINGS ---------------- */
/** The account itself: the name it greets you by, and the address it signs you in with.
 *  Two very different things, so they are two panels and only one of them is instant. */
export function AccountSettings() {
  const [who, setWho] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  useEffect(() => {
    getAccount().then(setWho).catch(() => setLoadErr(true));
  }, []);

  return (
    <Console here="settings">
      <p className="lp-eyebrow">My account</p>
      <h1 className="ac-h1">Account settings</h1>
      <p className="ac-sub">Your name is what the group sees. Your email is how you sign in.</p>
      {loadErr && <p className="ac-warn">Couldn't load your account. Reload the page.</p>}
      {who && (
        <div className="ac-stack">
          <NamePanel who={who} onSaved={(name) => setWho((w) => ({ ...w, name }))} />
          <EmailPanel who={who} />
        </div>
      )}
    </Console>
  );
}

function NamePanel({ who, onSaved }) {
  const [name, setName] = useState(who.name || "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(false);
  const dirty = name.trim() && name.trim() !== (who.name || "");

  async function save() {
    setBusy(true); setErr(false); setDone(false);
    try { const a = await patchAccount({ name: name.trim() }); onSaved(a.name); setDone(true); }
    catch { setErr(true); }
    finally { setBusy(false); }
  }

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Your name</h2>
      <p className="ac-b">However you want to be listed. You can change it whenever.</p>
      <label className="ac-label" htmlFor="ac-name">Name</label>
      <input id="ac-name" className="ac-input" value={name} maxLength={80}
        placeholder="e.g. Macca McCallum" onChange={(e) => { setName(e.target.value); setDone(false); }} />
      <button className="ac-ghost" style={{ marginTop: 12 }} disabled={busy || !dirty} onClick={save}>
        {busy ? "Saving…" : "Save name"}
      </button>
      {done && <p className="ac-b">Saved.</p>}
      {err && <p className="ac-warn">Couldn't save that. Try again.</p>}
    </section>
  );
}

function EmailPanel({ who }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [err, setErr] = useState(null);
  const next = email.trim().toLowerCase();
  const ready = /^\S+@\S+\.\S+$/.test(next) && next !== who.email;

  async function send() {
    setBusy(true); setErr(null); setSent(null);
    try { await requestEmailChange(next); setSent(next); setEmail(""); }
    catch (e) {
      setErr(e.code === "email_taken"
        ? "That address already belongs to another account."
        : "Couldn't send the link. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <section className="ac-card">
      <h2 className="ac-card-h">Your email</h2>
      <p className="ac-b">
        You sign in with <b>{who.email}</b>. Changing it takes a moment: we send a link to
        the new address, and nothing moves until you open it — so an address you can't
        read can't take your account.
      </p>
      <label className="ac-label" htmlFor="ac-email">New email</label>
      <input id="ac-email" className="ac-input" type="email" value={email} maxLength={254}
        placeholder="you@example.com" onChange={(e) => { setEmail(e.target.value); setErr(null); }} />
      <button className="ac-ghost" style={{ marginTop: 12 }} disabled={busy || !ready} onClick={send}>
        {busy ? "Sending…" : "Send the link"}
      </button>
      {sent && <p className="ac-b">Link sent to <b>{sent}</b>. Open it there to finish the change.</p>}
      {err && <p className="ac-warn">{err}</p>}
    </section>
  );
}

/** Landing spot for the link in the new address's inbox. */
export function ConfirmEmailChange({ token }) {
  const [state, setState] = useState("working");
  const [email, setEmail] = useState(null);
  useEffect(() => {
    confirmEmailChange(token).then(
      (a) => { setEmail(a.email); setState("done"); },
      (e) => setState(e.code === "email_taken" ? "taken" : "bad"),
    );
  }, [token]);

  const copy = {
    working: { h: "Confirming…", p: "One moment." },
    done: { h: "Address changed", p: `You sign in with ${email} from now on.` },
    taken: { h: "That address is taken", p: "Another account already uses it, so nothing changed." },
    bad: { h: "That link didn't work", p: "It may have been used already or expired. Ask for a fresh one from your account settings." },
  }[state];

  return (
    <Console here="settings">
      <p className="lp-eyebrow">My account</p>
      <h1 className="ac-h1">{copy.h}</h1>
      <p className="ac-sub">{copy.p}</p>
      {state !== "working" && (
        <button className="lp-btn ac-btn" onClick={() => goTo("/account/settings")}>Back to settings</button>
      )}
    </Console>
  );
}
