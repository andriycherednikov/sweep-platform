/* ============================================================
   THE SWEEP — account home: my-sweeps + billing (SaaS front door)
   Header-token auth via accountClient; mounted OUTSIDE SweepProvider,
   same standalone pattern as screens-super.jsx.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { useMarketingShell } from "./screens-landing.jsx";
import {
  getBilling, getAccountSweeps, archiveSweep,
  startCheckout, openPortal, clearAccountToken,
} from "./lib/accountClient.js";

const DAY_MS = 86400000;

function goTo(url) { window.location.assign(url); }

/** A share link is here to be copied, so the copy sits on the field itself.
 *  The input stays a real input — selecting the text by hand still works, and
 *  clipboard access is not a given in every browser or embedded webview. */
function LinkField({ label, value }) {
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

function BillingPanel({ billing }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const now = Date.now();
  const trialEndsMs = billing.trialEndsAt ? new Date(billing.trialEndsAt).getTime() : null;
  const fresh = !billing.subscribed && !trialEndsMs;
  const trialing = !billing.subscribed && trialEndsMs && trialEndsMs > now;
  const lapsed = !billing.subscribed && trialEndsMs && trialEndsMs <= now;
  const daysLeft = trialing ? Math.ceil((trialEndsMs - now) / DAY_MS) : 0;

  async function subscribe() {
    setBusy(true); setErr(false);
    try { goTo((await startCheckout()).url); }
    catch (e) {
      if (e.code === "already_subscribed") {
        try { goTo((await openPortal()).url); } catch { setErr(true); }
      } else setErr(true);
    } finally { setBusy(false); }
  }

  async function manage() {
    setBusy(true); setErr(false);
    try { goTo((await openPortal()).url); }
    catch (e) {
      if (e.code === "not_subscribed") {
        try { goTo((await startCheckout()).url); } catch { setErr(true); }
      } else setErr(true);
    } finally { setBusy(false); }
  }

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
          <button className="ac-ghost" disabled={busy} onClick={manage}>Manage billing</button>
        </>
      )}

      {err && <p className="ac-warn">Something went wrong. Try again.</p>}
    </section>
  );
}

function SweepRow({ s, reload }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function archive() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true); setErr(false);
    try { await archiveSweep(s.id); await reload(); }
    catch { setErr(true); setConfirm(false); }
    finally { setBusy(false); }
  }

  return (
    <section className="ac-card">
      <div className="ac-card-top">
        <h3 className="ac-card-h">{s.name}</h3>
        <button className="ac-ghost is-danger" disabled={busy} onClick={archive}>
          {confirm ? "Really archive?" : "Archive"}
        </button>
      </div>
      <LinkField label="Member link — send this to the group" value={s.memberLink} />
      <LinkField label="Admin link — keep this one to yourself" value={s.adminLink} />
      {err && <p className="ac-warn">Archive failed — try again</p>}
    </section>
  );
}

function SweepList({ sweeps, reload }) {
  const active = sweeps.filter((s) => !s.archivedAt);
  if (active.length === 0) {
    return (
      <section className="ac-card ac-empty">
        <h3 className="ac-card-h">No sweeps yet</h3>
        <p className="ac-b">Pick a competition and spin one up — the fixtures come with it.</p>
        <button className="lp-btn ac-btn" onClick={() => goTo("/account/new")}>Set up your first sweep</button>
      </section>
    );
  }
  return active.map((s) => <SweepRow key={s.id} s={s} reload={reload} />);
}

export function AccountHome() {
  useMarketingShell();
  const [view, setView] = useState("sweeps");
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

  function signOut() {
    clearAccountToken();
    window.location.reload();
  }

  const live = sweeps.filter((s) => !s.archivedAt).length;
  const nav = (key, label, badge) => (
    <button className={"ac-nav-i" + (view === key ? " is-here" : "")} onClick={() => setView(key)}>
      {label}{badge !== undefined && <span>{badge}</span>}
    </button>
  );

  return (
    <div className="lp ac">
      {/* the side rail is the account's spine: brand, where things are, what to do next */}
      <aside className="ac-side">
        <a className="lp-brand ac-brand" href="/"><span>The Sweep</span></a>
        <nav className="ac-nav">
          {nav("sweeps", "Sweeps", live)}
          {nav("billing", "Billing")}
        </nav>
        <div className="ac-side-foot">
          <button className="lp-btn ac-btn" onClick={() => goTo("/account/new")}>New sweep</button>
          <button className="ac-ghost" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="ac-main">
        <div className="ac-col">
          <p className="lp-eyebrow">My account</p>
          <h1 className="ac-h1">{view === "billing" ? "Billing" : "Your sweeps"}</h1>
          <p className="ac-sub">
            {view === "billing"
              ? "One subscription covers every sweep you keep running."
              : "Each sweep has two links: one for the group, one you keep."}
          </p>
          {loadErr && <p className="ac-warn">Something went wrong. Try again.</p>}
          <div className="ac-stack">
            {view === "billing"
              ? billing && <BillingPanel billing={billing} />
              : <SweepList sweeps={sweeps} reload={reload} />}
          </div>
        </div>
      </main>
    </div>
  );
}
