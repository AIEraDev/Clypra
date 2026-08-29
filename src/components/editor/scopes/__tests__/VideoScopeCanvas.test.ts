import { describe, it, expect } from "vitest";
import type { VideoScopePayload } from "@/types/scopes";

describe("Video Scope Data Model", () => {
  it("creates valid Histogram payload structure", () => {
    const payload: VideoScopePayload = {
      histogram: {
        luma: new Array(256).fill(10),
        red: new Array(256).fill(5),
        green: new Array(256).fill(8),
        blue: new Array(256).fill(2),
        maxBinCount: 10,
      },
    };

    expect(payload.histogram?.luma.length).toBe(256);
    expect(payload.histogram?.maxBinCount).toBe(10);
  });

  it("creates valid Waveform payload structure", () => {
    const payload: VideoScopePayload = {
      waveform: {
        width: 256,
        height: 256,
        data: new Array(256 * 256).fill(128),
      },
    };

    expect(payload.waveform?.width).toBe(256);
    expect(payload.waveform?.height).toBe(256);
    expect(payload.waveform?.data.length).toBe(65536);
  });
});
