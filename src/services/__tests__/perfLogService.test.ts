import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { perfLogService, PerfLogService } from "../perfLogService";

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
});

describe("PerfLogService Telemetry Upload Default Behavior", () => {
  const TELEMETRY_KEY = "clypra.telemetryUploadEnabled";
  let originalGetItem: typeof Storage.prototype.getItem;
  let originalSetItem: typeof Storage.prototype.setItem;
  let store: Record<string, string>;

  beforeEach(() => {
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
  });

  it("defaults to opt-in (true) when localStorage key is absent", () => {
    // Key is absent (default state for new users)
    expect(localStorage.getItem(TELEMETRY_KEY)).toBeNull();

    // Static accessor (primary API)
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

  it("allows user to toggle from default opt-in to opt-out", () => {
    // Start with default (key absent)
    expect(PerfLogService.isTelemetryUploadEnabledStatic()).toBe(true);

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
});
