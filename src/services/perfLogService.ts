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
  | "native-diagnostic"
  | "playback-trace"
  | "fallback-event"
  | "audio-snapshot"
  | "text-rollup"
  | "export-span"
  | "seek-span"
  | "ai-inference";

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

class PerfLogService {
  private sessionId: string | null = null;
  private filePath: string | null = null;
  private queue: PerfLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private syncPollTimer: ReturnType<typeof setInterval> | null = null;
  private diagnosticsUnlisten: (() => void) | null = null;
  private flushInFlight: Promise<void> | null = null;
  private closeInFlight: Promise<void> | null = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Opens a perf-log session. Safe to call multiple times for the same
   * `sessionId` — the Rust side deduplicates by session ID.
   *
   * Call this as early as possible in the app lifecycle (e.g. root component mount).
   */
  async openSession(sessionId: string): Promise<void> {
    if (!isTauriRuntime()) return;

    try {
      const info = await tauriInvoke<PerfLogSessionInfo>(
        "open_perf_log_session",
        {
          sessionId,
        },
      );
      this.sessionId = info.sessionId;
      this.filePath = info.filePath;

      this.startFlushTimer();
      this.startSyncPollTimer();
      await this.subscribeToNativeDiagnostics();

      // Write a session-open marker so log consumers can correlate the
      // hardware context with subsequent entries without re-parsing the whole file.
      this.enqueue({
        kind: "frontend-rollup",
        sessionId: this.sessionId,
        timestampEpochMs: Date.now(),
        payload: {
          marker: "session-open",
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          appVersion: await getAppVersion(),
          appEnvironment: import.meta.env.DEV ? "beta" : "production",
        },
      });

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
      const uploadedCount = await tauriInvoke<number>("upload_pending_perf_logs", {
        apiBaseUrl: getApiBaseUrl(),
        apiKey: getApiKey(),
      });
      if (uploadedCount > 0) {
        console.log(
          `[PerfLogService] Uploaded ${uploadedCount} pending session log(s) from previous run.`,
        );
      }
    } catch (err) {
      console.warn("[PerfLogService] Failed to upload pending perf logs:", err);
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

    // Write a session-close marker before the final flush.
    this.queue.push({
      kind: "frontend-rollup",
      sessionId,
      timestampEpochMs: Date.now(),
      payload: { marker: "session-close" },
    });

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

    // Upload only if we got a valid path back.
    if (closedPath) {
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
    } catch (err) {
      // Upload failure is non-fatal — the file stays on disk and will be
      // listed by `list_perf_log_files` for manual retry / next launch.
      console.warn(
        "[PerfLogService] Session upload failed (file retained on disk):",
        err,
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

  /** Polls the Rust sync-metrics registry on each flush cycle. */
  private startSyncPollTimer(): void {
    if (this.syncPollTimer) clearInterval(this.syncPollTimer);
    this.syncPollTimer = setInterval(() => {
      void this.pollNativeSyncMetrics();
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

  private async pollNativeSyncMetrics(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const snapshot = await tauriInvoke<unknown>("get_sync_metrics_snapshot");
      if (!snapshot) return;
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

  private resolveAppVersion(): string {
    // Reads from the shared cache primed at startup by primeAppVersion().
    // Returns "unknown" only if called before the cache resolves (< a few ms).
    return getAppVersionSync() ?? "unknown";
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const perfLogService = new PerfLogService();
