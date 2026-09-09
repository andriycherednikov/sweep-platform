/* ============================================================
   THE SWEEP — the sweeps you are in.

   This page used to read localStorage and nothing else, from back when a member had
   no account: the browser's own list was the only record that anyone was in a sweep.
   Identity is an account now, so the list is somebody's — and showing it to whoever
   opens the browser next was showing one person's sweeps to another. A signed-out
   visitor gets the sign-in page instead, and a token is not taken on trust: the
   server confirms it (signing out anywhere revokes it) before anything is listed.
   ============================================================ */
import { useEffect, useState } from "react";
import { listSweeps, switchTo } from "./sweeps.js";
import { getAccountToken, clearAccountToken, getAccount } from "./lib/accountClient.js";

/** Branded wordmark, matching the bootstrap gate's. */
function Brand() {
  return (
    <div className="sweep-brand">
      <div className="sweep-brand-word"><b>The Sweep</b></div>
    </div>
  );
}

export function SweepSwitcher() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const out = () => { clearAccountToken(); window.location.assign("/account"); };
    if (!getAccountToken()) { out(); return; }
    getAccount().then(
      () => { if (alive) setReady(true); },
      () => { if (alive) out(); },
    );
    return () => { alive = false; };
  }, []);

  const sweeps = ready ? listSweeps() : [];
  return (
    <div data-testid="sweep-switch" className="sweep-gate">
      <Brand />
      <div className="sweep-card">
        <div className="sweep-card-ic" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7.5 8.5 6 8.5-6" />
          </svg>
        </div>
        <h2 className="sweep-card-h">Your sweeps</h2>
        {!ready ? (
          <p className="sweep-card-sub">Checking you’re signed in…</p>
        ) : sweeps.length > 0 ? (
          <>
            <p className="sweep-card-sub">Jump back into one of your sweeps.</p>
            <ul className="sweep-pick-list">
              {sweeps.map((s) => (
                <li key={s.sweepId}>
                  <button className="sweep-pick-row" onClick={() => switchTo(s)}>
                    <span className="sweep-pick-name">{s.name || s.sweepId}</span>
                    <svg className="sweep-pick-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          // Signed in, but this browser has never opened one. The link is still the way
          // in — the account console is where a sweep gets started.
          <p className="sweep-card-sub">
            No sweeps on this device yet. Open the invite link someone sent you, or start your own.
          </p>
        )}
        {ready && (
          <>
            <p className="sweep-card-sub">Running your own sweep?</p>
            <a className="sweep-retry" href="/account">Your account</a>
          </>
        )}
      </div>
    </div>
  );
}
