import { describe, expect, it } from "vitest";
import { NativePlaybackWatchdog } from "../nativePlaybackWatchdog";

describe("NativePlaybackWatchdog", () => {
  it("reports playing without native presentation progress", () => {
    const watchdog = new NativePlaybackWatchdog({
      stallThresholdMs: 100,
      incidentCooldownMs: 500,
    });
    watchdog.beginPlayback(0);

    expect(watchdog.check(true, 99, 3)).toBeNull();
    expect(watchdog.check(true, 100, 3)).toMatchObject({
      marker: "native-playback-watchdog",
      reason: "playing-without-native-presentation-progress",
      elapsedMs: 100,
      playheadFrame: 3,
      lastPresentedFrame: null,
    });
  });

  it("rate-limits incidents and clears the condition on presentation progress", () => {
    const watchdog = new NativePlaybackWatchdog({
      stallThresholdMs: 100,
      incidentCooldownMs: 500,
    });
    watchdog.beginPlayback(0);

    expect(watchdog.check(true, 100, 3)).not.toBeNull();
    expect(watchdog.check(true, 200, 6)).toBeNull();

    watchdog.recordPresentation(6, 650);
    expect(watchdog.check(true, 749, 9)).toBeNull();
    expect(watchdog.check(true, 749, 9)).toBeNull();
    expect(watchdog.check(true, 750, 9)).toMatchObject({
      lastPresentedFrame: 6,
      playheadFrame: 9,
    });
  });

  it("does not report while paused or after playback ends", () => {
    const watchdog = new NativePlaybackWatchdog({ stallThresholdMs: 100 });
    watchdog.beginPlayback(0);

    expect(watchdog.check(false, 500, 15)).toBeNull();
    watchdog.endPlayback();
    expect(watchdog.check(true, 1_000, 30)).toBeNull();
  });

  it("reports an intentional two-second stall but not a pause or clip end", () => {
    const watchdog = new NativePlaybackWatchdog({
      stallThresholdMs: 1_000,
      incidentCooldownMs: 5_000,
    });
    watchdog.beginPlayback(0);

    expect(watchdog.check(true, 999, 24)).toBeNull();
    expect(watchdog.check(true, 2_000, 50)).toMatchObject({
      reason: "playing-without-native-presentation-progress",
      elapsedMs: 2_000,
      playheadFrame: 50,
    });
    expect(watchdog.check(false, 2_001, 50)).toBeNull();

    watchdog.endPlayback();
    expect(watchdog.check(true, 10_000, 250)).toBeNull();
  });
});

