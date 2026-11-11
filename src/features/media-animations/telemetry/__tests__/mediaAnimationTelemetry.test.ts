/**
 * Unit tests for MediaAnimationTelemetry static methods.
 *
 * Verifies that each method forwards the correct kind, sessionId, and payload
 * to perfLogService.enqueue, and that none of them throw when enqueue throws.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock perfLogService before importing the module under test.
vi.mock("@/services/perfLogService", () => ({
  perfLogService: {
    getSessionId: vi.fn(() => "test-session-123"),
    enqueue: vi.fn(),
  },
}));

import { perfLogService } from "@/services/perfLogService";
import { MediaAnimationTelemetry } from "../mediaAnimationTelemetry";

const mockEnqueue = perfLogService.enqueue as ReturnType<typeof vi.fn>;
const mockGetSessionId = perfLogService.getSessionId as ReturnType<typeof vi.fn>;

describe("MediaAnimationTelemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionId.mockReturnValue("test-session-123");
  });

  describe("recordCatalogFetch", () => {
    it("enqueues entry with kind media-animation-catalog-fetch", () => {
      MediaAnimationTelemetry.recordCatalogFetch({
        category: "in",
        durationMs: 120,
        presetCount: 8,
        status: "success",
        httpStatus: 200,
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.kind).toBe("media-animation-catalog-fetch");
      expect(entry.sessionId).toBe("test-session-123");
      expect(entry.timestampEpochMs).toBeTypeOf("number");
      expect(entry.payload).toMatchObject({
        category: "in",
        durationMs: 120,
        presetCount: 8,
        status: "success",
        httpStatus: 200,
      });
    });

    it("forwards error status and error message", () => {
      MediaAnimationTelemetry.recordCatalogFetch({
        category: "out",
        durationMs: 300,
        presetCount: 0,
        status: "error",
        error: "Network timeout",
      });

      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.payload.status).toBe("error");
      expect(entry.payload.error).toBe("Network timeout");
      expect(entry.payload.category).toBe("out");
    });

    it("uses 'unknown' sessionId when getSessionId returns null", () => {
      mockGetSessionId.mockReturnValue(null);
      MediaAnimationTelemetry.recordCatalogFetch({
        category: "combo",
        durationMs: 50,
        presetCount: 3,
        status: "success",
      });

      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.sessionId).toBe("unknown");
    });

    it("does not throw when enqueue throws", () => {
      mockEnqueue.mockImplementation(() => {
        throw new Error("Service unavailable");
      });

      expect(() =>
        MediaAnimationTelemetry.recordCatalogFetch({
          category: "in",
          durationMs: 10,
          presetCount: 0,
          status: "error",
        }),
      ).not.toThrow();
    });
  });

  describe("recordManifestDownload", () => {
    it("enqueues entry with kind media-animation-download", () => {
      MediaAnimationTelemetry.recordManifestDownload({
        slug: "slide-in-left",
        cacheHit: false,
        durationMs: 210,
        sizeBytes: 4096,
        fetchDurationMs: 200,
        writeDurationMs: 10,
        status: "success",
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.kind).toBe("media-animation-download");
      expect(entry.sessionId).toBe("test-session-123");
      expect(entry.payload).toMatchObject({
        slug: "slide-in-left",
        cacheHit: false,
        durationMs: 210,
        sizeBytes: 4096,
        status: "success",
      });
    });

    it("forwards cache-hit payload with sha256VerifyMs", () => {
      MediaAnimationTelemetry.recordManifestDownload({
        slug: "fade-out",
        cacheHit: true,
        durationMs: 5,
        sizeBytes: 2048,
        sha256VerifyMs: 5,
        status: "success",
      });

      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.payload.cacheHit).toBe(true);
      expect(entry.payload.sha256VerifyMs).toBe(5);
    });

    it("does not throw when enqueue throws", () => {
      mockEnqueue.mockImplementation(() => {
        throw new Error("disk full");
      });

      expect(() =>
        MediaAnimationTelemetry.recordManifestDownload({
          slug: "slide-in-left",
          cacheHit: false,
          durationMs: 0,
          sizeBytes: 0,
          status: "error",
          error: "disk full",
        }),
      ).not.toThrow();
    });
  });

  describe("recordCacheHydration", () => {
    it("enqueues entry with kind media-animation-cache-hydration", () => {
      MediaAnimationTelemetry.recordCacheHydration({
        durationMs: 50,
        manifestCount: 5,
        indexEntryCount: 5,
        errorCount: 0,
        fromDiskCount: 5,
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.kind).toBe("media-animation-cache-hydration");
      expect(entry.sessionId).toBe("test-session-123");
      expect(entry.payload).toMatchObject({
        durationMs: 50,
        manifestCount: 5,
        indexEntryCount: 5,
        errorCount: 0,
        fromDiskCount: 5,
      });
    });

    it("does not throw when enqueue throws", () => {
      mockEnqueue.mockImplementation(() => {
        throw new Error("no session");
      });

      expect(() =>
        MediaAnimationTelemetry.recordCacheHydration({
          durationMs: 0,
          manifestCount: 0,
          indexEntryCount: 0,
          errorCount: 0,
          fromDiskCount: 0,
        }),
      ).not.toThrow();
    });
  });

  describe("recordAnimationEval", () => {
    it("enqueues entry with kind animation-eval", () => {
      MediaAnimationTelemetry.recordAnimationEval({
        durationMs: 3,
        clipType: "video",
        presetId: "slide-in-left",
        trackCount: 2,
        keyframeCount: 10,
      });

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.kind).toBe("animation-eval");
      expect(entry.sessionId).toBe("test-session-123");
      expect(entry.payload).toMatchObject({
        durationMs: 3,
        clipType: "video",
        presetId: "slide-in-left",
        trackCount: 2,
        keyframeCount: 10,
      });
    });

    it("forwards entries without presetId", () => {
      MediaAnimationTelemetry.recordAnimationEval({
        durationMs: 1,
        clipType: "image",
        trackCount: 0,
        keyframeCount: 0,
      });

      const entry = mockEnqueue.mock.calls[0][0];
      expect(entry.payload.presetId).toBeUndefined();
      expect(entry.payload.clipType).toBe("image");
    });

    it("does not throw when enqueue throws", () => {
      mockEnqueue.mockImplementation(() => {
        throw new Error("oops");
      });

      expect(() =>
        MediaAnimationTelemetry.recordAnimationEval({
          durationMs: 0,
          clipType: "video",
          trackCount: 0,
          keyframeCount: 0,
        }),
      ).not.toThrow();
    });
  });
});
