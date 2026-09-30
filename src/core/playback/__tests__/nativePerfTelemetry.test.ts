import { describe, expect, it } from "vitest";
import {
  previewFrameDeadlineUs,
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
