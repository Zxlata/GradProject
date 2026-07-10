import React from "react";
import ReactDOM from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "./styles.css";
import App from "./App";
import "bootstrap-icons/font/bootstrap-icons.css";
import { registerSW } from "./serviceWorkerRegistration";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register service worker (active in production; skipped in dev unless
// REACT_APP_SW_DEV=true is set in your .env).
registerSW({
  onSuccess: (reg) => {
    console.log("[PWA] Service worker registered — app is ready for offline use.");
  },
  onUpdate: (reg) => {
    console.log("[PWA] New version available. Refresh to update.");
  },
  onOffline: () => {
    console.log("[PWA] Network offline.");
  },
  onOnline: () => {
    console.log("[PWA] Network restored.");
  },
});
