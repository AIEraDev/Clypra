/**
 * Focused diagnostics for native preview audio & playback synchronization.
 */

export function tracePlayback(
  event: string,
  details: Record<string, unknown> = {},
): void {
  // Always log in DEV or when debug flag is active
  const globalWithDebugFlag = globalThis as typeof globalThis & {
    __CLYPRA_DEBUG_AUDIO__?: boolean;
  };
  let localStorageEnabled = false;
  try {
    localStorageEnabled =
      localStorage.getItem("clypra:debug:audio") === "1" ||
      localStorage.getItem("clypra:debug:playback") === "1";
  } catch {}

  const debugLoggingEnabled =
    !import.meta.env.DEV &&
    !globalWithDebugFlag.__CLYPRA_DEBUG_AUDIO__ &&
    !localStorageEnabled;

  const timeMs = performance.now();
  const payload: PlaybackTraceEvent = {
    category: "playback",
    event,
    timeMs: Number(timeMs.toFixed(2)),
    ...details,
  };

  playbackMetrics.record(payload);

  // Keep developer logs structured and cheap. Aggregates are emitted by the
  // collector, so this path never floods the console on every RAF tick.
  if (debugLoggingEnabled && playbackMetrics.shouldLogEvent(event)) {
    console.debug("[playback]", JSON.stringify(payload));
  }
}

export interface PlaybackTraceEvent {
  category: "playback";
  event: string;
  timeMs: number;
  [key: string]: unknown;
}

export interface PlaybackMetricsSnapshot {
  windowMs: number;
  events: number;
  seeks: number;
  seekP50Ms: number | null;
  seekP95Ms: number | null;
  seekP99Ms: number | null;
  droppedFrames: number;
  staleFrames: number;
  cancelledFrames: number;
  cacheHits: number;
  cacheMisses: number;
  maxDriftMs: number;
}

class PlaybackMetricsCollector {
  private readonly events: PlaybackTraceEvent[] = [];
  private readonly seekLatencies: number[] = [];
  private lastAggregateLogMs = 0;
  private debugEnabled = false;

  constructor() {
    try {
      this.debugEnabled =
        localStorage.getItem("clypra:debug:playback") === "1" ||
        localStorage.getItem("clypra:debug:audio") === "1";
    } catch {}
  }

  record(event: PlaybackTraceEvent): void {
    const now = performance.now();
    this.events.push(event);
    if (this.events.length > 2_000) this.events.splice(0, 500);

    const seekLatency = event["seekToFirstCorrectMs"];
    if (typeof seekLatency === "number" && Number.isFinite(seekLatency)) {
      this.seekLatencies.push(seekLatency);
      if (this.seekLatencies.length > 1_000) this.seekLatencies.splice(0, 250);
    }

    if (
      (this.debugEnabled || import.meta.env.DEV) &&
      now - this.lastAggregateLogMs >= 1000
    ) {
      this.lastAggregateLogMs = now;
    }
  }

  shouldLogEvent(event: string): boolean {
    return (
      event.includes("seek") ||
      event.includes("stale") ||
      event.includes("drop") ||
      event.includes("error")
    );
  }

  snapshot(): PlaybackMetricsSnapshot {
    const now = performance.now();
    const recent = this.events.filter((event) => now - event.timeMs <= 5_000);
    const values = this.seekLatencies
      .filter(
        (_, index) =>
          index >= Math.max(0, this.seekLatencies.length - recent.length),
      )
      .sort((a, b) => a - b);
    const percentile = (p: number): number | null => {
      if (values.length === 0) return null;
      return (
        values[Math.min(values.length - 1, Math.floor(values.length * p))] ??
        null
      );
    };
    const count = (key: string, expected?: unknown) =>
      recent.filter((event) =>
        expected === undefined ? event[key] : event[key] === expected,
      ).length;
    const drifts = recent
      .map((event) => event["driftMs"])
      .filter((value): value is number => typeof value === "number");
    return {
      windowMs: 5_000,
      events: recent.length,
      seeks: recent.filter((event) => event.event.includes("seek")).length,
      seekP50Ms: percentile(0.5),
      seekP95Ms: percentile(0.95),
      seekP99Ms: percentile(0.99),
      droppedFrames: count("dropped", true),
      staleFrames: count("stale", true),
      cancelledFrames: count("cancelled", true),
      cacheHits: count("cacheHit", true),
      cacheMisses: count("cacheHit", false),
      maxDriftMs:
        drifts.length > 0
          ? Math.max(...drifts.map((value) => Math.abs(value)))
          : 0,
    };
  }
}

export const playbackMetrics = new PlaybackMetricsCollector();

export function getPlaybackMetricsSnapshot(): PlaybackMetricsSnapshot {
  return playbackMetrics.snapshot();
}
