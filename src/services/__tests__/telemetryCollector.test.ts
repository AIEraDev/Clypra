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
});
