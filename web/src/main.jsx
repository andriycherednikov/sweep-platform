import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { SuperRoot } from "./SuperRoot.jsx";
import { AccountRoot } from "./AccountRoot.jsx";
import { Pricing } from "./screens-pricing.jsx";
import { Terms, Privacy } from "./screens-legal.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import { joinFromLocation } from "./lib/bootstrapJoin.js";
import { parseSuperRoute } from "./lib/superRoute.js";
import { postSession } from "./api/client.js";
import "./styles.css";
import "./desktop.css";

const root = ReactDOM.createRoot(document.getElementById("appmount"));
const sup = parseSuperRoute(window.location.pathname);

// Marketing pages: no sweep session, no account token, so they mount standalone
// rather than behind the Gate (which would 401 a signed-out visitor).
const MARKETING = { "/pricing": Pricing, "/terms": Terms, "/privacy": Privacy };
const MarketingPage = MARKETING[window.location.pathname];

if (MarketingPage) {
  root.render(<MarketingPage />);
  registerServiceWorker();
} else if (window.location.pathname.startsWith("/account")) {
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
  // Intercept a /g/<token>[/admin/<token>] capability link BEFORE rendering:
  // exchange it for a session cookie, then strip the token from the URL (D2).
  joinFromLocation(window.location, window.history, postSession).finally(() => {
    root.render(<SweepProvider><App /></SweepProvider>);
    registerServiceWorker();
  });
}
