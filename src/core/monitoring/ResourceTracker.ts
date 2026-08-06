/**
 * Resource Tracker
 *
 * Tracks the creation and disposal of session-scoped resources (ProjectSessions,
 * HTMLVideoElements, HTMLAudioElements, WebGL textures) and can identify
 * resources that are still alive but belong to a project that is no longer
 * active — i.e. leaks.
 *
 * Exposed globally at `window.__clypra_diagnostics.resources` so engineers can
 * inspect the live state from the browser console without a build step.
 *
 * Usage (DevTools console):
 *   __clypra_diagnostics.resources.printDiagnostics()
 *   __clypra_diagnostics.resources.findLeaks()
 *
 * MED-002 / LEAK-003 fix.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrackedResourceKind =
  | "ProjectSession"
  | "HTMLVideoElement"
  | "HTMLAudioElement"
  | "WebGLTexture"
  | "PreviewMediaPool";

export interface TrackedResource {
  id: string;
  kind: TrackedResourceKind;
  projectId: string;
  sessionId?: string;
  createdAt: number;
  stack?: string;
}

export interface LeakReport {
  leaks: TrackedResource[];
  activeProjectId: string | null;
  totalTracked: number;
  totalLeaked: number;
  timestamp: string;
}

// ─── Resource Tracker ─────────────────────────────────────────────────────────

class ResourceTracker {
  private _resources = new Map<string, TrackedResource>();
  private _getActiveProjectId: (() => string | null) | null = null;

  /**
   * Inject a resolver for the current active project ID.
   * Called by the store bootstrap so the tracker stays decoupled from store imports.
   */
  setActiveProjectIdResolver(fn: () => string | null): void {
    this._getActiveProjectId = fn;
  }

  /**
   * Track creation of a new resource.
   */
  track(resource: Omit<TrackedResource, "createdAt">): void {
    const entry: TrackedResource = {
      ...resource,
      createdAt: Date.now(),
      // Capture creation stack in dev mode for easier debugging
      stack:
        import.meta.env.DEV
          ? new Error().stack?.split("\n").slice(2, 6).join("\n")
          : undefined,
    };
    this._resources.set(resource.id, entry);
  }

  /**
   * Mark a resource as released (remove from tracking).
   */
  release(id: string): void {
    this._resources.delete(id);
  }

  /**
   * Find resources that are still tracked but belong to a project other than
   * the currently active one — these are potential leaks.
   */
  findLeaks(): LeakReport {
    const activeProjectId = this._getActiveProjectId?.() ?? null;
    const leaks: TrackedResource[] = [];

    for (const resource of this._resources.values()) {
      if (activeProjectId !== null && resource.projectId !== activeProjectId) {
        leaks.push(resource);
      }
    }

    return {
      leaks,
      activeProjectId,
      totalTracked: this._resources.size,
      totalLeaked: leaks.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Return all currently tracked resources.
   */
  getAll(): TrackedResource[] {
    return Array.from(this._resources.values());
  }

  /**
   * Print a diagnostic summary to the console.
   */
  printDiagnostics(): void {
    const report = this.findLeaks();
    const all = this.getAll();

    console.group("[ResourceTracker] Diagnostics");
    console.log(`Active project: ${report.activeProjectId ?? "(none)"}`);
    console.log(`Total tracked:  ${report.totalTracked}`);

    if (report.totalLeaked > 0) {
      console.warn(`⚠️  LEAKS DETECTED: ${report.totalLeaked}`);
      console.table(
        report.leaks.map((r) => ({
          id: r.id,
          kind: r.kind,
          projectId: r.projectId,
          aliveMs: Date.now() - r.createdAt,
        }))
      );
    } else {
      console.log("✅  No leaks detected.");
    }

    if (all.length > 0) {
      console.groupCollapsed("All tracked resources");
      console.table(
        all.map((r) => ({
          id: r.id,
          kind: r.kind,
          projectId: r.projectId,
          sessionId: r.sessionId,
          aliveMs: Date.now() - r.createdAt,
        }))
      );
      console.groupEnd();
    }

    console.groupEnd();
  }

  /** Clear all tracking state (useful in tests). */
  clear(): void {
    this._resources.clear();
  }
}

// ─── Singleton + global exposure ──────────────────────────────────────────────

export const resourceTracker = new ResourceTracker();

/**
 * Install diagnostics onto `window.__clypra_diagnostics`.
 * Safe to call multiple times (idempotent).
 */
export function installDiagnostics(): void {
  if (typeof window === "undefined") return;

  const existing = (window as any).__clypra_diagnostics ?? {};
  (window as any).__clypra_diagnostics = {
    ...existing,
    resources: resourceTracker,
  };
}
