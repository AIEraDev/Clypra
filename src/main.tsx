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
import { crashReporter } from "@/core/telemetry";

// Ensure settings (theme, font, etc) are initialized immediately
initSettings();

// ── Global crash interceptors ─────────────────────────────────────────────────
// Intercept all uncaught JS errors and unhandled promise rejections so they
// are captured in the crash telemetry pipeline before reaching users as blank
// screens. These handlers are intentionally non-throwing.

window.addEventListener("error", (event) => {
  if (!event.error) return; // Ignore cross-origin or resource errors
  void crashReporter.reportCrash({
    crashType: "JS_UNCAUGHT",
    error: event.error instanceof Error ? event.error : { message: event.message },
  });
}, { capture: true, passive: true });

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason == null) return;
  void crashReporter.reportCrash({
    crashType: "UNHANDLED_PROMISE",
    error: reason instanceof Error
      ? reason
      : { name: "UnhandledRejection", message: String(reason) },
  });
}, { passive: true });

// ── WebGL context-lost prevention ─────────────────────────────────────────────
// GPU driver TDR / reset events (common on Windows with integrated GPU) fire
// "webglcontextlost" on each canvas. Calling preventDefault() cancels the
// browser's default "kill the page" behaviour, giving React a chance to render
// a graceful fallback instead of a blank white screen.
window.addEventListener("webglcontextlost", (event: Event) => {
  event.preventDefault(); // Keep the page alive
  console.warn("[Clypra] WebGL context lost — GPU reset or driver TDR detected.");
  void crashReporter.reportCrash({
    crashType: "WEBGL_LOST",
    error: { name: "WebGLContextLost", message: "GPU/WebGL context was lost. A driver reset or resource exhaustion may have occurred." },
    subsystem: "Preview Engine",
  });
}, { capture: true, passive: false });
// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
