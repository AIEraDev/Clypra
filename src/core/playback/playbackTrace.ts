/**
 * Focused diagnostics for native preview audio.
 *
 * Enabled automatically in Vite dev builds. In a packaged build it can be
 * enabled from the WebView console with:
 *   localStorage.setItem("clypra:debug:audio", "1")
 * or:
 *   globalThis.__CLYPRA_DEBUG_AUDIO__ = true
 */
let audioTraceConsoleCleared = false;

export function tracePlayback(event: string, details: Record<string, unknown> = {}): void {
  const globalWithDebugFlag = globalThis as typeof globalThis & {
    __CLYPRA_DEBUG_AUDIO__?: boolean;
  };
  let localStorageEnabled = false;
  try {
    localStorageEnabled = localStorage.getItem("clypra:debug:audio") === "1" ||
      localStorage.getItem("clypra:debug:playback") === "1";
  } catch {
    // Some WebViews may not expose localStorage during startup.
  }

  if (!import.meta.env.DEV && !globalWithDebugFlag.__CLYPRA_DEBUG_AUDIO__ && !localStorageEnabled) {
    return;
  }

  // This debugging pass intentionally excludes the high-volume render and
  // shared-clock traces. Keep only events that can explain silent native audio.
  if (!isAudioTraceEvent(event, details)) {
    return;
  }

  if (!audioTraceConsoleCleared) {
    audioTraceConsoleCleared = true;
    console.clear();
  }

  console.info(`[AudioTrace] ${event}`, {
    at: Math.round(performance.now()),
    ...details,
  });
}

function isAudioTraceEvent(event: string, details: Record<string, unknown>): boolean {
  if (event === "native.poll-position") return false;
  if (event === "native.clock-state") {
    return details.previousState !== details.state || details.isSeeking === true;
  }
  if (event === "native.command-queued" || event === "native.command-start" || event === "native.command-complete") {
    return details.label !== "set-speed";
  }
  return event.startsWith("native.audio-") ||
    event === "native.timeline-ready" ||
    event === "native.command-error" ||
    event === "native.command-skipped" ||
    event === "native.command-position";
}
