// Silence non-error logs in production
// if (import.meta.env.PROD) {
//   const noop = () => {};
//   console.log = noop;
//   console.debug = noop;
//   console.info = noop;
//   console.warn = noop;
//   console.trace = noop;
//   console.table = noop;
//   console.group = noop;
//   console.groupCollapsed = noop;
//   console.groupEnd = noop;
//   console.time = noop;
//   console.timeEnd = noop;
//   console.timeLog = noop;
//   console.count = noop;
//   console.countReset = noop;
// }

// ── Safari/WKWebView OffscreenCanvas filter support check ────────────────────
try {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.filter = "blur(2px)";
      const supportsFilter = ctx.filter === "blur(2px)";
      if (!supportsFilter) {
        // Safari does not support filter on OffscreenCanvas. Force fallback to HTMLCanvasElement.
        (globalThis as any).OffscreenCanvas = undefined;
      }
    }
  }
} catch (e) {
  (globalThis as any).OffscreenCanvas = undefined;
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "@clypra/ui-color-picker/styles.css";
import { initSettings } from "./store/settingsStore";
import { I18nProvider } from "./i18n/I18nProvider";

// Ensure settings (theme, font, etc) are initialized immediately
initSettings();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
