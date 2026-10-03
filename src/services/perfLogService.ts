/**
 * Session-scoped performance log service for Clypra Studio.
 *
 * Responsibilities:
 * ─────────────────
 * 1. Opens one NDJSON log file per editor session via the Rust `open_perf_log_session` command.
 * 2. Accepts batched `PerfLogEntry` objects from telemetryCollector and appends them to the file
 *    through `append_perf_log_entries` — non-blocking, batched every FLUSH_INTERVAL_MS.
 * 3. Subscribes to the Tauri `clypra://native-diagnostic` event and logs every native diagnostic.
 * 4. Polls `get_sync_metrics_snapshot` on the same cadence and appends the native A/V metrics.
 * 5. On session close (app window close-requested or visibility hidden) flushes the remaining
 *    queue, closes the file, and uploads the completed single-file payload to the API —
 *    replacing hundreds of per-rollup POST requests with one request per session.
 *
 * Integration points:
 * ─────────────────────
 * - `telemetryCollector.ts` calls `perfLogService.enqueue(entry)` instead of batching for the API.
 * - `App.tsx` (or equivalent root) calls `perfLogService.openSession(sessionId)` on mount and
 *   `perfLogService.closeAndUpload()` on `clypra://close-requested`.
 *
 * Non-goals:
 * ─────────────
 * - This service does NOT replace the Rust-side `sync_metrics` registry; it only reads snapshots.
 * - It does NOT write to console in the render path.
 * - It does NOT block any audio/video hot path — all Tauri invocations are fire-and-forget.
 */

import { getApiBaseUrl, getApiKey } from "@/lib/api/apiUtils";
import { getAppVersion, getAppVersionSync } from "@/lib/app/appVersion";
import type { NativeSessionSnapshot } from "@/lib/platform/tauri";
import type { NativePreviewPerformanceReport } from "@/lib/platform/nativeCore";
import { filmstripTelemetry } from "@/lib/filmstrip/filmstripTelemetry";
import {
  uiPlayheadDrift,
  playheadPaintJitter,
  seekUserLatency,
  audioPollRtt,
  audioExtrapolationError,
  getSyncMetricsSnapshot,
  startSyncMetricsFlushLoop,
} from "@/lib/playback/syncMetrics";
import { workerPerfCollector } from "@/core/monitoring/WorkerPerfCollector";
import { getTextMetricsSnapshot } from "@/lib/playback/textMetrics";

// ── Tauri runtime guard ───────────────────────────────────────────────────────
// Evaluated lazily at call time, not at module-load time. The module-level
// `isTauri` constant from platform.ts is evaluated when the module is first
// imported — which can happen before Tauri injects `__TAURI_INTERNALS__` into
// the window, freezing the value as false for the entire session.
function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** How often the in-memory queue is flushed to disk (matches telemetryCollector's ROLLUP_WINDOW_MS). */
const FLUSH_INTERVAL_MS = import.meta.env.DEV ? 5_000 : 30_000;
/** How often the native sync-metrics snapshot is polled (same cadence as flush). */
const SYNC_POLL_INTERVAL_MS = FLUSH_INTERVAL_MS;
/** Maximum entries held in-memory before a forced flush. Prevents unbounded growth. */
const MAX_QUEUE_SIZE = 200;

// ── Types ────────────────────────────────────────────────────────────────────

export type PerfLogKind =
  | "frontend-rollup"
  | "native-sync"
  | "native-session-telemetry"
  | "native-diagnostic"
  | "playback-trace"
  | "fallback-event"
  | "audio-snapshot"
  | "text-rollup"
  | "sticker-rollup"
  | "composition-rollup"
  | "export-span"
  | "seek-span"
  | "ai-inference"
  | "filmstrip-rollup"
  | "frontend-av-sync"
  | "timeline-edit"
  | "timecode-jump"
  | "shuttle-transition"
  | "otio-interchange"
  | "worker-rollup"
  | "animation-eval"
  | "worker-error"
  | "media-preview-diagnostic"
  | "project-session-load"
  | "project-session-close"
  | "engine-telemetry"
  | "engine-frame-telemetry"
  | "engine-qos-decision"
  | "engine-seek-telemetry"
  | "zero-copy-violation"
  | "preview-quality-benchmark"
  | "preview-benchmark-report";

export interface PerfLogEntry {
  kind: PerfLogKind;
  /** Matches the session ID passed to `openSession`. */
  sessionId: string;
  /** Unix epoch ms — set by the caller at collection time. */
  timestampEpochMs: number;
  /** Raw payload — typed by `kind` but opaque to the Rust layer. */
  payload: unknown;
}

interface PerfLogSessionInfo {
  sessionId: string;
  filePath: string;
  openedAtEpochMs: number;
}

interface MediaRuntimeStatus {
  available: boolean;
  bundled: boolean;
  ffmpegVersion: string | null;
}

/**
 * Native sync snapshots contain an observation timestamp which changes even
 * when the metrics do not. Exclude it so idle sessions do not archive the
 * same counters every interval.
 */
function nativeSyncFingerprint(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== "object") return JSON.stringify(snapshot);
  const stable = { ...(snapshot as Record<string, unknown>) };
  delete stable.timestamp_epoch_ms;
  delete stable.timestampEpochMs;
  return JSON.stringify(stable);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Lazy dynamic import of the Tauri invoke function so this module loads in non-Tauri environments. */
async function tauriInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function tauriListen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen(event, (e) => handler(e.payload));
  return unlisten;
}

// ── PerfLogService ────────────────────────────────────────────────────────────

export class PerfLogService {
  private sessionId: string | null = null;
  private filePath: string | null = null;
  /** Serializes startup so React remounts cannot create parallel launch logs. */
  private openInFlight: Promise<void> | null = null;
  private queue: PerfLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private syncPollTimer: ReturnType<typeof setInterval> | null = null;
  private diagnosticsUnlisten: (() => void) | null = null;
  private playbackStartupUnlisten: (() => void) | null = null;
  private workerErrorUnlisten: (() => void) | null = null;
  private engineUnlistens: (() => void)[] = [];
  private flushInFlight: Promise<void> | null = null;
  private closeInFlight: Promise<void> | null = null;
  /** Peak process RSS observed since the current session opened (MB). */
  private peakMemoryMb: number = 0;
  /** Last native-sync content persisted in this session (timestamps excluded). */
  private lastNativeSyncFingerprint: string | null = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the peak process resident-set size observed since the last
   * `openSession` call, in megabytes.
   *
   * Returns `0` before the first memory poll fires or in non-Tauri environments.
   * Safe to call from any callsite that needs a real `peakRamMb` value.
   */
  getPeakMemoryMb(): number {
    return this.peakMemoryMb;
  }

  /**
   * Opens a perf-log session. Safe to call multiple times for the same
   * `sessionId` — the Rust side deduplicates by session ID.
   *
   * Call this as early as possible in the app lifecycle (e.g. root component mount).
   */
  async openSession(sessionId: string): Promise<void> {
    if (!isTauriRuntime()) return;

    // `App` can be mounted twice in development (and during some HMR paths).
    // The native session id is only known after the async invoke resolves, so
    // checking `this.sessionId` alone leaves a window where two callers can
    // each create a different file. One app launch must own one active file.
    if (this.sessionId) return;
    if (this.openInFlight) return this.openInFlight;

    this.openInFlight = this.openSessionImpl(sessionId).finally(() => {
      this.openInFlight = null;
    });
    return this.openInFlight;
  }

  private async openSessionImpl(sessionId: string): Promise<void> {
    try {
      const info = await tauriInvoke<PerfLogSessionInfo>(
        "open_perf_log_session",
        {
          sessionId,
        },
      );
      this.sessionId = info.sessionId;
      this.filePath = info.filePath;
      this.peakMemoryMb = 0; // reset peak for the new session
      this.lastNativeSyncFingerprint = null;

      this.startFlushTimer();
      this.startSyncPollTimer();
      await this.subscribeToNativeDiagnostics();
      await this.subscribeToNativePlaybackStartup();
      await this.subscribeToEngineEvents();
      // Start the dev-console loop (non-destructive snapshot; NDJSON forwarding
      // uses takeAndReset() inside flushFrontendSyncMetrics on the poll timer).
      startSyncMetricsFlushLoop(SYNC_POLL_INTERVAL_MS);

      // Listen to worker error events from WorkerPerfCollector
      if (this.workerErrorUnlisten) {
        this.workerErrorUnlisten();
        this.workerErrorUnlisten = null;
      }
      this.workerErrorUnlisten = workerPerfCollector.onError((event) => {
        if (!this.sessionId) return;
        this.enqueue({
          kind: "worker-error",
          sessionId: this.sessionId,
          timestampEpochMs: Date.now(),
          payload: event,
        });
      });

      // Write a session-open marker so log consumers can correlate the
      // hardware context with subsequent entries without re-parsing the whole file.
      // Uses "native-diagnostic" kind so it is stored in the R2 raw archive
      // but never parsed as a telemetry event (it has no eventId/device/video/workload).
      this.enqueue({
        kind: "native-diagnostic",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: {
          marker: "session-open",
          appVersion: await getAppVersion(),
          appEnvironment: import.meta.env.DEV ? "beta" : "production",
        },
      });
      void this.captureMediaRuntimeStatus(this.sessionId);

      // Asynchronously retry uploading any pending session logs from previous runs / offline sessions.
      void this.retryPendingUploads();
    } catch (err) {
      // Non-fatal — the app continues without file logging.
      console.warn("[PerfLogService] Failed to open perf-log session:", err);
    }
  }

  /**
   * Retries uploading any un-uploaded session logs left on disk from previous runs
   * (e.g. from app force-close, crash, or network outage).
   */
  private async retryPendingUploads(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      const uploadedCount = await tauriInvoke<number>(
        "upload_pending_perf_logs",
        {
          apiBaseUrl: getApiBaseUrl(),
          apiKey: getApiKey(),
        },
      );
      if (uploadedCount > 0) {
        console.log(
          `[PerfLogService] Uploaded ${uploadedCount} pending session log(s) from previous run.`,
        );
      }
    } catch (err) {
      console.warn("[PerfLogService] Failed to upload pending perf logs via Rust:", err);
    }

    // If any pending files remain on disk, attempt upload via uploadSessionFile (with browser fallback)
    try {
      const files = await tauriInvoke<Array<{ filePath: string; fileName: string }>>("list_perf_log_files");
      const pendingFiles = files.filter(
        (f) => f.filePath !== this.filePath && !f.fileName.endsWith(".uploaded"),
      );
      for (const file of pendingFiles) {
        await this.uploadSessionFile(file.filePath);
      }
    } catch (err) {
      console.warn("[PerfLogService] Failed to process remaining pending perf logs:", err);
    }
  }

  /**
   * Enqueues one entry for the current session.
   * Called by `telemetryCollector` after every rollup / event build.
   * No-op if no session is open or not running in Tauri.
   */
  enqueue(entry: PerfLogEntry): void {
    if (!this.sessionId || !isTauriRuntime()) return;

    // Always stamp with the active session ID in case the caller passed a
    // stale ID from before a project switch.
    entry.sessionId = this.sessionId;

    this.queue.push(entry);

    if (this.queue.length >= MAX_QUEUE_SIZE) {
      // Non-blocking — do not await inside a synchronous hot path.
      void this.flushQueue();
    }
  }

  /**
   * Flushes remaining entries, closes the log file, uploads the completed
   * file as a single request, then cleans up timers.
   *
   * Should be called on:
   *   - `clypra://close-requested` Tauri event (before calling `exit_app`)
   *   - `visibilitychange` → hidden (best-effort for backgrounded web views)
   */
  async closeAndUpload(): Promise<void> {
    if (!this.sessionId || !isTauriRuntime()) return;

    // Deduplicate concurrent close calls (e.g. close-requested + visibility change).
    if (this.closeInFlight) return this.closeInFlight;

    this.closeInFlight = this._doCloseAndUpload().finally(() => {
      this.closeInFlight = null;
    });
    return this.closeInFlight;
  }

  /** Returns the current session ID (useful for tagging spans from other modules). */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Flushes the in-memory queue to disk without closing the session.
   * Safe to call on visibilitychange: hidden — the session stays open
   * so the proper close path can upload the complete file later.
   */
  flushToDisk(): void {
    if (!this.sessionId || !isTauriRuntime()) return;
    void this.flushQueue();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _doCloseAndUpload(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId) return;

    this.stopTimers();

    // ── Phase 5 Native Session Telemetry Capture ──────────────────────────────
    // Capture the lifetime performance summary accumulated by PerformanceManager / SessionTelemetryCollector.
    // This includes deadline misses, scheduler queue wait, decode latencies, dropped frames,
    // render path breakdown, and policy throttling counts.
    try {
      const nativeStats = await tauriInvoke<NativeSessionSnapshot>(
        "get_session_telemetry",
      );
      if (nativeStats && nativeStats.framesProduced > 0) {
        // 1. Raw native session telemetry entry for full-fidelity Cloudflare R2 archival
        this.queue.push({
          kind: "native-session-telemetry",
          sessionId,
          timestampEpochMs: Date.now(),
          payload: nativeStats,
        });

        // 2. Synthesized session-rollup formatted as PerformanceEventPayload
        //    so clypra-api parses and stores it directly in Neon PostgreSQL / D1 metrics_summary!
        const totalDurationMs = Math.max(
          1,
          Math.round(nativeStats.sessionDurationSecs * 1000),
        );
        const renderedFps =
          nativeStats.sessionDurationSecs > 0
            ? Number(
                (
                  nativeStats.framesProduced / nativeStats.sessionDurationSecs
                ).toFixed(2),
              )
            : 60;

        this.queue.push({
          kind: "frontend-rollup",
          sessionId,
          timestampEpochMs: Date.now(),
          payload: {
            eventId: `native-session-rollup-${sessionId}-${Date.now()}`,
            measurementSource: "session-rollup",
            sessionId,
            appVersion: this.resolveAppVersion(),
            appBuildNumber: "1",
            appEnvironment: import.meta.env.DEV ? "beta" : "production",
            device: {
              osFamily:
                typeof navigator !== "undefined" &&
                navigator.userAgent.includes("Mac")
                  ? "macos"
                  : "windows",
              gpuVendor: "gpu",
              gpuModel: "native-wgpu",
              screenResolution:
                typeof window !== "undefined"
                  ? `${window.screen.width}x${window.screen.height}`
                  : "1920x1080",
              devicePixelRatio:
                typeof window !== "undefined" ? window.devicePixelRatio : 1,
              cpuCores:
                typeof navigator !== "undefined"
                  ? navigator.hardwareConcurrency
                  : 8,
            },
            video: {
              width: 1920,
              height: 1080,
              resolutionBucket: "1080p",
              codec: "native-frame",
              colorSpace: "rec709",
              bitDepth: 8,
              nominalFps: 60,
            },
            workload: {
              mode: "playback",
              durationMs: totalDurationMs,
              targetFps: 60,
              renderedFps,
              totalFrames: nativeStats.framesProduced,
              droppedFrames: nativeStats.framesDropped,
              droppedFramesRatio: (nativeStats.dropRatePct ?? 0) / 100,
              staleFrames: 0,
              cancelledFrames: 0,
              peakRamMb: this.peakMemoryMb > 0 ? this.peakMemoryMb : 512,
              cacheHitRatio: 0,
              isSessionRollup: true,
              stageTimings: {
                decodeUs: nativeStats.avgDecodeUs ?? undefined,
                schedulerWaitUs: nativeStats.avgQueueWaitUs ?? undefined,
                ipcWaitUs: nativeStats.avgIpcWaitUs ?? undefined,
                submitPresentUs: nativeStats.avgGpuRenderUs ?? undefined,
                totalTimeUs:
                  (nativeStats.avgDecodeUs ?? 0) +
                  (nativeStats.avgQueueWaitUs ?? 0) +
                  (nativeStats.avgIpcWaitUs ?? 0) +
                  (nativeStats.avgGpuRenderUs ?? 0),
              },
            },
            nativeSession: nativeStats,
            timestampMs: Date.now(),
          },
        });
      }
    } catch (err) {
      console.warn(
        "[PerfLogService] Failed to capture final session telemetry:",
        err,
      );
    }

    // Capture the final native preview benchmark report if available.
    // Contains reportVersion, gitCommit, gitDirty, preview (cache stats, seek percentiles,
    // modeStats, UNCH skipped count, lookahead skipped count, stage diagnoses, etc.).
    try {
      if (isTauriRuntime()) {
        const nativeReport = await tauriInvoke<NativePreviewPerformanceReport>(
          "get_native_preview_performance_report",
        );
        if (nativeReport) {
          let frontendStats: unknown = null;
          try {
            const { nativePerfCollector } = await import(
              "@/core/playback/nativePerfTelemetry"
            );
            frontendStats = {
              units: "milliseconds",
              modeStats: nativePerfCollector.allStats(),
              pushBridge: nativePerfCollector.pushBridgeStats(),
            };
          } catch {
            // Frontend stats optional
          }
          this.queue.push({
            kind: "preview-benchmark-report",
            sessionId,
            timestampEpochMs: Date.now(),
            payload: {
              ...nativeReport,
              text: getTextMetricsSnapshot(),
              sync: getSyncMetricsSnapshot(),
              frontend: frontendStats,
            },
          });
        }
      }
    } catch (err) {
      console.warn(
        "[PerfLogService] Failed to capture final preview benchmark report:",
        err,
      );
    }

    // Write a session-close marker before the final flush.
    // Uses "native-diagnostic" so it is stored in R2 but not parsed as a telemetry event.
    this.queue.push({
      kind: "native-diagnostic",
      sessionId,
      timestampEpochMs: Date.now(),
      payload: { marker: "session-close" },
    });

    // Flush the final filmstrip window so the partial interval at session end is not lost.
    const filmstripCount = filmstripTelemetry.getRecordCount();
    if (filmstripCount > 0) {
      const filmstripSummary = filmstripTelemetry.getSummary();
      filmstripTelemetry.clear();
      this.queue.push({
        kind: "filmstrip-rollup",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: filmstripSummary,
      });
    }

    // Flush the final frontend A/V sync window so the partial interval is not lost.
    const finalUiDrift = uiPlayheadDrift.takeAndReset();
    const finalPaintJitter = playheadPaintJitter.takeAndReset();
    const finalSeekLatency = seekUserLatency.takeAndReset();
    const finalAudioPollRtt = audioPollRtt.takeAndReset();
    const finalExtrapError = audioExtrapolationError.takeAndReset();
    if (
      finalUiDrift.n > 0 ||
      finalPaintJitter.n > 0 ||
      finalSeekLatency.n > 0 ||
      finalAudioPollRtt.n > 0 ||
      finalExtrapError.n > 0
    ) {
      this.queue.push({
        kind: "frontend-av-sync",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: {
          windowDurationMs: SYNC_POLL_INTERVAL_MS,
          uiPlayheadDrift: finalUiDrift,
          playheadPaintJitter: finalPaintJitter,
          seekUserLatency: finalSeekLatency,
          audioPollRtt: finalAudioPollRtt.n > 0 ? finalAudioPollRtt : undefined,
          audioExtrapolationError:
            finalExtrapError.n > 0 ? finalExtrapError : undefined,
        },
      });
    }

    // Flush the final worker & animation telemetry window so the partial interval is not lost.
    const finalWorkerRollup = workerPerfCollector.flush();
    if (finalWorkerRollup && finalWorkerRollup.totalOperations > 0) {
      this.queue.push({
        kind: "worker-rollup",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: finalWorkerRollup,
      });
    }

    // Flush the final text performance metrics window.
    const finalTextSummary = getTextMetricsSnapshot();
    if (
      finalTextSummary.uploads.totalRegistrations > 0 ||
      finalTextSummary.cache.hits > 0 ||
      finalTextSummary.cache.misses > 0 ||
      Object.keys(finalTextSummary.rendererByKind).length > 0 ||
      finalTextSummary.animation.samples > 0
    ) {
      this.queue.push({
        kind: "text-rollup",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: finalTextSummary,
      });
    }

    if (this.workerErrorUnlisten) {
      this.workerErrorUnlisten();
      this.workerErrorUnlisten = null;
    }

    // Null sessionId AFTER capturing it so flushQueue doesn't bail early.
    // We own the close from this point forward.
    this.sessionId = null;
    this.filePath = null;

    // Wait for any in-flight flush to land, then flush the final batch.
    if (this.flushInFlight) await this.flushInFlight;
    await this._flushQueueWithSession(sessionId);

    // Unsubscribe from native diagnostics before closing.
    if (this.diagnosticsUnlisten) {
      this.diagnosticsUnlisten();
      this.diagnosticsUnlisten = null;
    }
    if (this.playbackStartupUnlisten) {
      this.playbackStartupUnlisten();
      this.playbackStartupUnlisten = null;
    }
    this.engineUnlistens.forEach((u) => u());
    this.engineUnlistens = [];

    // Tell Rust to close the file and get back the path.
    let closedPath: string | null = null;
    try {
      closedPath = await tauriInvoke<string>("close_perf_log_session", {
        sessionId,
      });
    } catch (err) {
      console.warn("[PerfLogService] Failed to close perf-log session:", err);
    }

    this.queue = [];

    // Upload only if opt-in is enabled and not suppressed by env var.
    if (closedPath && this.isTelemetryUploadEnabled()) {
      await this.uploadSessionFile(closedPath);
    }
  }

  /**
   * Internal flush that uses an explicit sessionId rather than this.sessionId,
   * so it works correctly after this.sessionId has been nulled during close.
   */
  private async _flushQueueWithSession(sessionId: string): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);

    try {
      await tauriInvoke<number>("append_perf_log_entries", {
        sessionId,
        entries: batch,
      });
    } catch (err) {
      // Re-queue so data is not lost if close is retried.
      this.queue.unshift(...batch);
      console.warn(
        "[PerfLogService] Failed to flush final perf-log batch:",
        err,
      );
    }
  }

  private async uploadSessionFile(filePath: string): Promise<void> {
    try {
      await tauriInvoke<void>("upload_perf_log_session", {
        filePath,
        apiBaseUrl: getApiBaseUrl(),
        apiKey: getApiKey(),
      });
      return;
    } catch (rustErr) {
      console.warn(
        "[PerfLogService] Native session upload failed; attempting browser fetch fallback:",
        rustErr,
      );
    }

    // Secondary fallback: Read the raw file via Tauri and POST directly from the WebView
    try {
      const raw = await tauriInvoke<string>("read_perf_log_file", { filePath });
      const entries: unknown[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed));
        } catch {
          // ignore corrupted/incomplete line
        }
      }

      if (entries.length === 0) {
        await tauriInvoke<void>("mark_perf_log_uploaded", { filePath });
        return;
      }

      const url = `${getApiBaseUrl().replace(/\/+$/, "")}/performance/telemetry/ingest/session`;
      const apiKey = getApiKey();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
        headers["X-Clypra-Client"] = "clypra-desktop-v1";
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          entryCount: entries.length,
          entries,
        }),
      });

      if (response.ok) {
        console.info(
          `[PerfLogService] Browser fallback upload succeeded for '${filePath}' (${entries.length} entries)`,
        );
        await tauriInvoke<void>("mark_perf_log_uploaded", { filePath });
      } else {
        const errText = await response.text().catch(() => "");
        console.warn(
          `[PerfLogService] Browser fallback upload rejected (HTTP ${response.status}): ${errText}`,
        );
      }
    } catch (fallbackErr) {
      // Upload failure is non-fatal — the file stays on disk and will be
      // listed by `list_perf_log_files` for retry on the next launch.
      console.warn(
        "[PerfLogService] Session upload failed after both native and browser attempts (file retained on disk):",
        fallbackErr,
      );
    }
  }

  /**
   * Drains the in-memory queue into the Rust file writer.
   * Multiple concurrent calls are coalesced — only one write is in-flight at a time.
   */
  private async flushQueue(): Promise<void> {
    if (this.flushInFlight) return this.flushInFlight;
    // Capture sessionId at call time — it may be nulled by closeAndUpload
    // before the async body runs.
    const sessionId = this.sessionId;
    if (this.queue.length === 0 || !sessionId) return;

    const batch = this.queue.splice(0, this.queue.length);

    this.flushInFlight = (async () => {
      try {
        await tauriInvoke<number>("append_perf_log_entries", {
          sessionId,
          entries: batch,
        });
      } catch (err) {
        // Re-queue on failure so data is not silently dropped.
        this.queue.unshift(...batch);
        console.warn(
          "[PerfLogService] Failed to append perf-log entries:",
          err,
        );
      }
    })().finally(() => {
      this.flushInFlight = null;
    });

    return this.flushInFlight;
  }

  private startFlushTimer(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      void this.flushQueue();
    }, FLUSH_INTERVAL_MS);
  }

  /** Polls the Rust sync-metrics and session-telemetry registries on each flush cycle. */
  private startSyncPollTimer(): void {
    if (this.syncPollTimer) clearInterval(this.syncPollTimer);
    this.syncPollTimer = setInterval(() => {
      void this.pollNativeSyncMetrics();
      void this.pollNativeSessionTelemetry();
      void this.pollProcessMemory();
      void this.pollEngineTelemetry();
      this.flushFilmstripSummary();
      this.flushFrontendSyncMetrics();
      this.flushWorkerSummary();
      this.flushTextMetricsSummary();
    }, SYNC_POLL_INTERVAL_MS);
  }

  private stopTimers(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.syncPollTimer) {
      clearInterval(this.syncPollTimer);
      this.syncPollTimer = null;
    }
  }

  /**
   * Capture the selected media-runtime class once per session. Paths and
   * diagnostics are intentionally excluded: fleet analysis only needs to
   * distinguish Clypra's tested sidecar from a developer/system fallback.
   */
  private async captureMediaRuntimeStatus(sessionId: string): Promise<void> {
    try {
      const status = await tauriInvoke<MediaRuntimeStatus>(
        "get_media_runtime_status",
      );
      this.enqueue({
        kind: "native-diagnostic",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: {
          marker: "media-runtime",
          ffmpegRuntime: status.available
            ? status.bundled
              ? "bundled"
              : "system"
            : "unavailable",
          ffmpegVersion: status.ffmpegVersion ?? undefined,
        },
      });
    } catch {
      // The telemetry contract remains optional in non-Tauri test/web builds.
    }
  }

  private async pollNativeSyncMetrics(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const snapshot = await tauriInvoke<unknown>("get_sync_metrics_snapshot");
      if (!snapshot) return;
      const fingerprint = nativeSyncFingerprint(snapshot);
      if (fingerprint === this.lastNativeSyncFingerprint) return;
      this.lastNativeSyncFingerprint = fingerprint;
      this.enqueue({
        kind: "native-sync",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: snapshot,
      });
    } catch {
      // Tauri not ready yet or command unavailable — silently skip.
    }
  }

  private async pollNativeSessionTelemetry(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const snapshot = await tauriInvoke<NativeSessionSnapshot>(
        "get_session_telemetry",
      );
      if (!snapshot || snapshot.framesProduced === 0) return;
      this.enqueue({
        kind: "native-session-telemetry",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: snapshot,
      });
    } catch {
      // Tauri not ready yet or command unavailable — silently skip.
    }
  }

  /**
   * Samples the main-process resident set size (RSS) and updates `peakMemoryMb`.
   *
   * Calls the `get_process_memory_mb` Tauri command which uses `getrusage(2)`.
   * Zero-overhead on the Rust side; called at most once per flush interval.
   * Silently no-ops in non-Tauri environments.
   */
  private async pollProcessMemory(): Promise<void> {
    if (!isTauriRuntime()) return;
    try {
      const mb = await tauriInvoke<number>("get_process_memory_mb");
      if (typeof mb === "number" && mb > 0) {
        this.peakMemoryMb = Math.max(this.peakMemoryMb, mb);
      }
    } catch {
      // Command unavailable on this build — silently skip.
    }
  }

  /**
   * Drains the in-memory filmstrip tile recorder into a single summary entry
   * and enqueues it for the session NDJSON file.
   *
   * Called every flush interval. Skips when no tiles have been recorded since
   * the last flush. The recorder is cleared after snapshot so the next window
   * starts fresh — summary counts are per-interval, not cumulative.
   */
  private flushFilmstripSummary(): void {
    if (!this.sessionId) return;
    const count = filmstripTelemetry.getRecordCount();
    if (count === 0) return;
    const summary = filmstripTelemetry.getSummary();
    filmstripTelemetry.clear();
    this.enqueue({
      kind: "filmstrip-rollup",
      sessionId: this.sessionId,
      timestampEpochMs: Date.now(),
      payload: summary,
    });
  }

  /**
   * Drains the frontend A/V sync rolling stats into a single NDJSON entry.
   *
   * `uiPlayheadDrift`, `playheadPaintJitter`, and `seekUserLatency` accumulate
   * in-process but have never been persisted. This method takes a snapshot via
   * `getSyncMetricsSnapshot()` and calls `takeAndReset()` on each stat so the
   * next window starts fresh — values are per-interval, not cumulative.
   *
   * Skips the enqueue when all three stats have zero samples (nothing happened
   * in this interval, e.g. transport paused the whole time).
   */
  private flushFrontendSyncMetrics(): void {
    if (!this.sessionId) return;
    // takeAndReset() both reads and clears each stat atomically.
    const uiDrift = uiPlayheadDrift.takeAndReset();
    const paintJitter = playheadPaintJitter.takeAndReset();
    const seekLatency = seekUserLatency.takeAndReset();
    const pollRtt = audioPollRtt.takeAndReset();
    const extrapError = audioExtrapolationError.takeAndReset();
    if (
      uiDrift.n === 0 &&
      paintJitter.n === 0 &&
      seekLatency.n === 0 &&
      pollRtt.n === 0 &&
      extrapError.n === 0
    ) {
      return;
    }
    this.enqueue({
      kind: "frontend-av-sync",
      sessionId: this.sessionId,
      timestampEpochMs: Date.now(),
      payload: {
        windowDurationMs: SYNC_POLL_INTERVAL_MS,
        uiPlayheadDrift: uiDrift,
        playheadPaintJitter: paintJitter,
        seekUserLatency: seekLatency,
        audioPollRtt: pollRtt.n > 0 ? pollRtt : undefined,
        audioExtrapolationError: extrapError.n > 0 ? extrapError : undefined,
      },
    });
  }

  /**
   * Drains the worker & animation performance collector into a single worker-rollup entry.
   *
   * Called every flush interval. Skips when no worker or animation operations have occurred.
   */
  private flushWorkerSummary(): void {
    if (!this.sessionId) return;
    const summary = workerPerfCollector.flush();
    if (!summary || summary.totalOperations === 0) return;
    this.enqueue({
      kind: "worker-rollup",
      sessionId: this.sessionId,
      timestampEpochMs: Date.now(),
      payload: summary,
    });
  }

  /**
   * Drains zero-PII text performance metrics into a text-rollup entry.
   */
  private flushTextMetricsSummary(): void {
    if (!this.sessionId) return;
    const summary = getTextMetricsSnapshot();
    if (
      summary.uploads.totalRegistrations === 0 &&
      summary.cache.hits === 0 &&
      summary.cache.misses === 0 &&
      Object.keys(summary.rendererByKind).length === 0 &&
      summary.animation.samples === 0
    ) {
      return;
    }
    this.enqueue({
      kind: "text-rollup",
      sessionId: this.sessionId,
      timestampEpochMs: Date.now(),
      payload: summary,
    });
  }

  /** Subscribes to the Tauri native-diagnostic event bridge. */
  private async subscribeToNativeDiagnostics(): Promise<void> {
    try {
      const unlisten = await tauriListen(
        "clypra://native-diagnostic",
        (payload) => {
          if (!this.sessionId) return;
          this.enqueue({
            kind: "native-diagnostic",
            sessionId: this.sessionId,
            timestampEpochMs: Date.now(),
            payload,
          });
        },
      );
      this.diagnosticsUnlisten = unlisten;
    } catch (err) {
      console.warn(
        "[PerfLogService] Failed to subscribe to native diagnostics:",
        err,
      );
    }
  }

  /** Persists native readiness/first-frame milestones without terminal I/O. */
  private async subscribeToNativePlaybackStartup(): Promise<void> {
    try {
      this.playbackStartupUnlisten = await tauriListen(
        "clypra://native-playback-startup",
        (payload) => {
          if (!this.sessionId) return;
          this.enqueue({
            kind: "native-diagnostic",
            sessionId: this.sessionId,
            timestampEpochMs: Date.now(),
            payload: {
              marker: "native-playback-startup",
              ...(payload as object),
            },
          });
        },
      );
    } catch {
      // The event is optional on older builds; normal telemetry continues.
    }
  }

  /** Subscribes to the Clypra Real-Time Engine (v2) telemetry event stream. */
  private async subscribeToEngineEvents(): Promise<void> {
    try {
      const u1 = await tauriListen("clypra://engine-telemetry", (payload) => {
        if (!this.sessionId) return;
        this.enqueue({
          kind: "engine-telemetry",
          sessionId: this.sessionId,
          timestampEpochMs: Date.now(),
          payload,
        });
      });
      const u2 = await tauriListen("clypra://engine-frame-anomaly", (payload) => {
        if (!this.sessionId) return;
        this.enqueue({
          kind: "engine-frame-telemetry",
          sessionId: this.sessionId,
          timestampEpochMs: Date.now(),
          payload,
        });
      });
      const u3 = await tauriListen("clypra://engine-qos-decision", (payload) => {
        if (!this.sessionId) return;
        this.enqueue({
          kind: "engine-qos-decision",
          sessionId: this.sessionId,
          timestampEpochMs: Date.now(),
          payload,
        });
      });
      const u4 = await tauriListen("clypra://engine-seek-telemetry", (payload) => {
        if (!this.sessionId) return;
        this.enqueue({
          kind: "engine-seek-telemetry",
          sessionId: this.sessionId,
          timestampEpochMs: Date.now(),
          payload,
        });
      });
      const u5 = await tauriListen("clypra://zero-copy-violation", (payload) => {
        if (!this.sessionId) return;
        this.enqueue({
          kind: "zero-copy-violation",
          sessionId: this.sessionId,
          timestampEpochMs: Date.now(),
          payload,
        });
      });
      this.engineUnlistens = [u1, u2, u3, u4, u5];
    } catch (err) {
      console.warn("[PerfLogService] Failed to subscribe to engine events:", err);
    }
  }

  private async pollEngineTelemetry(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const snapshot = await tauriInvoke<unknown>("get_engine_telemetry");
      if (!snapshot) return;
      this.enqueue({
        kind: "engine-telemetry",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: snapshot,
      });
    } catch {
      // Ignored if engine telemetry is unavailable
    }
  }

  private resolveAppVersion(): string {
    // Reads from the shared cache primed at startup by primeAppVersion().
    // Returns "unknown" only if called before the cache resolves (< a few ms).
    return getAppVersionSync() ?? "unknown";
  }

  /**
   * Returns true only if the user has explicitly opted in to telemetry upload.
   * Respects CLYPRA_DISABLE_TELEMETRY_UPLOAD env var for CI and contributors.
   * Default is off for all installs including upgrades.
   */
  private isTelemetryUploadEnabled(): boolean {
    // Env var takes precedence (contributors, CI)
    const g = typeof globalThis !== "undefined" ? (globalThis as Record<string, unknown>) : {};
    const proc = g.process as { env?: Record<string, string | undefined> } | undefined;
    if (proc?.env?.CLYPRA_DISABLE_TELEMETRY_UPLOAD) {
      return false;
    }
    if (typeof import.meta !== "undefined" && import.meta.env?.VITE_CLYPRA_DISABLE_TELEMETRY_UPLOAD === "1") {
      return false;
    }
    // User opt-in — default false so consent is never inferred
    try {
      return localStorage.getItem("clypra.telemetryUploadEnabled") === "true";
    } catch {
      return false;
    }
  }

  /** Enable or disable telemetry upload. Persists across sessions. */
  static setTelemetryUploadEnabled(enabled: boolean): void {
    try {
      localStorage.setItem("clypra.telemetryUploadEnabled", String(enabled));
    } catch {
      // Private browsing mode — ignore
    }
  }

  /** Returns the current opt-in state. */
  static isTelemetryUploadEnabledStatic(): boolean {
    try {
      return localStorage.getItem("clypra.telemetryUploadEnabled") === "true";
    } catch {
      return false;
    }
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const perfLogService = new PerfLogService();
