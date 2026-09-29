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

  it("records the adaptive embedded-readback policy on sampled spans", () => {
    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 25_000 },
      1,
      1,
      { nominalFps: 60 },
      "playback",
      undefined,
      0,
      0,
      {
        readbackMaxDimension: 480,
        readbackTier: 1,
        readbackCadenceFps: 20,
        playbackSpeed: 2,
        readbackSourceFrameStride: 3,
      },
    );

    const event = (telemetryCollector as any).queue[0];
    expect(event.workload.targetFps).toBe(60);
    expect(event.workload.readbackMaxDimension).toBe(480);
    expect(event.workload.readbackTier).toBe(1);
    expect(event.workload.readbackCadenceFps).toBe(20);
    expect(event.workload.playbackSpeed).toBe(2);
    expect(event.workload.readbackSourceFrameStride).toBe(3);
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

  it("preserves the native frame transfer path in render telemetry", () => {
    const events: any[] = [];
    const originalEnqueue = (telemetryCollector as any).enqueueEvent.bind(
      telemetryCollector,
    );
    const enqueueSpy = vi
      .spyOn(telemetryCollector as any, "enqueueEvent")
      .mockImplementation((event: unknown) => {
        events.push(event);
        originalEnqueue(event);
      });

    try {
      telemetryCollector.recordNativeSyncSnapshot(
        null,
        {
          lastSample: {
            decodeTimeUs: 4_000,
            composeTimeUs: 3_000,
            readbackTimeUs: 0,
            presentTimeUs: 500,
            totalTimeUs: 25_000,
            transferPath: "dxgi-zero-copy",
          },
        },
        {},
        {
          view: "native",
          surface: "native-surface",
          runtimeEnvironment: "development",
        },
      );

      expect(events[0].workload.renderPath).toBe("dxgi-zero-copy");
    } finally {
      enqueueSpy.mockRestore();
    }
  });

  it("records a cold seek span without inventing stage bottlenecks", () => {
    const events: any[] = [];
    const originalEnqueue = (telemetryCollector as any).enqueueEvent.bind(
      telemetryCollector,
    );
    const enqueueSpy = vi
      .spyOn(telemetryCollector as any, "enqueueEvent")
      .mockImplementation((event: unknown) => {
        events.push(event);
        originalEnqueue(event);
      });

    telemetryCollector.recordSeekSpan(120.5, true, {
      codec: "hevc",
      resolutionBucket: "4k",
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
    expect(events[0].workload.stageTimingsSource).toBe("unattributed");
    expect(events[0].workload.stageTimings).toEqual({ totalTimeUs: 120500 });
    enqueueSpy.mockRestore();
  });

  it("clamps aggregate frame counters to a valid drop ratio", () => {
    const events: any[] = [];
    const originalEnqueue = (telemetryCollector as any).enqueueEvent.bind(
      telemetryCollector,
    );
    const enqueueSpy = vi
      .spyOn(telemetryCollector as any, "enqueueEvent")
      .mockImplementation((event: unknown) => {
        events.push(event);
        originalEnqueue(event);
      });

    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 25_000 },
      80,
      60,
      {},
      "playback",
      undefined,
      80,
      80,
      { forceSample: true },
    );

    expect(events[0].workload.totalFrames).toBe(60);
    expect(events[0].workload.droppedFrames).toBe(60);
    expect(events[0].workload.droppedFramesRatio).toBe(1);
    expect(events[0].workload.staleFrames).toBe(60);
    expect(events[0].workload.cancelledFrames).toBe(60);
    enqueueSpy.mockRestore();
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

  it("records first-play audibility as a durable audio event", () => {
    telemetryCollector.recordAudioStartup({
      sessionId: "audio-startup-session",
      metrics: {
        outcome: "silent-timeout",
        initializationUs: 120_000,
        playCommandUs: 8_000,
        installedClipCount: 2,
        activeClipCount: 1,
        callbackCountDelta: 80,
        nonSilentFramesDelta: 0,
        failureReason: "no-non-silent-native-callback-within-1500ms",
      },
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
    const event = (telemetryCollector as any).queue[0];
    expect(event.subsystem).toBe("audio");
    expect(event.audioMetrics.startup.outcome).toBe("silent-timeout");
    expect(event.workload.droppedFrames).toBe(1);
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
      vendorId: 0x106b,
      deviceId: 0x0001,
      driver: "Metal",
      driverInfo: "Metal 3.1",
      isSoftwareAdapter: false,
    });

    const hw = telemetryCollector.initHardwareContext();
    expect(hw.gpuVendor).toBe("apple");
    expect(hw.gpuModel).toBe("Apple M3 Max");
    expect(hw.graphicsBackend).toBe("metal");
    expect(hw.gpuVendorId).toBe(0x106b);
    expect(hw.gpuDeviceId).toBe(0x0001);
    expect(hw.gpuDriver).toBe("Metal");
    expect(hw.gpuDriverInfo).toBe("Metal 3.1");
    expect(hw.isSoftwareAdapter).toBe(false);
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

  it("aggregates evaluated media stacks into one session-rollup event", () => {
    telemetryCollector.recordCompositionSample({
      sessionId: "composition-session",
      previewContext: {
        sessionId: "composition-session",
        view: "native",
        surface: "native-surface",
        runtimeEnvironment: "development",
        scenario: "playback",
      },
      visualLayerCount: 5,
      mediaLayerCount: 3,
      videoLayerCount: 2,
      imageLayerCount: 1,
      textLayerCount: 1,
      stickerLayerCount: 1,
      activeAudioClipCount: 2,
    });
    telemetryCollector.flushCompositionWindowsIfPending(true);

    const event = (telemetryCollector as any).queue[0];
    expect(event.subsystem).toBe("composition");
    expect(event.compositionMetrics).toMatchObject({
      observedFrames: 1,
      multiStackedFrames: 1,
      maxMediaLayers: 3,
      maxAudioClips: 2,
    });
  });

  it("throttles high-frequency over-budget frame anomalies while tracking throttled counts in rollup", () => {
    // Emit 25 over-budget frames (e.g. 66.4 ms / 66,400 us like in the pathological session)
    for (let i = 0; i < 25; i++) {
      telemetryCollector.recordRenderSpan(
        { decodeUs: 50000, composeUs: 15000, totalTimeUs: 66400 },
        0, // 0 dropped frames
        1,
        { codec: "hevc", resolutionBucket: "4k", nominalFps: 60 },
        "playback",
      );
    }

    // Individual sample events are capped at MAX_LATENCY_ANOMALIES_PER_MINUTE (10)
    expect(telemetryCollector.getQueueLength()).toBe(10);
    // Suppressed frames are counted in the accumulator (25 - 10 = 15)
    expect(telemetryCollector.getThrottledAnomaliesCount()).toBe(15);

    // Force flush the rollup
    telemetryCollector.flushRollupIfPending();

    // The rollup event is appended to the queue
    const queue = (telemetryCollector as any).queue;
    const rollupEvent = queue[queue.length - 1];
    expect(rollupEvent.sampleKind).toBe("window-rollup");
    expect(rollupEvent.workload.totalFrames).toBe(25);
    expect(rollupEvent.workload.throttledAnomaliesCount).toBe(15);
    expect(
      rollupEvent.workload.stageTimings.totalTimeUs,
    ).toBeGreaterThanOrEqual(66400);
  });

  it("permits peak outliers that significantly exceed previous peak latency even after quota is filled", () => {
    // Fill the latency anomaly quota with 10 frames at 25,000 us
    for (let i = 0; i < 10; i++) {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 25000 },
        0,
        1,
        {},
        "playback",
      );
    }
    expect(telemetryCollector.getQueueLength()).toBe(10);

    // A slightly worse frame (26,000 us, < 25% higher) is throttled
    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 26000 },
      0,
      1,
      {},
      "playback",
    );
    expect(telemetryCollector.getQueueLength()).toBe(10);

    // A significant peak outlier (40,000 us, > 25% higher than 25,000 us) is permitted
    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 40000 },
      0,
      1,
      {},
      "playback",
    );
    expect(telemetryCollector.getQueueLength()).toBe(11);
    const lastEvent = (telemetryCollector as any).queue[10];
    expect(lastEvent.workload.stageTimings.totalTimeUs).toBe(40000);
  });

  it("maintains separate quota for dropped frames even after latency quota is exhausted", () => {
    // Fill the latency-only anomaly quota
    for (let i = 0; i < 10; i++) {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 25000 },
        0,
        1,
        {},
        "playback",
      );
    }
    expect(telemetryCollector.getQueueLength()).toBe(10);

    // An eleventh latency-only anomaly is throttled
    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 25000 },
      0,
      1,
      {},
      "playback",
    );
    expect(telemetryCollector.getQueueLength()).toBe(10);

    // A frame with a dropped frame has its own quota and is sampled
    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 20000 },
      1, // 1 dropped frame
      1,
      {},
      "playback",
    );
    expect(telemetryCollector.getQueueLength()).toBe(11);
    const dropEvent = (telemetryCollector as any).queue[10];
    expect(dropEvent.workload.droppedFrames).toBe(1);
  });

  it("throttles continuous intermediate scrub drag interactions but preserves settled scrub", () => {
    // 1st intermediate scrub interaction is emitted
    telemetryCollector.recordPreviewInteraction({
      interaction: {
        id: "scrub-int-1",
        name: "scrub",
        outcome: "superseded",
      },
      totalTimeUs: 50000,
    });
    expect(telemetryCollector.getQueueLength()).toBe(1);

    // Immediate 2nd intermediate scrub interaction (<500ms) is throttled
    telemetryCollector.recordPreviewInteraction({
      interaction: {
        id: "scrub-int-2",
        name: "scrub",
        outcome: "superseded",
      },
      totalTimeUs: 55000,
    });
    expect(telemetryCollector.getQueueLength()).toBe(1);

    // Settled scrub interaction (outcome: "completed") is always emitted
    telemetryCollector.recordPreviewInteraction({
      interaction: {
        id: "scrub-int-3",
        name: "scrub",
        outcome: "completed",
      },
      totalTimeUs: 60000,
    });
    expect(telemetryCollector.getQueueLength()).toBe(2);
  });

  it("bypasses throttling in qualification benchmark scenario", () => {
    // Emit 20 frames with qualification scenario and forceSample
    for (let i = 0; i < 20; i++) {
      telemetryCollector.recordRenderSpan(
        { totalTimeUs: 50000 },
        0,
        1,
        {},
        "playback",
        undefined,
        0,
        0,
        {
          previewContext: {
            view: "native",
            surface: "native-surface",
            runtimeEnvironment: "production",
            scenario: "qualification",
          },
          forceSample: true,
        },
      );
    }

    // All 20 are enqueued without throttling
    expect(telemetryCollector.getQueueLength()).toBe(20);
  });
});
