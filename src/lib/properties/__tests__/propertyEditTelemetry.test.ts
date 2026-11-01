/**
 * propertyEditTelemetry.test.ts
 *
 * Unit tests for the PropertyEditTelemetryCollector singleton.
 * Verifies buffer storage, kind dispatch, zero-PII guarantees,
 * and error-safety (perfLogService throw does not propagate).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mock perfLogService before importing the module under test ---
vi.mock("@/services/perfLogService", () => ({
  perfLogService: {
    getSessionId: vi.fn(() => "test-session-id"),
    enqueue: vi.fn(),
  },
}));

import { perfLogService } from "@/services/perfLogService";
import {
  PropertyEditTelemetryCollector,
  propertyEditTelemetry,
} from "../propertyEditTelemetry";

// Cast for typed access to mock methods
const mockEnqueue = vi.mocked(perfLogService.enqueue);
const mockGetSessionId = vi.mocked(perfLogService.getSessionId);

describe("PropertyEditTelemetryCollector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    propertyEditTelemetry.clear();
  });

  // -----------------------------------------------------------------------
  // recordSliderDrag
  // -----------------------------------------------------------------------
  describe("recordSliderDrag", () => {
    it("stores an entry in the buffer with correct kind and fields", () => {
      propertyEditTelemetry.recordSliderDrag({
        property: "opacity",
        category: "video",
        durationMs: 342.7,
        sampleCount: 18,
      });

      const entries = propertyEditTelemetry.getRecentEntries();
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.inputKind).toBe("slider_drag");
      expect(entry.property).toBe("opacity");
      expect(entry.category).toBe("video");
      expect(entry.durationMs).toBe(343); // rounded
      expect(entry.sampleCount).toBe(18);
    });

    it("dispatches a property-edit-rollup entry to perfLogService", () => {
      propertyEditTelemetry.recordSliderDrag({
        property: "volume",
        category: "audio",
        durationMs: 200,
        sampleCount: 10,
      });

      expect(mockEnqueue).toHaveBeenCalledOnce();
      const call = mockEnqueue.mock.calls[0][0];
      expect(call.kind).toBe("property-edit-rollup");
      expect(call.sessionId).toBe("test-session-id");
      expect(call.payload).toMatchObject({
        inputKind: "slider_drag",
        property: "volume",
        category: "audio",
      });
    });

    it("clamps negative durationMs to 0", () => {
      propertyEditTelemetry.recordSliderDrag({
        property: "scale",
        durationMs: -50,
        sampleCount: 1,
      });

      const entries = propertyEditTelemetry.getRecentEntries();
      expect(entries[0].durationMs).toBe(0);
    });

    it("defaults category to 'unknown' when omitted", () => {
      propertyEditTelemetry.recordSliderDrag({
        property: "brightness",
        durationMs: 100,
        sampleCount: 5,
      });

      expect(propertyEditTelemetry.getRecentEntries()[0].category).toBe(
        "unknown",
      );
    });
  });

  // -----------------------------------------------------------------------
  // recordNumericCommit
  // -----------------------------------------------------------------------
  describe("recordNumericCommit", () => {
    it("stores an entry with inputKind numeric_input", () => {
      propertyEditTelemetry.recordNumericCommit({
        property: "positionX",
        category: "video",
        durationMs: 1200,
      });

      const entry = propertyEditTelemetry.getRecentEntries()[0];
      expect(entry.inputKind).toBe("numeric_input");
      expect(entry.property).toBe("positionX");
      expect(entry.durationMs).toBe(1200);
    });

    it("dispatches to perfLogService with property-edit-rollup kind", () => {
      propertyEditTelemetry.recordNumericCommit({
        property: "rotation",
        category: "video",
        durationMs: 800,
      });

      expect(mockEnqueue).toHaveBeenCalledOnce();
      expect(mockEnqueue.mock.calls[0][0].kind).toBe("property-edit-rollup");
    });
  });

  // -----------------------------------------------------------------------
  // recordNumericStep
  // -----------------------------------------------------------------------
  describe("recordNumericStep", () => {
    it("records an up-step with correct direction", () => {
      propertyEditTelemetry.recordNumericStep({
        property: "fadeIn",
        category: "audio",
        direction: "up",
      });

      const entry = propertyEditTelemetry.getRecentEntries()[0];
      expect(entry.inputKind).toBe("numeric_stepper");
      expect(entry.direction).toBe("up");
      expect(entry.durationMs).toBe(0);
    });

    it("records a down-step with correct direction", () => {
      propertyEditTelemetry.recordNumericStep({
        property: "fadeOut",
        category: "audio",
        direction: "down",
      });

      const entry = propertyEditTelemetry.getRecentEntries()[0];
      expect(entry.direction).toBe("down");
    });
  });

  // -----------------------------------------------------------------------
  // recordButtonAction
  // -----------------------------------------------------------------------
  describe("recordButtonAction", () => {
    it("records a reset action with button_action kind", () => {
      propertyEditTelemetry.recordButtonAction({
        action: "reset-volume",
        category: "audio",
        property: "volume",
      });

      const entry = propertyEditTelemetry.getRecentEntries()[0];
      expect(entry.inputKind).toBe("button_action");
      expect(entry.action).toBe("reset-volume");
      expect(entry.property).toBe("volume");
    });

    it("falls back to action name as property when property is omitted", () => {
      propertyEditTelemetry.recordButtonAction({
        action: "align-left",
        category: "video",
      });

      expect(propertyEditTelemetry.getRecentEntries()[0].property).toBe(
        "align-left",
      );
    });
  });

  // -----------------------------------------------------------------------
  // Zero-PII guarantees
  // -----------------------------------------------------------------------
  describe("zero-PII invariant", () => {
    it("does not include clip IDs or media paths in any payload", () => {
      propertyEditTelemetry.recordSliderDrag({
        property: "volume",
        category: "audio",
        durationMs: 100,
        sampleCount: 3,
      });

      const entry = propertyEditTelemetry.getRecentEntries()[0];
      const serialized = JSON.stringify(entry);

      // Must not contain anything that could be a clip ID or media path
      expect(serialized).not.toMatch(/clip[_-]?id/i);
      expect(serialized).not.toMatch(/\/Users\//);
      expect(serialized).not.toMatch(/C:\\/);
      expect(serialized).not.toMatch(/\.mp4|\.mov|\.wav|\.mp3/i);
    });

    it("payload contains only telemetry-safe fields", () => {
      propertyEditTelemetry.recordButtonAction({
        action: "align-center-x",
        category: "video",
      });

      const entry = propertyEditTelemetry.getRecentEntries()[0];
      const allowedKeys = new Set([
        "category",
        "property",
        "inputKind",
        "durationMs",
        "sampleCount",
        "direction",
        "action",
        "timestampEpochMs",
      ]);

      for (const key of Object.keys(entry)) {
        expect(allowedKeys.has(key)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Error safety
  // -----------------------------------------------------------------------
  describe("error safety", () => {
    it("does not throw when perfLogService.enqueue throws", () => {
      mockEnqueue.mockImplementationOnce(() => {
        throw new Error("Disk full");
      });

      expect(() => {
        propertyEditTelemetry.recordSliderDrag({
          property: "opacity",
          durationMs: 100,
          sampleCount: 5,
        });
      }).not.toThrow();
    });

    it("still stores to buffer even when perfLogService throws", () => {
      mockEnqueue.mockImplementationOnce(() => {
        throw new Error("Service unavailable");
      });

      propertyEditTelemetry.recordNumericCommit({
        property: "rotation",
        durationMs: 200,
      });

      // Buffer should have the entry despite the service failure
      expect(propertyEditTelemetry.getRecentEntries()).toHaveLength(1);
    });

    it("does not throw when getSessionId returns null (pre-session state)", () => {
      mockGetSessionId.mockReturnValueOnce(null);

      expect(() => {
        propertyEditTelemetry.recordSliderDrag({
          property: "volume",
          durationMs: 50,
          sampleCount: 2,
        });
      }).not.toThrow();

      // Should still fall back to "session"
      const call = mockEnqueue.mock.calls[0][0];
      expect(call.sessionId).toBe("session");
    });
  });

  // -----------------------------------------------------------------------
  // Ring buffer capacity
  // -----------------------------------------------------------------------
  describe("ring buffer", () => {
    it("caps at 100 entries (oldest dropped when full)", () => {
      const collector = new PropertyEditTelemetryCollector();

      for (let i = 0; i < 105; i++) {
        collector.recordButtonAction({ action: `action-${i}`, category: "video" });
      }

      const entries = collector.getRecentEntries();
      expect(entries).toHaveLength(100);
      // The oldest 5 should have been evicted; most recent should be action-104
      expect(entries[99].action).toBe("action-104");
    });

    it("clear() empties the buffer", () => {
      propertyEditTelemetry.recordButtonAction({ action: "test" });
      expect(propertyEditTelemetry.getRecentEntries()).toHaveLength(1);

      propertyEditTelemetry.clear();
      expect(propertyEditTelemetry.getRecentEntries()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Exported singleton
  // -----------------------------------------------------------------------
  describe("singleton", () => {
    it("exports a shared propertyEditTelemetry instance", () => {
      expect(propertyEditTelemetry).toBeInstanceOf(PropertyEditTelemetryCollector);
    });
  });
});
