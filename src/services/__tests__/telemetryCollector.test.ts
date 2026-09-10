import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { telemetryCollector } from "../telemetryCollector";

describe("Production Telemetry Collector in Clypra Desktop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    telemetryCollector.clearQueue();
    telemetryCollector.setEnabled(true);
  });

  afterEach(() => {
    telemetryCollector.clearQueue();
  });

  it("probes device hardware context safely", () => {
    const hw = telemetryCollector.initHardwareContext();
    expect(hw).toBeDefined();
    expect(hw.osFamily).toBeDefined();
    expect(hw.cpuArch).toBeDefined();
    expect(hw.graphicsBackend).toBeDefined();
    expect(hw.displayDpr).toBeGreaterThanOrEqual(1.0);
  });

  it("records a render span with dropped frame anomaly at 100% sampling rate", () => {
    telemetryCollector.recordRenderSpan(
      { decodeUs: 18000, composeUs: 6000, totalTimeUs: 25000 },
      10, // 10 dropped frames
      60, // 60 total frames -> >5% dropped frames
      { codec: "hevc", resolutionBucket: "4k", nominalFps: 60 },
    );

    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("does not enqueue the same native stats sample twice", () => {
    const nativeRender = {
      lastSample: {
        requestId: "request-1",
        frameIndex: 42,
        decodeTimeUs: 4000,
        composeTimeUs: 3000,
        readbackTimeUs: 1000,
        presentTimeUs: 500,
        totalTimeUs: 25000,
      },
      windowDroppedFrames: 0,
      windowStaleFrames: 0,
      windowCancelledFrames: 0,
    };

    telemetryCollector.recordNativeSyncSnapshot(
      null,
      nativeRender,
      {},
      {
        view: "native",
        surface: "native-surface",
        runtimeEnvironment: "development",
      },
      "sequence:1:request-1:42",
    );
    telemetryCollector.recordNativeSyncSnapshot(
      null,
      nativeRender,
      {},
      {
        view: "native",
        surface: "native-surface",
        runtimeEnvironment: "development",
      },
      "sequence:1:request-1:42",
    );

    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("records a cold seek span and enqueues event", () => {
    telemetryCollector.recordSeekSpan(120.5, true, {
      codec: "hevc",
      resolutionBucket: "4k",
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("records a hardware fallback event and enqueues it for session-file upload", () => {
    // recordFallbackEvent enqueues the event then immediately calls flush(),
    // which drains this.queue to 0 (the event was already forwarded to
    // perfLogService.enqueue() inside enqueueEvent before the drain).
    // Capture the event via a spy on the internal enqueueEvent path.
    const enqueuedEvents: unknown[] = [];
    const originalEnqueue = (telemetryCollector as any).enqueueEvent.bind(
      telemetryCollector,
    );
    vi.spyOn(telemetryCollector as any, "enqueueEvent").mockImplementation(
      (event: unknown) => {
        enqueuedEvents.push(event);
        originalEnqueue(event);
      },
    );

    telemetryCollector.recordFallbackEvent(
      "webgpu",
      "webgl2",
      "GPUAdapterNotFoundError",
      "Error: Adapter not found",
    );

    // Exactly one event was enqueued …
    expect(enqueuedEvents).toHaveLength(1);

    // … and it carries the correct fallback payload.
    const event = enqueuedEvents[0] as any;
    expect(event.fallbackEvent.triggered).toBe(true);
    expect(event.fallbackEvent.fromBackend).toBe("webgpu");
    expect(event.fallbackEvent.toBackend).toBe("webgl2");
    expect(event.fallbackEvent.reasonCode).toBe("GPUAdapterNotFoundError");

    // Queue is 0 because flush() was called immediately (high-priority).
    expect(telemetryCollector.getQueueLength()).toBe(0);

    // No network fetch — data goes to the session NDJSON file via perfLogService.
    expect(
      vi.isMockFunction(globalThis.fetch)
        ? (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length
        : 0,
    ).toBe(0);
  });

  it("respects enabled flag and stops enqueuing when disabled", () => {
    telemetryCollector.setEnabled(false);
    telemetryCollector.recordRenderSpan({ totalTimeUs: 30000 }, 20, 60);

    expect(telemetryCollector.getQueueLength()).toBe(0);
  });

  it("flushes bounded queue cleanly via flush()", async () => {
    telemetryCollector.recordRenderSpan({ totalTimeUs: 25000 }, 10, 60);
    expect(telemetryCollector.getQueueLength()).toBe(1);

    // flush() drains the in-memory queue (data was already forwarded to
    // perfLogService.enqueue() inside enqueueEvent). No fetch() is made.
    const success = await telemetryCollector.flush();
    expect(success).toBe(true);
    expect(telemetryCollector.getQueueLength()).toBe(0);
  });

  it("records an export span with accurate RTF and throughput", () => {
    telemetryCollector.recordExportSpan({
      exportDurationMs: 4500,
      mediaDurationMs: 9000,
      totalFrames: 270,
      exportFps: 60.0,
      realTimeFactor: 0.5,
      renderTimeUs: 2700000,
      encodeTimeUs: 1800000,
      peakRamMb: 1024,
      success: true,
      videoProfile: {
        width: 3840,
        height: 2160,
        nominalFps: 60,
        codec: "hevc",
      },
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("records one idempotent audio health window with backend stage data", () => {
    telemetryCollector.recordAudioSnapshot({
      sessionId: "audio-session-1",
      windowStartMs: 1000,
      backend: "web-audio",
      runtimeEnvironment: "development",
      windowDurationMs: 5000,
      syncCalls: 300,
      playingSyncCalls: 300,
      callbackCount: 300,
      renderedFrames: 300,
      underruns: 2,
      bufferHits: 295,
      bufferMisses: 5,
      bufferHitRatio: 295 / 300,
      stageTimings: { totalTimeUs: 1_500_000 },
    });
    telemetryCollector.recordAudioSnapshot({
      sessionId: "audio-session-1",
      windowStartMs: 1000,
      backend: "web-audio",
      runtimeEnvironment: "development",
      windowDurationMs: 5000,
      callbackCount: 300,
      renderedFrames: 300,
      stageTimings: { totalTimeUs: 1_500_000 },
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("records AI inference tasks like whisper and auto-reframe", () => {
    telemetryCollector.recordAIInferenceSpan(
      "whisper-captions",
      320,
      0,
      0.25,
      true,
    );
    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("updates hardware context from native Tauri GPU status", () => {
    telemetryCollector.updateFromNativeGpu({
      adapterName: "Apple M3 Max",
      backend: "Metal",
      deviceType: "IntegratedGpu",
    });

    const hw = telemetryCollector.initHardwareContext();
    expect(hw.gpuVendor).toBe("apple");
    expect(hw.gpuModel).toBe("Apple M3 Max");
    expect(hw.graphicsBackend).toBe("metal");
  });

  it("sanitizes video profile to coarse buckets without leaking file paths or user titles", () => {
    const sanitized = telemetryCollector.sanitizeVideoProfile({
      width: 3840,
      height: 2160,
      codec: "hevc",
    });

    expect(sanitized.resolutionBucket).toBe("4k");
    expect(sanitized.codec).toBe("hevc");
    expect((sanitized as any).filePath).toBeUndefined();
    expect((sanitized as any).projectTitle).toBeUndefined();
  });

  it("emits session rollup after accumulating continuous frame activity", () => {
    // Record multiple smooth frames
    for (let i = 0; i < 5; i++) {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 14000, decodeUs: 5000, composeUs: 4000 },
        0,
        60,
        { resolutionBucket: "4k", codec: "hevc" },
        "playback",
        2.5,
      );
    }

    // Force rollup flush
    telemetryCollector.flushRollupIfPending();
    expect(telemetryCollector.getQueueLength()).toBeGreaterThanOrEqual(1);
  });

  it("records text interaction telemetry and mirrors stagePercentiles from interactionStagePercentiles", () => {
    telemetryCollector.recordTextInteraction({
      kind: "plain",
      rendererPath: "studio-preview",
      operation: "content-edit",
      property: "content",
      durationUs: 45000,
      interactionId: "test-edit-1",
      renderCount: 3,
      stageCoverage: "complete",
      unattributedTimeUs: 0,
      stageTimings: {
        rasterUs: 5000,
        paintUs: 1200,
        totalTimeUs: 6500,
      },
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
    const event = (telemetryCollector as any).queue[0];
    expect(event.subsystem).toBe("text");
    expect(event.sampleKind).toBe("interaction");
    expect(event.textMetrics.stageCoverage).toBe("complete");
    expect(event.textMetrics.unattributedTimeUs).toBe(0);
    expect(event.textMetrics.interactionStagePercentiles.rasterUs).toEqual({
      p50: 5000,
      p95: 5000,
      p99: 5000,
    });
    expect(event.textMetrics.stagePercentiles).toEqual(
      event.textMetrics.interactionStagePercentiles,
    );
  });

  it("records canvas drag text interaction with unattributed stage coverage", () => {
    telemetryCollector.recordTextInteraction({
      kind: "plain",
      rendererPath: "studio-preview",
      operation: "transform",
      property: "transform",
      durationUs: 150000,
      interactionId: "test-drag-1",
      renderCount: 0,
      stageCoverage: "unattributed",
      unattributedTimeUs: 150000,
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
    const event = (telemetryCollector as any).queue[0];
    expect(event.textMetrics.operation).toBe("transform");
    expect(event.textMetrics.stageCoverage).toBe("unattributed");
    expect(event.textMetrics.unattributedTimeUs).toBe(150000);
    expect(event.textMetrics.stagePercentiles).toEqual({});
    expect(event.textMetrics.interactionStagePercentiles).toEqual({});
  });
});
