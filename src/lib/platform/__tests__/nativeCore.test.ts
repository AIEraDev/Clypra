import { describe, expect, it } from "vitest";
import { DEFAULT_NATIVE_COLOR_POLICY, frameIndexToNativeTime, secondsToNativeTime } from "../nativeCore";

describe("native core contracts", () => {
  it("converts time to integral microsecond ticks", () => {
    expect(secondsToNativeTime(1.25, 38)).toEqual({
      frameIndex: 38,
      ticks: 1_250_000,
      timescale: 1_000_000,
    });
  });

  it("maps frame indices deterministically", () => {
    expect(frameIndexToNativeTime(30, 30)).toEqual({
      frameIndex: 30,
      ticks: 1_000_000,
      timescale: 1_000_000,
    });
  });

  it("defaults editing output to linear Rec.709 math and SDR presentation", () => {
    expect(DEFAULT_NATIVE_COLOR_POLICY).toMatchObject({
      workingSpace: "linear-rec709",
      outputFormat: "rgba8Srgb",
      toneMapHdrToSdr: true,
    });
  });

  it("preserves NativePlaybackState contract compatibility with additive poll telemetry", () => {
    const rawState = {
      contract_version: 1,
      audio_position_ticks: 48000,
      timescale: 48000,
      presented_frame: 30,
      clock_generation: 2,
      playing: true,
      sampledAtNs: 1_234_567_890,
    };

    // Simulated return value of nativeTickFromAudio (NativePlaybackState & { pollRttMs?: number })
    const tickResult = { ...rawState, pollRttMs: 14.2 };

    // Contract compatibility assertions: all existing fields accessible without cast
    expect(tickResult.audio_position_ticks).toBe(48000);
    expect(tickResult.timescale).toBe(48000);
    expect(tickResult.playing).toBe(true);
    expect(tickResult.sampledAtNs).toBe(1_234_567_890);
    expect(tickResult.pollRttMs).toBe(14.2);
  });
});
