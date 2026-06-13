import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { SweepProvider } from "./SweepProvider.jsx";
import { registerServiceWorker } from "./lib/registerSW.js";
import "./styles.css";
import "./desktop.css";

ReactDOM.createRoot(document.getElementById("appmount")).render(
  <SweepProvider><App /></SweepProvider>
);

registerServiceWorker();
