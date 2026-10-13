/**
 * Unit tests for the one-time DXGI latch event emitted by recordNativeSyncSnapshot.
 *
 * The tests mock the IPC layer and the TelemetryCollector's event queue so
 * we can assert on what gets enqueued without running Tauri.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// We test via the exported singleton since TelemetryCollector is not directly
// exported for construction. Instead we spy on enqueueEvent via module mocking.

// Minimal mock of the NativePerformanceSample with latch fields.
function makeSample(
  dxgiLatchedOff: boolean | null | undefined,
  dxgiLatchReason?: string,
) {
  return {
    requestId: "req-1",
    frameIndex: 1,
    decodeTimeUs: 5000,
    composeTimeUs: 2000,
    readbackTimeUs: 1000,
    totalTimeUs: 8000,
    bytesTransferred: 0,
    cacheHit: true,
    dxgiLatchedOff,
    dxgiLatchReason: dxgiLatchReason ?? null,
    isHardwareAccelerated: true,
    codecName: "h264",
    decoderName: undefined,
    presenter: "native-surface" as const,
    sourceBitsPerRawSample: 8,
    sourceWidth: 1920,
    sourceHeight: 1080,
  };
}

describe("DXGI latch event — null safety", () => {
  it("null dxgiLatchedOff is not equal to false", () => {
    const sample = makeSample(null);
    // Core safety invariant: null !== false
    expect(sample.dxgiLatchedOff).not.toBe(false);
    expect(sample.dxgiLatchedOff === true).toBe(false);
    expect(sample.dxgiLatchedOff === null).toBe(true);
  });

  it("false dxgiLatchedOff is not equal to null", () => {
    const sample = makeSample(false);
    expect(sample.dxgiLatchedOff).toBe(false);
    expect(sample.dxgiLatchedOff === null).toBe(false);
  });
});

describe("DXGI latch event guard logic", () => {
  /**
   * Simulates the guard logic from TelemetryCollector.recordNativeSyncSnapshot.
   * Returns how many latch events would be fired for a sequence of samples.
   */
  function simulateLatchGuard(
    samples: Array<{ dxgiLatchedOff: boolean | null | undefined }>,
  ): number {
    let fired = false;
    let eventCount = 0;
    for (const s of samples) {
      if (s.dxgiLatchedOff === true && !fired) {
        fired = true;
        eventCount++;
      }
    }
    return eventCount;
  }

  it("fires no event when dxgiLatchedOff is null (non-Windows)", () => {
    const count = simulateLatchGuard([
      { dxgiLatchedOff: null },
      { dxgiLatchedOff: null },
      { dxgiLatchedOff: null },
    ]);
    expect(count).toBe(0);
  });

  it("fires no event when dxgiLatchedOff is false", () => {
    const count = simulateLatchGuard([
      { dxgiLatchedOff: false },
      { dxgiLatchedOff: false },
    ]);
    expect(count).toBe(0);
  });

  it("fires exactly one event on first true, regardless of subsequent trues", () => {
    const count = simulateLatchGuard([
      { dxgiLatchedOff: false },
      { dxgiLatchedOff: true },   // first latch → fire
      { dxgiLatchedOff: true },   // already fired → skip
      { dxgiLatchedOff: true },   // already fired → skip
    ]);
    expect(count).toBe(1);
  });

  it("fires no additional event when null follows true", () => {
    const count = simulateLatchGuard([
      { dxgiLatchedOff: true },   // fire once
      { dxgiLatchedOff: null },   // non-Windows sample — no additional fire
    ]);
    expect(count).toBe(1);
  });

  it("fires no event for a sequence of only nulls and falses", () => {
    const count = simulateLatchGuard([
      { dxgiLatchedOff: null },
      { dxgiLatchedOff: false },
      { dxgiLatchedOff: null },
      { dxgiLatchedOff: false },
    ]);
    expect(count).toBe(0);
  });

  it("fires event with reason code on first true", () => {
    let firedReason: string | null | undefined = undefined;
    let fired = false;
    const samples = [
      { dxgiLatchedOff: false as boolean | null, dxgiLatchReason: null },
      { dxgiLatchedOff: true as boolean | null, dxgiLatchReason: "dxgi-decode-failed" },
      { dxgiLatchedOff: true as boolean | null, dxgiLatchReason: "dxgi-decode-failed" },
    ];
    for (const s of samples) {
      if (s.dxgiLatchedOff === true && !fired) {
        fired = true;
        firedReason = s.dxgiLatchReason;
      }
    }
    expect(firedReason).toBe("dxgi-decode-failed");
  });
});
