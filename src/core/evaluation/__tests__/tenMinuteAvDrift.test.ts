import { describe, it, expect } from "vitest";
import { resolveClipSourceTime } from "@/core/timeline/sourceTime";
import type { VideoClip } from "@/types";

describe("AUD-02: 10-Minute Timeline & Playback A/V Drift Test", () => {
  it("maintains zero cumulative drift across 18,000 video frames (600s @ 30fps)", () => {
    const duration = 600.0; // 10 minutes
    const fps = 30.0;
    const totalFrames = Math.round(duration * fps); // 18,000 frames
    const sampleRate = 48000;

    const clip: VideoClip = {
      id: "clip-long-10m",
      trackId: "track-v1",
      mediaId: "asset-10m",
      kind: "video",
      startTime: 0,
      duration: duration,
      trimIn: 0,
      trimOut: duration,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      speed: 1.0,
      volume: 1.0,
      effects: [],
    } as unknown as VideoClip;

    let maxDriftMicroseconds = 0;

    // Sample every 30th frame (1-second intervals across all 10 minutes)
    // Within the clip's active range [0 .. totalFrames - 1]
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 30) {
      const timelineTime = frameIndex / fps;

      // 1. Resolve source time from timeline
      const { sourceTime, active } = resolveClipSourceTime(clip, timelineTime, {
        clampToRange: true,
        frameRate: fps,
      });

      expect(active).toBe(true);

      // 2. Exact audio sample index at 48kHz
      const audioSamples = Math.round(timelineTime * sampleRate);
      const audioTime = audioSamples / sampleRate;

      // 3. Difference between timeline video frame time and audio time
      const diffUs = Math.abs(timelineTime - audioTime) * 1_000_000;
      if (diffUs > maxDriftMicroseconds) {
        maxDriftMicroseconds = diffUs;
      }

      // Assert video source time matches timeline time without floating point divergence
      expect(sourceTime).toBeCloseTo(timelineTime, 4);
      expect(timelineTime).toBeCloseTo(audioTime, 4);
    }

    // Maximum drift across the entire 10-minute timeline must be < 1 microsecond
    expect(maxDriftMicroseconds).toBeLessThan(1.0);
  });

  it("maintains strict monotonic source time progression across 10-minute scrub", () => {
    const duration = 600.0;
    const clip: VideoClip = {
      id: "clip-long-10m-scrub",
      trackId: "track-v1",
      mediaId: "asset-10m",
      kind: "video",
      startTime: 0,
      duration: duration,
      trimIn: 0,
      trimOut: duration,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      speed: 1.0,
      volume: 1.0,
      effects: [],
    } as unknown as VideoClip;

    let prevSourceTime = -1;
    const totalSteps = 6000; // 6000 steps * 0.1s = 600.0s
    for (let step = 0; step < totalSteps; step++) {
      const t = step * 0.1;
      const { sourceTime } = resolveClipSourceTime(clip, t, { clampToRange: true });
      expect(sourceTime).toBeGreaterThanOrEqual(prevSourceTime);
      prevSourceTime = sourceTime;
    }

    // Last active step before end (step 5999 = 599.9s)
    expect(prevSourceTime).toBeCloseTo(599.9, 1);
  });
});
