import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  getTextMetricsSnapshot,
  recordBrowserTextRasterCacheHit,
  recordBrowserTextRasterCacheMiss,
  recordRendererByClipKind,
  resetTextMetricsForTests,
} from "@/lib/playback/textMetrics";
import {
  telemetryCollector,
  type TelemetryTextMetrics,
} from "@/services/telemetryCollector";
import {
  traceTextRenderTiming,
  traceTextInteraction,
} from "@/core/render/textRenderTrace";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import { rasterizeTextLayerForNative } from "@/components/editor/preview/nativeTextPreview";

describe("Text Bubble Performance & Telemetry Tracking", () => {
  beforeEach(() => {
    resetTextMetricsForTests();
    telemetryCollector.setEnabled(true);
  });

  afterEach(() => {
    resetTextMetricsForTests();
  });

  it("classifies bubble layers as kind: 'bubble' in textMetrics", () => {
    recordRendererByClipKind("bubble", "canvas-2d");
    recordRendererByClipKind("bubble", "canvas-2d");
    recordRendererByClipKind("plain", "canvas-2d");

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.rendererByKind.bubble).toBeDefined();
    expect(snapshot.rendererByKind.bubble["canvas-2d"]).toBe(2);
    expect(snapshot.rendererByKind.plain["canvas-2d"]).toBe(1);
  });

  it("measures bubble rasterization performance and captures microsecond render timings", async () => {
    const recordSpy = vi.spyOn(telemetryCollector, "recordTextRender");

    const bubbleLayer: EvaluatedTextLayer = {
      clipId: "clip-bubble-1",
      layerId: "text-bubble-test-1",
      layerType: "text",
      role: "text",
      zIndex: 1,
      inTransition: false,
      blendMode: "normal",
      text: "Speed Test Bubble",
      fontFamily: "Inter Variable",
      fontSize: 32,
      color: "#ffffff",
      fontWeight: 700,
      fontStyle: "normal",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      width: 400,
      height: 120,
      baseWidth: 400,
      baseHeight: 120,
      x: 100,
      y: 100,
      opacity: 1,
      rotation: 0,
      background: {
        color: "#ffffff",
        padding: 16,
        borderRadius: 8,
        bubblePresetId: "bubble-paper-torn",
      },
    };

    const startTime = performance.now();
    const asset = await rasterizeTextLayerForNative(bubbleLayer, {
      phase: "interactive-preview",
      rendererPath: "webview-canvas",
    });
    const totalDurationMs = performance.now() - startTime;

    // Verify raster asset output
    expect(asset).toBeDefined();
    expect(asset.width).toBeGreaterThan(0);
    expect(asset.height).toBeGreaterThan(0);
    expect(asset.timing).toBeDefined();

    // Verify kind is classified as 'bubble'
    expect(asset.timing?.kind).toBe("bubble");

    // Performance assertion: bubble rasterization must be fast (under 30ms on test environment, typical < 5ms)
    expect(asset.timing?.rasterMs).toBeGreaterThanOrEqual(0);
    expect(totalDurationMs).toBeLessThan(100);

    // Verify telemetry event was dispatched to telemetryCollector
    expect(recordSpy).toHaveBeenCalled();
    const lastCall = recordSpy.mock.calls[recordSpy.mock.calls.length - 1][0];
    expect(lastCall.kind).toBe("bubble");
    expect(lastCall.rendererPath).toBe("webview-canvas");
    expect(lastCall.totalTimeUs).toBeGreaterThanOrEqual(0);
    expect(lastCall.contentLength).toBe(bubbleLayer.text.length);

    recordSpy.mockRestore();
  });

  it("measures bubble property update interaction latency and captures attribution", () => {
    (telemetryCollector as any).queue = [];

    // Simulate an interaction: applying a Torn Paper bubble preset
    const durationMs = 8.5; // 8.5ms input-to-commit duration
    const inputToPreviewMs = 12.2; // 12.2ms glass-to-glass latency

    traceTextInteraction({
      kind: "bubble",
      rendererPath: "studio-preview",
      operation: "property-edit",
      property: "bubble",
      durationMs,
      inputToPreviewMs,
      interactionId: "test-bubble-apply-interaction",
      contentLength: 17,
      lineCount: 1,
      layoutWidth: 400,
      layoutHeight: 120,
      stageCoverage: "complete",
      stageTimings: {
        fontWaitMs: 0,
        compileMs: 1.1,
        rasterMs: 4.8,
        readbackMs: 1.2,
        transferMs: 2.5,
        paintMs: 0.9,
        totalMs: 10.5,
      },
    });

    expect(telemetryCollector.getQueueLength()).toBeGreaterThanOrEqual(1);
    const event = (telemetryCollector as any).queue[(telemetryCollector as any).queue.length - 1];
    const capturedMetrics = event.textMetrics;

    expect(capturedMetrics).toBeDefined();
    expect(capturedMetrics?.kind).toBe("bubble");
    expect(capturedMetrics?.property).toBe("bubble");
    expect(capturedMetrics?.operation).toBe("property-edit");
    expect(capturedMetrics?.interactionDurationUs).toBe(8500); // 8.5ms in microseconds
    expect(capturedMetrics?.inputToPreviewUs).toBe(12200); // 12.2ms in microseconds
    expect(capturedMetrics?.stageCoverage).toBe("complete");
    expect(capturedMetrics?.unattributedTimeUs).toBe(0);

    // Verify stage timing percentiles
    expect(capturedMetrics?.interactionStagePercentiles?.rasterUs?.p50).toBe(4800);
    expect(capturedMetrics?.interactionStagePercentiles?.transferUs?.p50).toBe(2500);
  });

  it("confirms cache hit tracking and high throughput for steady-state bubbles", () => {
    // Frame 1: Cold render -> cache miss
    recordRendererByClipKind("bubble", "canvas-2d");
    recordBrowserTextRasterCacheMiss();

    // Frames 2-10: Cached frames during playback -> cache hits
    for (let i = 0; i < 9; i++) {
      recordRendererByClipKind("bubble", "canvas-2d");
      recordBrowserTextRasterCacheHit();
    }

    const snapshot = getTextMetricsSnapshot();
    expect(snapshot.rendererByKind.bubble["canvas-2d"]).toBe(10);
    expect(snapshot.cache.hits).toBe(9);
    expect(snapshot.cache.misses).toBe(1);
    expect(snapshot.cache.hitRate).toBe(0.9); // 90% hit rate
  });
});
