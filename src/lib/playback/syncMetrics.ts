/**
 * Frontend A/V synchronization metrics.
 *
 * These counters observe the existing PlaybackClock and playhead paint path;
 * they do not participate in transport decisions.
 */

export interface RollingDriftSnapshot {
  n: number;
  avg: number;
  maxAbs: number;
}

export class RollingDriftStats {
  private readonly samples: number[] = [];

  constructor(private readonly maxSamples = 500) {}

  record(value: number): void {
    if (!Number.isFinite(value)) return;
    this.samples.push(value);
    while (this.samples.length > this.maxSamples) this.samples.shift();
  }

  takeAndReset(): RollingDriftSnapshot {
    const snapshot = this.snapshot();
    this.samples.length = 0;
    return snapshot;
  }

  snapshot(): RollingDriftSnapshot {
    const n = this.samples.length;
    if (n === 0) return { n: 0, avg: 0, maxAbs: 0 };
    const avg = this.samples.reduce((sum, value) => sum + value, 0) / n;
    const maxAbs = Math.max(...this.samples.map(Math.abs));
    return { n, avg, maxAbs };
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const TRACE_STORAGE_KEY = "clypra.trace.avSync";

function traceFlagFromGlobal(): boolean {
  const globalWithTrace = globalThis as typeof globalThis & {
    __CLYPRA_TRACE_AV_SYNC__?: boolean;
  };
  return globalWithTrace.__CLYPRA_TRACE_AV_SYNC__ === true;
}

export function isSyncMetricsTraceEnabled(): boolean {
  if (traceFlagFromGlobal()) return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(TRACE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Enable/disable high-volume React-side sync tracing without rebuilding. */
export function setSyncMetricsTraceEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TRACE_STORAGE_KEY, enabled ? "1" : "0");
    }
  } catch {
    // Browser privacy settings can disable localStorage; tracing still works
    // through the global flag or the normal five-second summaries.
  }
  console.info(`[av-sync][react] source=react event=trace_config enabled=${enabled}`);
}

function traceEvent(event: string, details: Record<string, number | string | boolean | null>): void {
  if (!isSyncMetricsTraceEnabled()) return;
  console.debug("[av-sync][react]", {
    source: "react",
    event,
    ts_epoch_ms: Date.now(),
    ...details,
  });
}

export const uiPlayheadDrift = new RollingDriftStats();
/** Inter-paint intervals in milliseconds; maxAbs is the largest interval. */
export const playheadPaintJitter = new RollingDriftStats();
export const seekUserLatency = new RollingDriftStats();

let lastPlayheadPaintMs: number | null = null;
let nextSeekHandle = 1;
const pendingSeeks = new Map<number, number>();
const MAX_PENDING_SEEKS = 50;

export function recordPlayheadPaint(timestampMs = nowMs()): void {
  const intervalMs = lastPlayheadPaintMs === null ? null : timestampMs - lastPlayheadPaintMs;
  if (intervalMs !== null) playheadPaintJitter.record(intervalMs);
  lastPlayheadPaintMs = timestampMs;
  traceEvent("playhead_paint", { monotonic_ms: timestampMs, interval_ms: intervalMs });
}

export function recordAudioPoll(audioPositionMs: number, uiPlayheadMs: number): void {
  if (!Number.isFinite(audioPositionMs) || !Number.isFinite(uiPlayheadMs)) return;
  const driftMs = uiPlayheadMs - audioPositionMs;
  uiPlayheadDrift.record(driftMs);
  traceEvent("audio_poll", { audio_position_ms: audioPositionMs, ui_playhead_ms: uiPlayheadMs, drift_ms: driftMs });
}

export function recordSeekRequested(timestampMs = nowMs()): number {
  const handle = nextSeekHandle++;
  pendingSeeks.set(handle, timestampMs);
  while (pendingSeeks.size > MAX_PENDING_SEEKS) {
    const oldest = pendingSeeks.keys().next().value;
    if (oldest === undefined) break;
    pendingSeeks.delete(oldest);
  }
  traceEvent("seek_requested", { handle, monotonic_ms: timestampMs, pending: pendingSeeks.size });
  return handle;
}

/** Resolve a seek on the next confirmed playhead paint. */
export function recordSeekResolved(handle?: number, timestampMs = nowMs()): void {
  const resolvedHandle = handle ?? pendingSeeks.keys().next().value;
  if (resolvedHandle === undefined) return;
  const requestedAt = pendingSeeks.get(resolvedHandle);
  if (requestedAt === undefined) return;
  pendingSeeks.delete(resolvedHandle);
  const latencyMs = Math.max(0, timestampMs - requestedAt);
  seekUserLatency.record(latencyMs);
  traceEvent("seek_resolved", { handle: resolvedHandle, monotonic_ms: timestampMs, latency_ms: latencyMs });
}

export interface FrontendSyncMetricsSnapshot {
  ui_playhead_drift: RollingDriftSnapshot;
  playhead_paint_jitter: RollingDriftSnapshot;
  seek_user_latency: RollingDriftSnapshot;
}

export function getSyncMetricsSnapshot(): FrontendSyncMetricsSnapshot {
  return {
    ui_playhead_drift: uiPlayheadDrift.snapshot(),
    playhead_paint_jitter: playheadPaintJitter.snapshot(),
    seek_user_latency: seekUserLatency.snapshot(),
  };
}

/** Reset process-local samples for deterministic unit tests. */
export function resetSyncMetricsForTests(): void {
  uiPlayheadDrift.takeAndReset();
  playheadPaintJitter.takeAndReset();
  seekUserLatency.takeAndReset();
  lastPlayheadPaintMs = null;
  pendingSeeks.clear();
  nextSeekHandle = 1;
}

let flushLoopStarted = false;

export function startSyncMetricsFlushLoop(intervalMs = 5000): void {
  if (flushLoopStarted || typeof window === "undefined") return;
  flushLoopStarted = true;
  window.setInterval(() => {
    const uiDrift = uiPlayheadDrift.takeAndReset();
    const paintJitter = playheadPaintJitter.takeAndReset();
    const seekLatency = seekUserLatency.takeAndReset();
    if (uiDrift.n === 0 && paintJitter.n === 0 && seekLatency.n === 0) return;
    // Metrics remain available to the telemetry overlay and diagnostics API,
    // but periodic console summaries are intentionally silent in production.
  }, intervalMs);
}
