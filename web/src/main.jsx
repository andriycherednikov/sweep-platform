import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { SuperRoot } from "./SuperRoot.jsx";
import { AccountRoot } from "./AccountRoot.jsx";
import { Pricing } from "./screens-pricing.jsx";
import { Terms, Privacy } from "./screens-legal.jsx";
import { SweepSwitcher } from "./screens-switch.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import { joinFromLocation, inviteFromLocation } from "./lib/bootstrapJoin.js";
import { parseSuperRoute } from "./lib/superRoute.js";
import { parseSweepPath } from "./lib/joinLink.js";
import { postSession, postInviteSession, setActiveSweep, NO_SWEEP } from "./api/client.js";
import "./styles.css";
import "./desktop.css";

const root = ReactDOM.createRoot(document.getElementById("appmount"));
const sup = parseSuperRoute(window.location.pathname);
// One normalized path for every branch below: "/pricing/" used to miss the exact-match
// dict and fall through to the app, and "/accountfoo" used to match the account prefix.
const path = window.location.pathname.replace(/\/+$/, "") || "/";
const under = (base) => path === base || path.startsWith(base + "/");

// Marketing pages: no sweep session, no account token, so they mount standalone
// rather than behind the Gate (which would 401 a signed-out visitor).
const MARKETING = { "/pricing": Pricing, "/terms": Terms, "/privacy": Privacy };
const MarketingPage = MARKETING[path];

if (MarketingPage) {
  root.render(<MarketingPage />);
  registerServiceWorker();
} else if (path === "/switch") {
  // The sweeps you are in. It checks the account first and sends a signed-out
  // visitor to /account: the list belongs to a person, not to a browser.
  root.render(<SweepSwitcher />);
  registerServiceWorker();
} else if (under("/account")) {
  // The account shell is header-token auth (x-account-token), not the sweep
  // session cookie — mount it standalone like /super, otherwise the Gate's
  // bootstrap 401 would block a signed-out visitor before they can sign in.
  root.render(<AccountRoot />);
  registerServiceWorker();
} else if (sup.isSuper) {
  // The super console is independent of the sweep session/Gate — mount it
  // standalone, otherwise the Gate's bootstrap 401 (platform owner has a super
  // cookie, not a sweep session) would block /super and make minting the first
  // sweep impossible. Strip the token from the URL first (security: keep bare
  // /super; SuperRoot receives it in memory for auto-submit).
  window.history.replaceState({}, "", "/super");
  root.render(<SuperRoot autoToken={sup.token} />);
  registerServiceWorker();
} else {
  // Intercept a /g/<token>[/admin/<token>] capability link BEFORE rendering: exchange
  // it for a session cookie, then replace the token in the URL with the sweep's own
  // address (D2 — the token still never lingers, it just lands somewhere real).
  // A /i/<token> invite is redeemed first: it is the only link that arrives already
  // knowing who you are, so it must not be mistaken for an anonymous group link.
  inviteFromLocation(window.location, window.history, postInviteSession)
    .then(() => joinFromLocation(window.location, window.history, postSession))
    .finally(() => {
    // The URL decides which sweep this tab is looking at — that is what makes two
    // tabs on two sweeps possible, and what makes a bookmark land where it says.
    setActiveSweep(parseSweepPath(window.location.pathname) ?? NO_SWEEP);
    root.render(<SweepProvider><App /></SweepProvider>);
    registerServiceWorker();
  });
}
