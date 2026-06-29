import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./global.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Disable old service workers to avoid stale bundles/screens after deploys.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister().catch(() => false)));
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map(key => window.caches.delete(key).catch(() => false)));
      }
    } catch (err) {
      console.warn("SW cleanup failed:", err);
    }
  });
}
