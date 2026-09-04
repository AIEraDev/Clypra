/**
 * Clypra Enterprise Crash Reporting & Telemetry Service
 *
 * Captures, formats, sanitizes (PII scrubbing), spools (offline IndexedDB),
 * and transmits structured crash envelopes to the Clypra Telemetry API.
 */

import { generateId } from "@/lib/utils/id";
import { getApiBaseUrl, getApiHeaders } from "@/lib/api/apiUtils";
import { lifecycleMonitor, type LifecycleEvent } from "@/core/monitoring/LifecycleMonitor";

export type CrashType =
  | "RUST_PANIC"
  | "JS_UNCAUGHT"
  | "UNHANDLED_PROMISE"
  | "WEBGL_LOST"
  | "GPU_INIT_FAILURE"
  | "AUDIO_DEVICE_LOST"
  | "EXPORT_FAILURE"
  | "SUBSYSTEM_ERROR";

export interface SystemInfo {
  os: string;
  userAgent: string;
  screenResolution: string;
  devicePixelRatio: number;
  gpuRenderer?: string;
  language: string;
  memory?: {
    jsHeapSizeLimit?: number;
    totalJSHeapSize?: number;
    usedJSHeapSize?: number;
  };
}

export interface CrashErrorPayload {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
  code?: string;
}

export interface CrashEnvelope {
  schemaVersion: 1;
  id: string;
  timestamp: string;
  timestampEpochMs: number;
  crashType: CrashType;
  subsystem?: string;
  error: CrashErrorPayload;
  system: SystemInfo;
  app: {
    version: string;
    buildMode: string;
    uptimeSeconds: number;
    activeProjectId?: string;
  };
  breadcrumbs: readonly LifecycleEvent[];
}

// ─── PII Scrubber ─────────────────────────────────────────────────────────────

const USER_PATH_REGEXES = [
  // Windows: C:\Users\Username\... -> C:\Users\[REDACTED]\...
  /([A-Za-z]:\\Users\\[^\\]+)/gi,
  // macOS: /Users/Username/... -> /Users/[REDACTED]/...
  /(\/Users\/[^\/]+)/gi,
  // Linux: /home/Username/... -> /home/[REDACTED]/...
  /(\/home\/[^\/]+)/gi,
];

const SECRET_PATTERNS = [
  /((?:api[_-]?key|bearer|token|auth|password|secret)[=:\s]+)([A-Za-z0-9_\-\.]{8,})/gi,
];

export function scrubPII(text: string): string {
  if (!text) return "";
  let result = text;

  for (const regex of USER_PATH_REGEXES) {
    result = result.replace(regex, (match) => {
      if (match.startsWith("/")) {
        const parts = match.split("/");
        return `/${parts[1]}/[REDACTED]`;
      }
      const parts = match.split("\\");
      return `${parts[0]}\\${parts[1]}\\[REDACTED]`;
    });
  }

  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "$1[REDACTED_SECRET]");
  }

  return result;
}

// ─── Offline Queue via IndexedDB ──────────────────────────────────────────────

const DB_NAME = "clypra_telemetry";
const DB_VERSION = 1;
const STORE_NAME = "crash_spool";

function openTelemetryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = (event) => reject((event.target as IDBOpenDBRequest).error);
  });
}

async function enqueueOfflineCrash(envelope: CrashEnvelope): Promise<void> {
  try {
    const db = await openTelemetryDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(envelope);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => {
        db.close();
        res();
      };
      tx.onerror = () => {
        db.close();
        rej(tx.error);
      };
    });
  } catch (err) {
    console.warn("[CrashReporter] Failed to queue crash offline:", err);
  }
}

async function dequeueOfflineCrashes(): Promise<CrashEnvelope[]> {
  try {
    const db = await openTelemetryDb();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    const envelopes = await new Promise<CrashEnvelope[]>((res, rej) => {
      request.onsuccess = () => res(request.result || []);
      request.onerror = () => rej(request.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        rej(tx.error);
      };
    });
    return envelopes;
  } catch {
    return [];
  }
}

async function removeOfflineCrash(id: string): Promise<void> {
  try {
    const db = await openTelemetryDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => {
        db.close();
        res();
      };
      tx.onerror = () => {
        db.close();
        rej(tx.error);
      };
    });
  } catch {
    // Non-critical
  }
}

// ─── Crash Reporting Engine ───────────────────────────────────────────────────

const APP_START_TIME = Date.now();
const MAX_RATE_LIMIT_PER_MINUTE = 10;
const DEDUPLICATION_WINDOW_MS = 10000;

export class CrashReportingService {
  private _reportTimestamps: number[] = [];
  private _recentErrorHashes: Map<string, number> = new Map();
  private _telemetryEnabled = true;
  private _endpointOverride: string | null = null;

  constructor() {
    this.initNetworkSync();
  }

  public setTelemetryEnabled(enabled: boolean): void {
    this._telemetryEnabled = enabled;
  }

  public isTelemetryEnabled(): boolean {
    return this._telemetryEnabled;
  }

  public setEndpointOverride(endpoint: string | null): void {
    this._endpointOverride = endpoint;
  }

  private initNetworkSync(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        void this.flushOfflineQueue();
      });
    }
  }

  /**
   * Builds system diagnostic metadata.
   */
  public getSystemInfo(): SystemInfo {
    if (typeof window === "undefined") {
      return {
        os: "unknown",
        userAgent: "unknown",
        screenResolution: "0x0",
        devicePixelRatio: 1,
        language: "en",
      };
    }

    let gpuRenderer: string | undefined;
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          gpuRenderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch {
      // Ignore webgl probe failure
    }

    let memory: SystemInfo["memory"] | undefined;
    if (typeof performance !== "undefined" && (performance as any).memory) {
      const mem = (performance as any).memory;
      memory = {
        jsHeapSizeLimit: mem.jsHeapSizeLimit,
        totalJSHeapSize: mem.totalJSHeapSize,
        usedJSHeapSize: mem.usedJSHeapSize,
      };
    }

    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const osName = ua.includes("Windows") ? "windows"
      : ua.includes("Mac") ? "macos"
      : ua.includes("Linux") ? "linux"
      : "web";

    return {
      os: osName,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      screenResolution: typeof window !== "undefined" ? `${window.screen?.width || 0}x${window.screen?.height || 0}` : "0x0",
      devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
      language: typeof navigator !== "undefined" ? navigator.language : "en",
      gpuRenderer,
      memory,
    };
  }

  /**
   * Formats a raw error and payload into a standardized sanitized crash envelope.
   */
  public createEnvelope(params: {
    crashType: CrashType;
    error: Error | string | { name?: string; message: string; stack?: string; code?: string };
    subsystem?: string;
    componentStack?: string;
    activeProjectId?: string;
  }): CrashEnvelope {
    const errorObj =
      typeof params.error === "string"
        ? { name: "Error", message: params.error, stack: undefined }
        : params.error instanceof Error
        ? { name: params.error.name, message: params.error.message, stack: params.error.stack }
        : {
            name: params.error.name || "Error",
            message: params.error.message,
            stack: params.error.stack,
            code: params.error.code,
          };

    const sanitizedError: CrashErrorPayload = {
      name: scrubPII(errorObj.name),
      message: scrubPII(errorObj.message),
      stack: errorObj.stack ? scrubPII(errorObj.stack) : undefined,
      componentStack: params.componentStack ? scrubPII(params.componentStack) : undefined,
      code: (errorObj as any).code,
    };

    const now = Date.now();
    return {
      schemaVersion: 1,
      id: generateId("crash"),
      timestamp: new Date(now).toISOString(),
      timestampEpochMs: now,
      crashType: params.crashType,
      subsystem: params.subsystem,
      error: sanitizedError,
      system: this.getSystemInfo(),
      app: {
        version: "1.4.5",
        buildMode: import.meta.env.MODE || "production",
        uptimeSeconds: Math.floor((now - APP_START_TIME) / 1000),
        activeProjectId: params.activeProjectId,
      },
      breadcrumbs: lifecycleMonitor.getLog().slice(-50),
    };
  }

  /**
   * Capture and transmit a crash report.
   */
  public async reportCrash(params: {
    crashType: CrashType;
    error: Error | string | { name?: string; message: string; stack?: string; code?: string };
    subsystem?: string;
    componentStack?: string;
    activeProjectId?: string;
  }): Promise<CrashEnvelope | null> {
    if (!this._telemetryEnabled) {
      return null;
    }

    const envelope = this.createEnvelope(params);

    // Deduplication check
    const dedupKey = `${envelope.crashType}:${envelope.error.message}:${envelope.subsystem || ""}`;
    const lastSeen = this._recentErrorHashes.get(dedupKey);
    const now = Date.now();
    if (lastSeen && now - lastSeen < DEDUPLICATION_WINDOW_MS) {
      return envelope; // Deduplicated
    }
    this._recentErrorHashes.set(dedupKey, now);

    // Rate limit check
    this._reportTimestamps = this._reportTimestamps.filter((t) => now - t < 60000);
    if (this._reportTimestamps.length >= MAX_RATE_LIMIT_PER_MINUTE) {
      console.warn("[CrashReporter] Rate limit exceeded, queuing report offline");
      await enqueueOfflineCrash(envelope);
      return envelope;
    }
    this._reportTimestamps.push(now);

    // Send to API
    const success = await this.sendEnvelope(envelope);
    if (!success) {
      await enqueueOfflineCrash(envelope);
    }

    return envelope;
  }

  /**
   * Transmits envelope to the telemetry backend.
   */
  private async sendEnvelope(envelope: CrashEnvelope): Promise<boolean> {
    const endpoint =
      this._endpointOverride ||
      import.meta.env.VITE_CLYPRA_CRASH_REPORT_URL ||
      `${getApiBaseUrl()}/telemetry/crashes`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(envelope),
      });

      if (!response.ok && response.status !== 404) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Flushes offline queued crash reports to the backend.
   */
  public async flushOfflineQueue(): Promise<number> {
    if (!this._telemetryEnabled || (typeof navigator !== "undefined" && !navigator.onLine)) {
      return 0;
    }

    const pending = await dequeueOfflineCrashes();
    let sentCount = 0;

    for (const envelope of pending) {
      const sent = await this.sendEnvelope(envelope);
      if (sent) {
        await removeOfflineCrash(envelope.id);
        sentCount++;
      }
    }

    return sentCount;
  }
}

export const crashReporter = new CrashReportingService();
