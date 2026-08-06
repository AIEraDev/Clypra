/**
 * Lifecycle Monitor
 *
 * Records a chronological log of project lifecycle events into a fixed-size
 * circular in-memory ring buffer. The log is available at
 * `window.__clypra_diagnostics.lifecycle` for inspection in DevTools.
 *
 * Events are lightweight (no heap snapshots) and always collected in
 * development builds. In production they are kept but capped at 500 entries
 * to prevent unbounded memory growth.
 *
 * MED-002 / LEAK-003 fix.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type LifecycleEventType =
  | "PROJECT_LOAD_START"
  | "PROJECT_LOAD_COMPLETE"
  | "PROJECT_LOAD_FAILED"
  | "PROJECT_DISPOSE"
  | "SESSION_CREATE"
  | "SESSION_DISPOSE"
  | "RESOURCE_CREATE"
  | "RESOURCE_DISPOSE"
  | "CRASH_RECOVERY_FOUND"
  | "CRASH_RECOVERY_RESTORED"
  | "CRASH_RECOVERY_DISCARDED"
  | "AUTO_SAVE_START"
  | "AUTO_SAVE_COMPLETE"
  | "AUTO_SAVE_SNAPSHOT_SAVED"
  | "APP_STARTUP"
  | "APP_SHUTDOWN";

export interface LifecycleEvent {
  /** Monotonically increasing sequence number */
  seq: number;
  /** Approximate wall-clock time (ms since epoch) */
  timestamp: number;
  /** Event category */
  type: LifecycleEventType;
  /** Optional project or session identifier */
  projectId?: string;
  sessionId?: string;
  /** Free-form detail payload */
  detail?: Record<string, unknown>;
}

// ─── Ring buffer ─────────────────────────────────────────────────────────────

const MAX_EVENTS = 500;

class LifecycleMonitor {
  private _events: LifecycleEvent[] = [];
  private _seq = 0;

  /** Append a new lifecycle event. */
  record(
    type: LifecycleEventType,
    opts: { projectId?: string; sessionId?: string; detail?: Record<string, unknown> } = {}
  ): void {
    const event: LifecycleEvent = {
      seq: ++this._seq,
      timestamp: Date.now(),
      type,
      ...opts,
    };

    if (this._events.length >= MAX_EVENTS) {
      this._events.shift(); // Evict oldest entry (ring buffer)
    }
    this._events.push(event);
  }

  /**
   * Return a snapshot of the current log (newest-last).
   */
  getLog(): readonly LifecycleEvent[] {
    return this._events;
  }

  /**
   * Return events for a specific project ID.
   */
  getProjectLog(projectId: string): LifecycleEvent[] {
    return this._events.filter((e) => e.projectId === projectId);
  }

  /**
   * Print a human-readable table of the last N events to the console.
   */
  printLog(limit = 50): void {
    const entries = this._events.slice(-limit);
    console.groupCollapsed(`[LifecycleMonitor] Last ${entries.length} events`);
    for (const e of entries) {
      const ts = new Date(e.timestamp).toISOString().slice(11, 23);
      const pid = e.projectId ? ` project=${e.projectId.slice(0, 8)}` : "";
      const sid = e.sessionId ? ` session=${e.sessionId.slice(0, 12)}` : "";
      console.log(`[${ts}] #${e.seq} ${e.type}${pid}${sid}`, e.detail ?? "");
    }
    console.groupEnd();
  }

  /** Clear all events (useful in tests). */
  clear(): void {
    this._events = [];
    this._seq = 0;
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const lifecycleMonitor = new LifecycleMonitor();
