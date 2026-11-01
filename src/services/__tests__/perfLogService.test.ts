import { describe, it, expect, vi, beforeEach } from "vitest";
import { perfLogService } from "../perfLogService";

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
