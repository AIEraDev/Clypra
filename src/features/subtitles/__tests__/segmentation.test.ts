import { describe, it, expect } from "vitest";
import {
  segmentWordTimestamps,
  InputWordTimestamp,
} from "../segmentation";

describe("Smart NLE Caption Segmentation Engine", () => {
  const sampleWords: InputWordTimestamp[] = [
    { word: "Welcome", startMs: 0, endMs: 400 },
    { word: "to", startMs: 410, endMs: 550 },
    { word: "Clypra", startMs: 560, endMs: 900 },
    { word: "video", startMs: 910, endMs: 1200 },
    { word: "editor.", startMs: 1210, endMs: 1600 },
    { word: "Today", startMs: 2200, endMs: 2500 }, // gap > 350ms
    { word: "we", startMs: 2510, endMs: 2650 },
    { word: "are", startMs: 2660, endMs: 2800 },
    { word: "building", startMs: 2810, endMs: 3100 },
    { word: "the", startMs: 3110, endMs: 3200 },
    { word: "future.", startMs: 3210, endMs: 3600 },
  ];

  it("splits at sentence-ending punctuation", () => {
    const cues = segmentWordTimestamps(sampleWords, { preset: "standard" });
    expect(cues.length).toBeGreaterThanOrEqual(2);
    expect(cues[0].text).toBe("Welcome to Clypra video editor.");
    expect(cues[1].text).toContain("Today we are building the future.");
  });

  it("splits at large pauses / speech gaps", () => {
    const wordsWithPause: InputWordTimestamp[] = [
      { word: "Hello", startMs: 0, endMs: 500 },
      { word: "world", startMs: 1200, endMs: 1600 }, // 700ms gap
    ];
    const cues = segmentWordTimestamps(wordsWithPause, { preset: "standard", maxGapMs: 350 });
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe("Hello");
    expect(cues[1].text).toBe("world");
  });

  it("segments for social / kinetic word-pop preset (1-3 words per cue)", () => {
    const cues = segmentWordTimestamps(sampleWords, { preset: "kinetic" });
    expect(cues.length).toBeGreaterThan(3);
    for (const cue of cues) {
      const count = cue.words.length;
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("calculates accurate relative word timestamps for karaoke alignment", () => {
    const cues = segmentWordTimestamps(sampleWords, { preset: "standard" });
    const firstCue = cues[0];

    expect(firstCue.startMs).toBe(0);
    expect(firstCue.words[0].word).toBe("Welcome");
    expect(firstCue.words[0].start).toBe(0);
    expect(firstCue.words[0].end).toBeCloseTo(0.4, 2);

    expect(firstCue.words[2].word).toBe("Clypra");
    expect(firstCue.words[2].start).toBeCloseTo(0.56, 2);
  });

  it("handles empty words array cleanly", () => {
    expect(segmentWordTimestamps([])).toEqual([]);
  });
});
