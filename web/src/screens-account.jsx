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

export function goTo(url) { window.location.assign(url); }

/** The account console shell: a dark rail carrying the brand and where you are,
 *  a light pane carrying the work. Every signed-in page outside a sweep uses it. */
export function Console({ nav, foot, children }) {
  useMarketingShell();
  return (
    <div className="lp ac">
      <aside className="ac-side">
        <a className="lp-brand ac-brand" href="/"><span>The Sweep</span></a>
        <nav className="ac-nav">{nav}</nav>
        {foot && <div className="ac-side-foot">{foot}</div>}
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
  };
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

  async function manage() {
    setBusy(true); setErr(false);
    try { goTo((await openPortal()).url); }
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
          <button className="ac-ghost" disabled={busy} onClick={manage}>Manage billing</button>
        </>
      )}

      {err && <p className="ac-warn">Something went wrong. Try again.</p>}
    </section>
  );
}

function SweepRow({ s, billing, reload }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const { trialing, lapsed, daysLeft } = useBilling(billing);
  const acts = useBillingActions();

  const tier = billing.subscribed
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
      <div className="ac-tier">
        <span className={"ac-pill" + tier.tone}>{tier.label}</span>
        {billing.subscribed ? (
          <button className="ac-ghost" disabled={acts.busy} onClick={acts.manage}>Manage billing</button>
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

function SweepList({ sweeps, billing, reload }) {
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
  return active.map((s) => <SweepRow key={s.id} s={s} billing={billing} reload={reload} />);
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

  function signOut() {
    clearAccountToken();
    window.location.reload();
  }

  const live = sweeps.filter((s) => !s.archivedAt).length;

  return (
    <Console
      nav={<button className="ac-nav-i is-here">Sweeps<span>{live}</span></button>}
      foot={
        <>
          <button className="lp-btn ac-btn" onClick={() => goTo("/account/new")}>New sweep</button>
          <button className="ac-ghost" onClick={signOut}>Sign out</button>
        </>
      }
    >
      <p className="lp-eyebrow">My account</p>
      <h1 className="ac-h1">Your sweeps</h1>
      <p className="ac-sub">Each sweep has two links: one for the group, one you keep.</p>
      {loadErr && <p className="ac-warn">Something went wrong. Try again.</p>}
      <div className="ac-stack">
        {billing && <SweepList sweeps={sweeps} billing={billing} reload={reload} />}
        {/* nothing to bill against yet — the account speaks for itself */}
        {billing && live === 0 && <BillingPanel billing={billing} />}
      </div>
    </Console>
  );
}
