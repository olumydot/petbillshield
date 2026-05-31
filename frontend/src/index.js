import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import "@/i18n";
import App from "@/App";

// Register service worker for PWA installability + offline caching
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW registration failure is non-fatal — app works normally without it
    });
  });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

