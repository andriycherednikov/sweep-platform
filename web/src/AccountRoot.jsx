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

  return (
    <div className="sweep-gate">
      <div className="sweep-card">
        <h2 className="sweep-card-h">Sign in</h2>
        {sent ? (
          <p className="sweep-card-sub">
            Check your email — the sign-in link is valid for 15 minutes.
            <br />(dev: the link is printed on the API console)
          </p>
        ) : (
          <form onSubmit={submit}>
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit">Send link</button>
            {error && <p className="sweep-card-sub">Something went wrong. Try again.</p>}
          </form>
        )}
      </div>
    </div>
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
    <div className="sweep-gate">
      <div className="sweep-card">
        <h2 className="sweep-card-h">Link expired</h2>
        <p className="sweep-card-sub">That sign-in link has expired or was already used.</p>
        <a href="/account">Back to my account</a>
      </div>
    </div>
  );
}

function Landing({ msg }) {
  return (
    <div className="sweep-gate">
      <div className="sweep-card">
        <p className="sweep-card-sub">{msg}</p>
        <a href="/account">Back to my account</a>
      </div>
    </div>
  );
}

export function AccountRoot() {
  const path = window.location.pathname;
  if (path.startsWith("/account/login/")) return <Redeem token={path.split("/")[3]} />;
  if (path === "/account/billing/success") return <Landing msg="Subscription active — thanks! Your sweeps stay live." />;
  if (path === "/account/billing/cancelled") return <Landing msg="Checkout cancelled. Nothing was charged." />;
  if (path === "/account/new") {
    return (
      <RequireAccount>
        <CatalogScreen onBack={() => window.location.assign("/account")} />
      </RequireAccount>
    );
  }
  return <Entry />;
}
