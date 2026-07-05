/* ============================================================
   THE SWEEP — account home: my-sweeps + billing (SaaS front door)
   Header-token auth via accountClient; mounted OUTSIDE SweepProvider,
   same standalone pattern as screens-super.jsx.
   ============================================================ */
import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "./components.jsx";
import { LinkField } from "./screens-super.jsx";
import {
  getBilling, getAccountSweeps, archiveSweep,
  startCheckout, openPortal, clearAccountToken,
} from "./lib/accountClient.js";

const DAY_MS = 86400000;

function goTo(url) { window.location.assign(url); }

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

  return (
    <div className="block" style={{ padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Billing</div>

      {fresh && (
        <p style={{ fontSize: 13, color: "var(--muted)" }}>Your 14-day free trial starts with your first sweep.</p>
      )}

      {trialing && (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left in your free trial.
          </p>
          <button className="cta" disabled={busy} onClick={subscribe} style={{ marginTop: 8 }}>Subscribe</button>
        </>
      )}

      {lapsed && (
        <>
          <p style={{ fontSize: 13, color: "var(--accent)" }}>Your trial has ended — sweeps are read-only until you subscribe.</p>
          <button className="cta" disabled={busy} onClick={subscribe} style={{ marginTop: 8 }}>Subscribe</button>
        </>
      )}

      {billing.subscribed && (
        <>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {billing.liveSweeps} live sweep{billing.liveSweeps === 1 ? "" : "s"}
          </p>
          {billing.subscriptionStatus === "past_due" && (
            <p style={{ fontSize: 13, color: "var(--accent)" }}>Your last payment failed — update your card to avoid losing access.</p>
          )}
          <button className="allocbtn" disabled={busy} onClick={manage} style={{ marginTop: 8 }}>Manage billing</button>
        </>
      )}

      {err && <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8 }}>Something went wrong. Try again.</p>}
    </div>
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
    <div className="block" style={{ padding: "12px 14px", marginBottom: 10 }}>
      <b style={{ fontFamily: "'Barlow Condensed'", fontWeight: 800, fontSize: 16 }}>{s.name}</b>
      <LinkField label="Member link" value={s.memberLink} />
      <LinkField label="Admin link" value={s.adminLink} />
      <div className="super-actions">
        <button className="allocbtn danger" disabled={busy} onClick={archive}>
          {confirm ? "Really archive?" : "Archive"}
        </button>
      </div>
      {err && <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8 }}>Archive failed — try again</p>}
    </div>
  );
}

function SweepList({ sweeps, reload }) {
  const active = sweeps.filter((s) => !s.archivedAt);
  if (active.length === 0) {
    return (
      <div className="empty">
        <div className="ic">🗂️</div>
        <h3>No sweeps yet</h3>
        <p>Spin one up from the app to see it here.</p>
      </div>
    );
  }
  return active.map((s) => <SweepRow key={s.id} s={s} reload={reload} />);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHeader title="My account" sub="Sweeps & billing" />
      <div className="scroll pad screen-anim" style={{ paddingTop: 12 }}>
        <div className="wrap super-wrap">
          {loadErr && <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 8 }}>Something went wrong. Try again.</p>}
          {billing && <BillingPanel billing={billing} />}
          <SweepList sweeps={sweeps} reload={reload} />
          <button className="allocbtn" style={{ marginTop: 14 }} onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
