/**
 * Integration test — full media animation telemetry lifecycle.
 *
 * Simulates a complete session: cache hydration → catalog fetch → manifest
 * download → animation eval → rollup flush → PII audit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock perfLogService before importing modules under test.
vi.mock("@/services/perfLogService", () => ({
  perfLogService: {
    getSessionId: vi.fn(() => "test-session-id"),
    enqueue: vi.fn(),
  },
}));

import { perfLogService } from "@/services/perfLogService";
import { MediaAnimationTelemetry } from "../mediaAnimationTelemetry";
import { MediaAnimationRollupCollector } from "../mediaAnimationRollup";

const mockEnqueue = perfLogService.enqueue as ReturnType<typeof vi.fn>;

describe("MediaAnimationTelemetry integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (perfLogService.getSessionId as ReturnType<typeof vi.fn>).mockReturnValue(
      "test-session-id",
    );
  });

  it("step 2 — recordCacheHydration enqueues correct entry", () => {
    MediaAnimationTelemetry.recordCacheHydration({
      durationMs: 50,
      manifestCount: 5,
      indexEntryCount: 5,
      errorCount: 0,
      fromDiskCount: 5,
    });

    const entry = mockEnqueue.mock.calls[0]?.[0];
    expect(entry.kind).toBe("media-animation-cache-hydration");
    expect(entry.sessionId).toBe("test-session-id");
    expect(entry.payload.durationMs).toBe(50);
    expect(entry.payload.manifestCount).toBe(5);
    expect(entry.payload.indexEntryCount).toBe(5);
    expect(entry.payload.errorCount).toBe(0);
    expect(entry.payload.fromDiskCount).toBe(5);
  });

  it("step 3 — recordCatalogFetch enqueues correct entry", () => {
    MediaAnimationTelemetry.recordCatalogFetch({
      category: "in",
      durationMs: 120,
      presetCount: 8,
      status: "success",
      httpStatus: 200,
    });

    const entry = mockEnqueue.mock.calls[0]?.[0];
    expect(entry.kind).toBe("media-animation-catalog-fetch");
    expect(entry.sessionId).toBe("test-session-id");
    expect(entry.payload.category).toBe("in");
    expect(entry.payload.durationMs).toBe(120);
    expect(entry.payload.presetCount).toBe(8);
    expect(entry.payload.status).toBe("success");
    expect(entry.payload.httpStatus).toBe(200);
  });

  it("step 4 — recordManifestDownload enqueues correct entry", () => {
    MediaAnimationTelemetry.recordManifestDownload({
      slug: "slide-in-left",
      cacheHit: false,
      durationMs: 210,
      sizeBytes: 4096,
      fetchDurationMs: 200,
      writeDurationMs: 10,
      status: "success",
    });

    const entry = mockEnqueue.mock.calls[0]?.[0];
    expect(entry.kind).toBe("media-animation-download");
    expect(entry.sessionId).toBe("test-session-id");
    expect(entry.payload.slug).toBe("slide-in-left");
    expect(entry.payload.cacheHit).toBe(false);
    expect(entry.payload.durationMs).toBe(210);
    expect(entry.payload.sizeBytes).toBe(4096);
    expect(entry.payload.status).toBe("success");
  });

  it("step 5 — recordAnimationEval enqueues correct entry", () => {
    MediaAnimationTelemetry.recordAnimationEval({
      durationMs: 3,
      clipType: "video",
      presetId: "slide-in-left",
      trackCount: 2,
      keyframeCount: 10,
    });

    const entry = mockEnqueue.mock.calls[0]?.[0];
    expect(entry.kind).toBe("animation-eval");
    expect(entry.sessionId).toBe("test-session-id");
    expect(entry.payload.durationMs).toBe(3);
    expect(entry.payload.clipType).toBe("video");
    expect(entry.payload.presetId).toBe("slide-in-left");
    expect(entry.payload.trackCount).toBe(2);
    expect(entry.payload.keyframeCount).toBe(10);
  });

  it("step 6 — rollup flush produces media-animation-rollup entry", () => {
    const freshCollector = new MediaAnimationRollupCollector();
    freshCollector.recordCatalogFetch("in", 100, false);
    freshCollector.recordDownload(true, 5, 2048, false);
    freshCollector.recordAnimationEval(3, 2);
    freshCollector.recordHydration(5, 50);

    const summary = freshCollector.flush();

    // Manually simulate what perfLogService would do
    perfLogService.enqueue({
      kind: "media-animation-rollup",
      sessionId: "test-session-id",
      timestampEpochMs: Date.now(),
      payload: summary,
    });

    const entry = mockEnqueue.mock.calls[0]?.[0];
    expect(entry.kind).toBe("media-animation-rollup");
    expect(entry.payload.catalogFetches.count).toBe(1);
  });

  it("step 7 — all 4 telemetry methods + rollup produce 5 distinct kind values", () => {
    MediaAnimationTelemetry.recordCacheHydration({
      durationMs: 50,
      manifestCount: 5,
      indexEntryCount: 5,
      errorCount: 0,
      fromDiskCount: 5,
    });
    MediaAnimationTelemetry.recordCatalogFetch({
      category: "in",
      durationMs: 120,
      presetCount: 8,
      status: "success",
      httpStatus: 200,
    });
    MediaAnimationTelemetry.recordManifestDownload({
      slug: "slide-in-left",
      cacheHit: false,
      durationMs: 210,
      sizeBytes: 4096,
      fetchDurationMs: 200,
      writeDurationMs: 10,
      status: "success",
    });
    MediaAnimationTelemetry.recordAnimationEval({
      durationMs: 3,
      clipType: "video",
      presetId: "slide-in-left",
      trackCount: 2,
      keyframeCount: 10,
    });

    // Rollup entry
    const freshCollector = new MediaAnimationRollupCollector();
    freshCollector.recordCatalogFetch("in", 100, false);
    const summary = freshCollector.flush();
    perfLogService.enqueue({
      kind: "media-animation-rollup",
      sessionId: "test-session-id",
      timestampEpochMs: Date.now(),
      payload: summary,
    });

    const kinds = new Set(
      mockEnqueue.mock.calls.map(
        (call: unknown[]) => (call[0] as { kind: string }).kind,
      ),
    );
    expect(kinds.size).toBe(5);
    expect(kinds.has("media-animation-cache-hydration")).toBe(true);
    expect(kinds.has("media-animation-catalog-fetch")).toBe(true);
    expect(kinds.has("media-animation-download")).toBe(true);
    expect(kinds.has("animation-eval")).toBe(true);
    expect(kinds.has("media-animation-rollup")).toBe(true);
  });

  it("step 8 — no PII: no file paths, no clipId, no userId in payloads", () => {
    MediaAnimationTelemetry.recordCacheHydration({
      durationMs: 50,
      manifestCount: 5,
      indexEntryCount: 5,
      errorCount: 0,
      fromDiskCount: 5,
    });
    MediaAnimationTelemetry.recordCatalogFetch({
      category: "in",
      durationMs: 120,
      presetCount: 8,
      status: "success",
      httpStatus: 200,
    });
    MediaAnimationTelemetry.recordManifestDownload({
      slug: "slide-in-left",
      cacheHit: false,
      durationMs: 210,
      sizeBytes: 4096,
      fetchDurationMs: 200,
      writeDurationMs: 10,
      status: "success",
    });
    MediaAnimationTelemetry.recordAnimationEval({
      durationMs: 3,
      clipType: "video",
      presetId: "slide-in-left",
      trackCount: 2,
      keyframeCount: 10,
    });

    for (const call of mockEnqueue.mock.calls as Array<
      [{ payload: Record<string, unknown> }]
    >) {
      const payload = call[0].payload;

      // No string payload values at depth 1 should contain "/"
      for (const [key, value] of Object.entries(payload)) {
        if (typeof value === "string") {
          expect(
            value.includes("/"),
            `Payload field "${key}" contains "/" (possible file path): "${value}"`,
          ).toBe(false);
        }
      }

      // No clipId or userId fields
      expect(Object.keys(payload)).not.toContain("clipId");
      expect(Object.keys(payload)).not.toContain("userId");
    }
  });
});
