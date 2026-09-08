/* ============================================================
   THE SWEEP — standalone mount for the account shell (SaaS front door).

   Header-token auth (x-account-token), NOT the sweep session cookie — mounted
   OUTSIDE SweepProvider/Gate exactly like /super, so a signed-out visitor can
   reach the sign-in flow without a sweep session existing yet.
   ============================================================ */
import { useEffect, useState } from "react";
import {
  requestLogin, redeemLogin, passwordLogin, setPassword, getAccount, getAccountToken, clearAccountToken,
  confirmCheckout, getBilling,
} from "./lib/accountClient.js";
import { fmtDay } from "./screens-account.jsx";
import { AccountHome } from "./screens-account.jsx";
import { CatalogScreen } from "./screens-catalog.jsx";
import { useMarketingShell } from "./screens-landing.jsx";

/** The front door wears the marketing skin, not the in-sweep shell: a signed-out
 *  visitor arriving from the landing page should not feel handed off to a
 *  different product. One panel, one field — the flow really is that short. */
function AuthPanel({ tag, title, lede, children, foot }) {
  useMarketingShell();
  // *stars* mark the word the accent underlines, same convention as the hero lines
  const marked = title.split(/\*(.+?)\*/).map((part, i) => (i % 2 ? <u key={i}>{part}</u> : part));
  return (
    <div className="lp au">
      <a className="lp-brand au-brand" href="/"><span>The Sweep</span></a>
      <div className="au-panel">
        <p className="au-tag">{tag}</p>
        <h1 className="au-h">{marked}</h1>
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

/** The magic-link form, byte-for-byte today's flow: it is also how a brand-new
 *  visitor creates an account (there is no separate signup), and how anyone
 *  recovers access without knowing a password. */
function MagicEntry({ onPassword }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(false);

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
        title="Link *sent*"
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
      title="Run *your* sweep"
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
      <button type="button" className="au-alt" onClick={onPassword}>
        Sign in with a password instead
      </button>
    </AuthPanel>
  );
}

/** Email + password signs in directly — the common case once an owner has set one.
 *  There is no forgot-password form here: MagicEntry (today's flow, unchanged) is
 *  the recovery path, since it signs a person in without knowing any password. */
function PasswordEntry({ onMagic }) {
  const [email, setEmail] = useState("");
  const [password, setFieldPassword] = useState("");
  const [error, setError] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(false);
    try { await passwordLogin(email, password); window.location.reload(); }
    catch { setError(true); }
  }

  return (
    <AuthPanel tag="Sign in" title="Run *your* sweep" lede="Enter your email and password.">
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
        <label className="au-label" htmlFor="au-password" style={{ marginTop: 14 }}>Password</label>
        <input
          id="au-password"
          className="au-input"
          type="password"
          required
          placeholder="••••••••"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setFieldPassword(e.target.value)}
        />
        <button type="submit" className="lp-btn au-btn">Sign in</button>
        {error && <p className="au-err">Wrong email or password.</p>}
      </form>
      <button type="button" className="au-alt" onClick={onMagic}>
        Email me a link instead
      </button>
    </AuthPanel>
  );
}

function Entry() {
  const status = useAccountStatus();
  const [mode, setMode] = useState("password"); // password | magic

  if (status === "checking") return <div className="sweep-gate" />;
  if (status === "in") return <AccountHome />;

  return mode === "magic"
    ? <MagicEntry onPassword={() => setMode("password")} />
    : <PasswordEntry onMagic={() => setMode("magic")} />;
}

/** Shown once, right after a magic-link redeem, only when the account has no password
 *  yet. Dismissible, not a wall: the link that just worked keeps working, so nobody
 *  is trapped here — "Not now" continues to the account exactly as before this task. */
function SetPasswordCard({ onDone }) {
  const [password, setFieldPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(false);
    setBusy(true);
    try { await setPassword(password); onDone(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }

  return (
    <AuthPanel
      tag="Signed in"
      title="Set a *password*"
      lede="Optional — skip it and the email link keeps working, same as always."
    >
      <form className="au-form" onSubmit={submit}>
        <label className="au-label" htmlFor="au-newpw">New password</label>
        <input
          id="au-newpw"
          className="au-input"
          type="password"
          required
          minLength={10}
          maxLength={72}
          placeholder="At least 10 characters"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setFieldPassword(e.target.value)}
        />
        <button type="submit" className="lp-btn au-btn" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
        {error && <p className="au-err">Something went wrong. Try again, or skip for now.</p>}
      </form>
      <button type="button" className="au-alt" onClick={onDone}>Not now</button>
    </AuthPanel>
  );
}

function Redeem({ token }) {
  const [error, setError] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);

  useEffect(() => {
    let alive = true;
    redeemLogin(token)
      .then((account) => {
        if (!alive) return;
        if (account?.hasPassword) window.location.replace("/account");
        else setNeedsPassword(true);
      })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [token]);

  if (needsPassword) return <SetPasswordCard onDone={() => window.location.replace("/account")} />;

  if (!error) return <div className="sweep-gate" />;

  return (
    <AuthPanel
      tag="Sign in"
      title="Link *expired*"
      lede="That sign-in link has expired or was already used. Ask for a fresh one — it takes a second."
    >
      <a className="lp-btn au-btn" href="/account">Back to my account</a>
    </AuthPanel>
  );
}

/** Coming back from Stripe is just a URL the browser was handed — it proves nothing.
 *  Ask the API to check the session against Stripe, and say what is actually true:
 *  active, still settling, or a return we can't tie to a payment. */
function BillingReturn() {
  const [state, setState] = useState("checking"); // checking | active | pending | unknown

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    let alive = true;
    let tries = 0;

    async function check() {
      try {
        const b = sessionId ? await confirmCheckout(sessionId) : await getBilling();
        if (!alive) return;
        if (b.subscribed) return setState("active");
        // the webhook may still be in flight — give it a few seconds before saying so
        if (++tries < 5) return void setTimeout(check, 2000);
        setState("pending");
      } catch {
        if (alive) setState(sessionId ? "unknown" : "pending");
      }
    }
    check();
    return () => { alive = false; };
  }, []);

  const copy = {
    checking: ["Billing", "Checking with *Stripe*", "One moment — confirming the payment against your checkout session."],
    active: ["Billing", "You're *set*", "Your subscription is active and your sweeps stay live."],
    pending: ["Billing", "Still *settling*", "Stripe has your payment but has not confirmed it yet. This can take a minute; your account picks it up on its own."],
    unknown: ["Billing", "Can't *confirm* that", "We could not match this return to a payment on your account. If you were charged, open billing from your account and it will show there."],
  }[state];

  return (
    <AuthPanel tag={copy[0]} title={copy[1]} lede={copy[2]}>
      {state !== "checking" && <a className="lp-btn au-btn" href="/account">Back to my account</a>}
    </AuthPanel>
  );
}

/** Where the Stripe portal hands the owner back. Coming back from a cancel and being
 *  told nothing is the worst version of this screen: read the account and say what
 *  now happens, and when. */
function BillingUpdated() {
  const [billing, setBilling] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getBilling()
      .then((b) => { if (alive) setBilling(b); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (!billing && !failed)
    return <AuthPanel tag="Billing" title="One *moment*" lede="Reading your subscription…" />;

  const ends = billing?.currentPeriodEnd ? fmtDay(billing.currentPeriodEnd) : null;
  const [title, lede] = failed
    ? ["Couldn't *check*", "We could not read your subscription just now. Open your account and it will show there."]
    : billing.subscribed && billing.cancelAtPeriodEnd
      ? ["Cancelled — *no* renewal", ends
          ? `Your subscription stops on ${ends}. Everything keeps running until then, and nothing more is charged.`
          : "Your subscription will not renew. Everything keeps running to the end of the paid period."]
      : billing.subscribed
        ? ["Subscription *active*", ends ? `Next renewal ${ends}. Your sweeps stay live.` : "Your sweeps stay live."]
        : ["Subscription *ended*", "Your sweeps are read-only until you subscribe again. Nothing was deleted."];

  return (
    <AuthPanel tag="Billing" title={title} lede={lede}>
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
  if (path === "/account/billing/success") return <BillingReturn />;
  if (path === "/account/billing/updated") return <BillingUpdated />;
  if (path === "/account/billing/cancelled")
    return <Landing title="No *charge*" msg="Checkout cancelled. Nothing was charged." />;
  if (path === "/account/new") {
    return (
      <RequireAccount>
        <CatalogScreen onBack={() => window.location.assign("/account")} />
      </RequireAccount>
    );
  }
  return <Entry />;
}
