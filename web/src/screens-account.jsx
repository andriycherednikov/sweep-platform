/* ============================================================
   THE SWEEP — account home: my-sweeps + billing (SaaS front door)
   Header-token auth via accountClient; mounted OUTSIDE SweepProvider,
   same standalone pattern as screens-super.jsx.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { useMarketingShell } from "./screens-landing.jsx";
import {
  getAccount, getBilling, getAccountSweeps, archiveSweep, rotateSweep,
  startCheckout, openPortal, clearAccountToken, revokeSession, revokeAllSessions,
} from "./lib/accountClient.js";

const DAY_MS = 86400000;

export function goTo(url) { window.location.assign(url); }

/** The account console shell: a dark rail carrying the brand and where you are,
 *  a light pane carrying the work. Every signed-in page outside a sweep uses it. */
/** Initials from a name, or from the address when nobody has told us a name yet. */
function initialsOf(name, email) {
  const src = (name || "").trim();
  if (src) return src.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "??";
  return (email || "?").slice(0, 2).toUpperCase();
}

export function Console({ here, children }) {
  useMarketingShell();
  // Who you are, in the rail, the same as inside a sweep — the console knew your
  // account and greeted you with two unlabelled sign-out buttons.
  const [who, setWho] = useState(null);
  useEffect(() => {
    let alive = true;
    getAccount().then((a) => { if (alive) setWho(a); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const item = (key, label, badge) => (
    <button
      className={"ac-nav-i" + (here === key ? " is-here" : "") + (key === "new" ? " is-go" : "")}
      onClick={() => goTo(key === "sweeps" ? "/account" : "/account/new")}
    >
      {label}{badge !== undefined && <span>{badge}</span>}
    </button>
  );

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
          {item("sweeps", "Sweeps")}
        </nav>
        <div className="ac-side-foot">
          <button className={"lp-btn ac-btn" + (here === "new" ? " is-here" : "")}
                  onClick={() => goTo("/account/new")}>New sweep</button>
          {who && (
            <div className="ac-me">
              <span className="ac-me-av">{initialsOf(who.name, who.email)}</span>
              <span className="ac-me-tx">
                <small>Signed in as</small>
                <b>{who.name || who.email}</b>
              </span>
              <button className="ac-me-out" onClick={signOutHere} aria-label="Log out" title="Log out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
              </button>
            </div>
          )}
          <button className="ac-ghost" onClick={signOutEverywhere}>Sign out everywhere</button>
        </div>
      </aside>
      <main className="ac-main">
        <div className="ac-col">{children}</div>
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

/** What the sweep follows. The name is whatever the owner typed — "Office Pool" says
 *  nothing — so this is the line that makes a list of sweeps readable at a glance. */
function CompetitionLine({ s, note }) {
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

function SweepRow({ s, billing, reload }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [rotConfirm, setRotConfirm] = useState(false);
  const [rotated, setRotated] = useState(null);
  const [rotErr, setRotErr] = useState(false);
  const { trialing, lapsed, daysLeft, stopping, endsOn } = useBilling(billing);
  const acts = useBillingActions();

  const tier = stopping
    ? { label: endsOn ? `Paid · stops ${endsOn}` : "Paid · stops at period end", tone: " is-warn" }
    : billing.subscribed
    ? { label: "Paid", tone: "" }
    : trialing
      ? { label: `Free trial · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`, tone: "" }
      : lapsed
        ? { label: "Read-only", tone: " is-warn" }
        : { label: "Free", tone: "" };

  async function archive() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true); setErr(false);
    try { await archiveSweep(s.id); await reload(); }
    catch { setErr(true); setConfirm(false); }
    finally { setBusy(false); }
  }

  // The member link is the sweep's only credential, so a link pasted into the wrong
  // chat can only be taken back by replacing it — which locks out everyone still
  // using the old one. Hence the two-step confirm, same shape as Archive's, and the
  // new link shown straight after so the owner can send it on. Never gated on
  // billing: a lapsed owner needs this more than anyone (api rotate is requireLive:false).
  async function rotate() {
    if (!rotConfirm) { setRotConfirm(true); return; }
    setBusy(true); setRotErr(false);
    try {
      const { memberLink } = await rotateSweep(s.id);
      setRotated(memberLink);
      setRotConfirm(false);
      await reload();
    } catch { setRotErr(true); setRotConfirm(false); }
    finally { setBusy(false); }
  }

  return (
    <section className="ac-card">
      <div className="ac-card-top">
        <div className="ac-card-id">
          <h3 className="ac-card-h">{s.name}</h3>
          <CompetitionLine s={s} />
        </div>
        <button className="ac-ghost is-danger" disabled={busy} onClick={archive}>
          {confirm ? "Really archive?" : "Archive"}
        </button>
      </div>
      {/* who is actually in there — the question this screen could not answer */}
      {s.members && (
        <p className="ac-b">
          {s.members.total} in the sweep
          {s.members.total > s.members.registered
            ? ` · ${s.members.total - s.members.registered} not joined yet`
            : ""}
          {" · "}
          <a className="ac-inline" href={`/s/${s.id}/admin`}>Manage members</a>
        </p>
      )}
      <LinkField label="Member link — send this to the group" value={rotated || s.memberLink} />
      {rotated && <p className="ac-b">New link ready — send it to the group. The old link stopped working.</p>}
      {rotConfirm && (
        <p className="ac-warn">
          This replaces the link for everyone: anyone using the old one is locked out until you send them this new one.
        </p>
      )}
      <button className="ac-ghost is-danger" style={{ marginTop: 10 }} disabled={busy} onClick={rotate}>
        {rotConfirm ? "Yes, replace the link" : "Replace link"}
      </button>
      {rotErr && <p className="ac-warn">Couldn't replace the link — try again.</p>}
      <div className="ac-tier">
        <span className={"ac-pill" + tier.tone}>{tier.label}</span>
        {billing.subscribed ? (
          <span className="ac-tier-acts">
            <button className="ac-ghost" disabled={acts.busy} onClick={() => acts.manage()}>Manage billing</button>
            {!stopping && (
              <button className="ac-ghost is-danger" disabled={acts.busy} onClick={() => acts.manage("cancel")}>
                Cancel subscription
              </button>
            )}
          </span>
        ) : (
          <button className="ac-ghost is-go" disabled={acts.busy} onClick={acts.subscribe}>
            {lapsed ? "Subscribe to reopen" : "Subscribe · $5/mo"}
          </button>
        )}
      </div>
      {acts.err && <p className="ac-warn">Something went wrong. Try again.</p>}
      {err && <p className="ac-warn">Archive failed — try again</p>}
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

function SweepList({ sweeps, billing, reload }) {
  const active = sweeps.filter((s) => !s.archivedAt);
  const owned = active.filter((s) => s.role !== "member");
  const joined = active.filter((s) => s.role === "member");

  if (active.length === 0) {
    return (
      <section className="ac-card ac-empty">
        <h3 className="ac-card-h">No sweeps yet</h3>
        <p className="ac-b">Pick a competition and spin one up — the fixtures come with it.</p>
        <button className="lp-btn ac-btn" onClick={() => goTo("/account/new")}>Set up your first sweep</button>
      </section>
    );
  }

  return (
    <>
      {/* Only label the groups when there are two of them — a heading over a single
          list is noise, and most people will only ever have one kind. */}
      {owned.length > 0 && joined.length > 0 && <h2 className="ac-group">Sweeps you run</h2>}
      {owned.map((s) => <SweepRow key={s.id} s={s} billing={billing} reload={reload} />)}
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

export function AccountHome() {
  const [billing, setBilling] = useState(null);
  const [sweeps, setSweeps] = useState([]);
  const [loadErr, setLoadErr] = useState(false);

  const reload = useCallback(async () => {
    setLoadErr(false);
    try {
      const [b, s] = await Promise.all([getBilling(), getAccountSweeps()]);
      setBilling(b); setSweeps(s);
    } catch { setLoadErr(true); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const live = sweeps.filter((s) => !s.archivedAt).length;

  return (
    <Console here="sweeps">
      <p className="lp-eyebrow">My account</p>
      <h1 className="ac-h1">Your sweeps</h1>
      <p className="ac-sub">Sign in on any device you own it from — admin follows your account, not a link.</p>
      {loadErr && <p className="ac-warn">Something went wrong. Try again.</p>}
      <div className="ac-stack">
        {billing && <SweepList sweeps={sweeps} billing={billing} reload={reload} />}
        {/* nothing to bill against yet — the account speaks for itself */}
        {billing && live === 0 && <BillingPanel billing={billing} />}
      </div>
    </Console>
  );
}
