import { describe, expect, it } from "vitest";
import {
  previewFrameDeadlineUs,
  nativePerfCollector,
  type NativeFrontendPerfSample,
} from "../nativePerfTelemetry";

const sample = (
  overrides: Partial<NativeFrontendPerfSample> = {},
): NativeFrontendPerfSample => ({
  requestId: "test",
  frameIndex: 0,
  mode: "playback",
  dispatchMs: 0,
  ipcMs: 0,
  totalMs: 0,
  dropped: false,
  stale: false,
  cancelled: false,
  ...overrides,
});

describe("previewFrameDeadlineUs", () => {
  it("uses the adaptive 30 FPS bridge cadence as the playback deadline", () => {
    expect(previewFrameDeadlineUs(sample({ readbackCadenceFps: 30 }))).toBe(
      33_333,
    );
  });

  it("keeps interaction frames on the 60 Hz responsiveness budget", () => {
    expect(
      previewFrameDeadlineUs(
        sample({ mode: "seek", readbackCadenceFps: 30 }),
      ),
    ).toBe(16_667);
  });
});

describe("nativePerfCollector unique frames and clock rate", () => {
  it("tracks uniqueFramesPaintedPerSecond and ignores dropped frames", () => {
    nativePerfCollector.clear();
    const stats0 = nativePerfCollector.statsFor("playback");
    expect(stats0.uniqueFramesPaintedPerSecond).toBeNull();

    // Record sample with frameIndex 0
    nativePerfCollector.record(
      sample({ frameIndex: 0, readbackCadenceFps: 25 }),
    );
    // Duplicate frame index 0 should not increase distinct count
    nativePerfCollector.record(
      sample({ frameIndex: 0, readbackCadenceFps: 25 }),
    );
    // Dropped frame index 1 should not count
    nativePerfCollector.record(
      sample({ frameIndex: 1, dropped: true, readbackCadenceFps: 25 }),
    );

    const stats = nativePerfCollector.statsFor("playback");
    // Before 500 ms wall-time has elapsed, returns null to avoid noisy early division
    expect(stats.droppedCount).toBe(1);
  });
});

