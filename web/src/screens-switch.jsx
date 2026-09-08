/* ============================================================
   THE SWEEP — this device's joined sweeps.

   A member has no account: the only record that they are in a sweep is the link
   token this browser kept (sweeps.js). That list used to live at "/", which meant
   the front door showed a picker instead of the product to anyone who had ever
   joined anything. It has its own address now, and "/" is the front door again.
   ============================================================ */
import { listSweeps, switchTo } from "./sweeps.js";

/** Branded wordmark, matching the bootstrap gate's. */
function Brand() {
  return (
    <div className="sweep-brand">
      <div className="sweep-brand-word"><b>The Sweep</b></div>
    </div>
  );
}

export function SweepSwitcher() {
  const sweeps = listSweeps();
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
        {sweeps.length > 0 ? (
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
          // Nothing stored: either a new browser, or cleared site data. Either way the
          // invite link is the only way in — this page cannot conjure one.
          <p className="sweep-card-sub">
            No sweeps on this device yet. Open the invite link someone sent you, or start your own.
          </p>
        )}
        <p className="sweep-card-sub">Running your own sweep?</p>
        <a className="sweep-retry" href="/account">Sign in</a>
      </div>
    </div>
  );
}
