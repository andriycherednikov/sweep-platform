import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import { joinFromLocation } from "./lib/bootstrapJoin.js";
import { postSession } from "./api/client.js";
import "./styles.css";
import "./desktop.css";

// Intercept a /g/<token>[/admin/<token>] capability link BEFORE rendering:
// exchange it for a session cookie, then strip the token from the URL (D2).
joinFromLocation(window.location, window.history, postSession).finally(() => {
  ReactDOM.createRoot(document.getElementById("appmount")).render(
    <SweepProvider><App /></SweepProvider>
  );
  registerServiceWorker();
});
