import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { SuperRoot } from "./SuperRoot.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import { joinFromLocation } from "./lib/bootstrapJoin.js";
import { parseSuperRoute } from "./lib/superRoute.js";
import { postSession } from "./api/client.js";
import "./styles.css";
import "./desktop.css";

const root = ReactDOM.createRoot(document.getElementById("appmount"));
const sup = parseSuperRoute(window.location.pathname);

if (sup.isSuper) {
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
