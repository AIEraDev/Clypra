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
      { codec: "hevc", resolutionBucket: "4k", nominalFps: 60 }
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

  it("records a hardware fallback event and dispatches batch immediately", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 202,
    } as any);

    telemetryCollector.recordFallbackEvent(
      "webgpu",
      "webgl2",
      "GPUAdapterNotFoundError",
      "Error: Adapter not found"
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("/performance/telemetry/ingest/batch");
    expect((options as any).method).toBe("POST");
    expect((options as any).headers["X-Clypra-Client"]).toBe("tauri-desktop");

    const parsedBody = JSON.parse((options as any).body);
    expect(parsedBody.events.length).toBe(1);
    expect(parsedBody.events[0].fallbackEvent.reasonCode).toBe("GPUAdapterNotFoundError");
  });

  it("respects enabled flag and stops enqueuing when disabled", () => {
    telemetryCollector.setEnabled(false);
    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 30000 },
      20,
      60
    );

    expect(telemetryCollector.getQueueLength()).toBe(0);
  });

  it("flushes bounded queue cleanly via flush()", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 202,
    } as any);

    telemetryCollector.recordRenderSpan(
      { totalTimeUs: 25000 },
      10,
      60
    );
    expect(telemetryCollector.getQueueLength()).toBe(1);

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
      videoProfile: { width: 3840, height: 2160, nominalFps: 60, codec: "hevc" },
    });

    expect(telemetryCollector.getQueueLength()).toBe(1);
  });

  it("records AI inference tasks like whisper and auto-reframe", () => {
    telemetryCollector.recordAIInferenceSpan("whisper-captions", 320, 0, 0.25, true);
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
        2.5
      );
    }

    // Force rollup flush
    telemetryCollector.flushRollupIfPending();
    expect(telemetryCollector.getQueueLength()).toBeGreaterThanOrEqual(1);
  });
});
