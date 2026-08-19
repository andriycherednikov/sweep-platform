/* ============================================================
   THE SWEEP — standalone mount for the account shell (SaaS front door).

   Header-token auth (x-account-token), NOT the sweep session cookie — mounted
   OUTSIDE SweepProvider/Gate exactly like /super, so a signed-out visitor can
   reach the sign-in flow without a sweep session existing yet.
   ============================================================ */
import { useEffect, useState } from "react";
import { requestLogin, redeemLogin, getAccount, getAccountToken, clearAccountToken } from "./lib/accountClient.js";
import { AccountHome } from "./screens-account.jsx";
import { CatalogScreen } from "./screens-catalog.jsx";
import { useMarketingShell } from "./screens-landing.jsx";

/** The front door wears the marketing skin, not the in-sweep shell: a signed-out
 *  visitor arriving from the landing page should not feel handed off to a
 *  different product. One panel, one field — the flow really is that short. */
function AuthPanel({ tag, title, lede, children, foot }) {
  useMarketingShell();
  return (
    <div className="lp au">
      <a className="lp-brand au-brand" href="/"><span>The Sweep</span></a>
      <div className="au-panel">
        <p className="au-tag">{tag}</p>
        <h1 className="au-h">{title}</h1>
        <span className="au-rule" aria-hidden="true" />
        <p className="au-lede">{lede}</p>
        {children}
      </div>
      {foot && <p className="au-foot">{foot}</p>}
    </div>
  );
}

// Shared token-check guard: checking (verifying a stored token) | anon | in.
// Entry and RequireAccount both need it — this is the small guard the file
// already builds ad hoc for Redeem/Landing, just given a name so /account/new
// doesn't have to duplicate the getAccount() dance.
function useAccountStatus() {
  const [status, setStatus] = useState(getAccountToken() ? "checking" : "anon");

  useEffect(() => {
    if (!getAccountToken()) return;
    let alive = true;
    getAccount()
      .then(() => { if (alive) setStatus("in"); })
      .catch((err) => {
        if (err?.status === 401) clearAccountToken();
        if (alive) setStatus("anon");
      });
    return () => { alive = false; };
  }, []);

  return status;
}

function RequireAccount({ children }) {
  const status = useAccountStatus();

  useEffect(() => {
    if (status === "anon") window.location.assign("/account");
  }, [status]);

  if (status !== "in") return <div className="sweep-gate" />;
  return children;
}

function Entry() {
  const status = useAccountStatus();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

  if (status === "checking") return <div className="sweep-gate" />;
  if (status === "in") return <AccountHome />;

  async function submit(e) {
    e.preventDefault();
    setError(false);
    try { await requestLogin(email); setSent(true); }
    catch { setError(true); }
  }

  if (sent)
    return (
      <AuthPanel
        tag="Check your email"
        title="Link sent"
        lede={<>We sent a sign-in link to <b>{email}</b>. It works once, and it expires in 15 minutes.</>}
        foot={<>(dev: the link is printed on the API console)</>}
      >
        <p className="au-note">Nothing in your inbox? Look in spam, or send it again.</p>
        <button type="button" className="au-alt" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </AuthPanel>
    );

  return (
    <AuthPanel
      tag="Start free"
      title="Run your sweep"
      lede="One link signs you in and creates your account. No password to invent, no card to enter."
      foot={<>Already running one? The same link signs you back in.</>}
    >
      <form className="au-form" onSubmit={submit}>
        <label className="au-label" htmlFor="au-email">Email</label>
        <input
          id="au-email"
          className="au-input"
          type="email"
          required
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="lp-btn au-btn">Send my link</button>
        <p className="au-note">14 days free · no card · leave any time</p>
        {error && <p className="au-err">Something went wrong. Try again.</p>}
      </form>
    </AuthPanel>
  );
}

function Redeem({ token }) {
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    redeemLogin(token)
      .then(() => { window.location.replace("/account"); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [token]);

  if (!error) return <div className="sweep-gate" />;

  return (
    <AuthPanel
      tag="Sign in"
      title="Link expired"
      lede="That sign-in link has expired or was already used. Ask for a fresh one — it takes a second."
    >
      <a className="lp-btn au-btn" href="/account">Back to my account</a>
    </AuthPanel>
  );
}

function Landing({ title, msg }) {
  return (
    <AuthPanel tag="Billing" title={title} lede={msg}>
      <a className="lp-btn au-btn" href="/account">Back to my account</a>
    </AuthPanel>
  );
}

export function AccountRoot() {
  const path = window.location.pathname;
  if (path.startsWith("/account/login/")) return <Redeem token={path.split("/")[3]} />;
  if (path === "/account/billing/success")
    return <Landing title="You're set" msg="Subscription active — thanks! Your sweeps stay live." />;
  if (path === "/account/billing/cancelled")
    return <Landing title="No charge" msg="Checkout cancelled. Nothing was charged." />;
  if (path === "/account/new") {
    return (
      <RequireAccount>
        <CatalogScreen onBack={() => window.location.assign("/account")} />
      </RequireAccount>
    );
  }
  return <Entry />;
}
