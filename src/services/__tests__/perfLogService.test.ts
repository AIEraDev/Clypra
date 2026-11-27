import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  perfLogService,
  PerfLogService,
  sanitizeTelemetryValue,
} from "../perfLogService";

describe("PerfLogService Phase 5 Session Telemetry Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports a singleton instance with session lifecycle methods", () => {
    expect(perfLogService).toBeDefined();
    expect(typeof perfLogService.openSession).toBe("function");
    expect(typeof perfLogService.closeAndUpload).toBe("function");
    expect(typeof perfLogService.enqueue).toBe("function");
  });

  it("supports enqueueing worker-rollup, animation-eval, and worker-error log entries", () => {
    // In non-Tauri test environment without openSession, enqueue is a safe no-op
    expect(() => {
      perfLogService.enqueue({
        kind: "worker-rollup",
        sessionId: "test-session",
        timestampEpochMs: Date.now(),
        payload: {
          windowDurationMs: 30000,
          totalOperations: 42,
          totalOverBudget: 1,
          totalErrors: 0,
          domains: {},
        },
      });
    }).not.toThrow();

    expect(() => {
      perfLogService.enqueue({
        kind: "worker-error",
        sessionId: "test-session",
        timestampEpochMs: Date.now(),
        payload: {
          domain: "ComputeWorker:KeyframeEval",
          error: "Simulated worker error",
        },
      });
    }).not.toThrow();

    expect(() => {
      perfLogService.enqueue({
        kind: "animation-eval",
        sessionId: "test-session",
        timestampEpochMs: Date.now(),
        payload: {
          evalDurationMs: 2.5,
          activeClips: 3,
        },
      });
    }).not.toThrow();

    expect(() => {
      perfLogService.enqueue({
        kind: "timeline-zoom-rollup",
        sessionId: "test-session",
        timestampEpochMs: Date.now(),
        payload: {
          schema_version: 1,
          window_ms: 30000,
          gestures: { count: 3, input_events: 12 },
          input_kinds: { wheel_modifier: 3 },
          fps_active: 60,
          dpr: 2,
        },
      });
    }).not.toThrow();

    expect(() => {
      perfLogService.enqueue({
        kind: "property-edit-rollup",
        sessionId: "test-session",
        timestampEpochMs: Date.now(),
        payload: {
          category: "video",
          property: "opacity",
          inputKind: "slider_drag",
          durationMs: 342,
          sampleCount: 12,
          timestampEpochMs: Date.now(),
        },
      });
    }).not.toThrow();
  });

  it("redacts local paths in nested telemetry before browser fallback upload", () => {
    const sanitized = sanitizeTelemetryValue({
      videoPath: "/Users/example/clip.mov",
      serialized: '{"videoPath":"/Users/example/clip.mov"}',
      fileUrl: "file:///Users/example/clip.mov",
      safe: "native-video-path",
    }) as Record<string, unknown>;

    const encoded = JSON.stringify(sanitized);
    expect(encoded).not.toContain("/Users/example");
    expect(encoded).not.toContain("file:///Users/example");
    expect(encoded).toContain("[redacted-path]");
    expect(sanitized.safe).toBe("native-video-path");
  });
});

describe("PerfLogService Telemetry Upload Default Behavior", () => {
  const TELEMETRY_KEY = "clypra.telemetryUploadEnabled";
  const TELEMETRY_NOTICE_KEY = "clypra.telemetryOnboardingShown";
  let originalGetItem: typeof Storage.prototype.getItem;
  let originalSetItem: typeof Storage.prototype.setItem;
  let store: Record<string, string>;

  beforeEach(() => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_CLYPRA_DISABLE_TELEMETRY_UPLOAD", "");
    // Mock localStorage with a clean store for each test
    store = {};
    originalGetItem = Storage.prototype.getItem;
    originalSetItem = Storage.prototype.setItem;

    Storage.prototype.getItem = vi.fn((key: string) => store[key] ?? null);
    Storage.prototype.setItem = vi.fn((key: string, value: string) => {
      store[key] = value;
    });
  });

  afterEach(() => {
    Storage.prototype.getItem = originalGetItem;
    Storage.prototype.setItem = originalSetItem;
    vi.unstubAllEnvs();
  });

  it("blocks a new install until the disclosure has been shown", () => {
    expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull();
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);
  });

  it("enables a new install after the disclosure has been shown", () => {
    store[TELEMETRY_NOTICE_KEY] = "true";
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(true);
  });

  it("respects explicit opt-out (false)", () => {
    // User explicitly opts out via Settings
    PerfLogService.setTelemetryUploadEnabled(false);

    expect(localStorage.getItem(TELEMETRY_KEY)).toBe("false");
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);
  });

  it("respects explicit opt-in (true)", () => {
    // User explicitly opts in
    PerfLogService.setTelemetryUploadEnabled(true);

    expect(localStorage.getItem(TELEMETRY_KEY)).toBe("true");
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(true);
  });

  it("allows user to toggle from the undisclosed default to explicit opt-in", () => {
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);

    // User opts out
    PerfLogService.setTelemetryUploadEnabled(false);
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);

    // User opts back in
    PerfLogService.setTelemetryUploadEnabled(true);
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(true);
  });

  it("persists opt-out state across multiple reads", () => {
    // Set opt-out
    PerfLogService.setTelemetryUploadEnabled(false);

    // Read multiple times
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);
  });

  it("fails closed when storage throws", () => {
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error("storage unavailable");
    });
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(false);
  });
});
