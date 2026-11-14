import { describe, it, expect } from "vitest";
import {
  captionSourceTime,
  isWordInClipRange,
  getWordsForClip,
  findActiveWordIndex,
  type CaptionClipTimeContext,
} from "../captionTime";

/**
 * Deterministic Mulberry32 Pseudo-Random Number Generator with a fixed seed.
 */
function createPrng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TestWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

function generateTestTranscript(prng: () => number, count: number): TestWord[] {
  const words: TestWord[] = [];
  let currentMs = 200; // start after 200ms initial silence

  for (let i = 0; i < count; i++) {
    const durationMs = Math.round(150 + prng() * 450); // 150ms - 600ms word duration
    const pauseMs = Math.round(50 + prng() * 350); // 50ms - 400ms pause
    const startMs = currentMs;
    const endMs = startMs + durationMs;
    words.push({
      id: `w-${i}`,
      text: `word_${i}`,
      startMs,
      endMs,
    });
    currentMs = endMs + pauseMs;
  }
  return words;
}

describe("captionSourceTime & Word Assignment Invariants", () => {
  const FIXED_SEED = 123456;
  const prng = createPrng(FIXED_SEED);
  const transcriptWords = generateTestTranscript(prng, 60);
  const totalDurationSec = Math.ceil(transcriptWords[transcriptWords.length - 1].endMs / 1000) + 2;

  const referenceClip: CaptionClipTimeContext = {
    startTime: 0,
    duration: totalDurationSec,
    trimIn: 0,
    trimOut: totalDurationSec,
    speed: 1.0,
  };

  describe("Randomized Timing Invariants vs. Untouched Reference", () => {
    it("preserves exact active word identity across clip Move (startTime shift)", () => {
      const shiftSeconds = 7.333; // ~220 frames at 30fps
      const movedClip: CaptionClipTimeContext = {
        ...referenceClip,
        startTime: shiftSeconds,
      };

      // Sample 200 timestamps across the duration
      const sampleCount = 200;
      for (let i = 0; i < sampleCount; i++) {
        const refTimelineTime = (i / sampleCount) * totalDurationSec;
        const movedTimelineTime = refTimelineTime + shiftSeconds;

        const refSourceMs = captionSourceTime(referenceClip, refTimelineTime);
        const movedSourceMs = captionSourceTime(movedClip, movedTimelineTime);

        expect(movedSourceMs).toBe(refSourceMs);

        const refActiveIndex = findActiveWordIndex(transcriptWords, refSourceMs);
        const movedActiveIndex = findActiveWordIndex(transcriptWords, movedSourceMs);
        expect(movedActiveIndex).toBe(refActiveIndex);
      }
    });

    it("preserves active word identity across Head and Tail Trims within 1 frame (33.3ms)", () => {
      const trimInSec = 5.0;
      const trimOutSec = 25.0;
      const trimmedClip: CaptionClipTimeContext = {
        startTime: 2.0, // placed at 2.0s on timeline
        duration: trimOutSec - trimInSec,
        trimIn: trimInSec,
        trimOut: trimOutSec,
        speed: 1.0,
      };

      const sampleCount = 100;
      for (let i = 0; i < sampleCount; i++) {
        const progress = i / sampleCount;
        const timelineTime = trimmedClip.startTime + progress * trimmedClip.duration;
        const sourceMs = captionSourceTime(trimmedClip, timelineTime);

        // Corresponding time on the reference clip
        const refTimelineTime = trimInSec + progress * trimmedClip.duration;
        const refSourceMs = captionSourceTime(referenceClip, refTimelineTime);

        // Within 1 millisecond rounding
        expect(Math.abs(sourceMs - refSourceMs)).toBeLessThanOrEqual(1);

        const activeIndex = findActiveWordIndex(transcriptWords, sourceMs);
        const refActiveIndex = findActiveWordIndex(transcriptWords, refSourceMs);
        expect(activeIndex).toBe(refActiveIndex);
      }
    });

    it("preserves seamless continuity across Split cuts with 0ms boundary drift", () => {
      const splitTime = 14.5; // split at 14.5s
      const leftClip: CaptionClipTimeContext = {
        startTime: 0,
        duration: splitTime,
        trimIn: 0,
        trimOut: splitTime,
        speed: 1.0,
      };
      const rightClip: CaptionClipTimeContext = {
        startTime: splitTime,
        duration: totalDurationSec - splitTime,
        trimIn: splitTime,
        trimOut: totalDurationSec,
        speed: 1.0,
      };

      // At the exact cut boundary (splitTime - epsilon vs splitTime)
      const leftAtCut = captionSourceTime(leftClip, splitTime - 0.001);
      const rightAtCut = captionSourceTime(rightClip, splitTime);

      expect(Math.abs(rightAtCut - leftAtCut)).toBeLessThanOrEqual(2); // <= 2ms difference across cut

      // Verify active words match reference across both halves
      for (let t = 0; t < totalDurationSec; t += 0.1) {
        const activeClip = t < splitTime ? leftClip : rightClip;
        const sourceMs = captionSourceTime(activeClip, t);
        const refSourceMs = captionSourceTime(referenceClip, t);

        expect(Math.abs(sourceMs - refSourceMs)).toBeLessThanOrEqual(1);
        expect(findActiveWordIndex(transcriptWords, sourceMs)).toBe(
          findActiveWordIndex(transcriptWords, refSourceMs),
        );
      }
    });

    it("scales active word progression proportionally across Speed Changes (0.5x, 1.5x, 2.0x)", () => {
      const speeds = [0.5, 1.25, 1.5, 2.0];

      for (const speed of speeds) {
        const speedClip: CaptionClipTimeContext = {
          startTime: 1.0,
          duration: (totalDurationSec - 4.0) / speed,
          trimIn: 4.0,
          trimOut: totalDurationSec,
          speed,
        };

        const testFrames = 50;
        for (let f = 0; f < testFrames; f++) {
          const localTime = (f / testFrames) * speedClip.duration;
          const timelineTime = speedClip.startTime + localTime;

          const sourceMs = captionSourceTime(speedClip, timelineTime);
          const expectedSourceMs = Math.round((speedClip.trimIn + localTime * speed) * 1000);

          expect(Math.abs(sourceMs - expectedSourceMs)).toBeLessThanOrEqual(1);

          // Compare with reference clip at the mapped source time
          const refTime = speedClip.trimIn + localTime * speed;
          const refSourceMs = captionSourceTime(referenceClip, refTime);

          expect(findActiveWordIndex(transcriptWords, sourceMs)).toBe(
            findActiveWordIndex(transcriptWords, refSourceMs),
          );
        }
      }
    });
  });

  describe("Word-to-Clip Assignment (Word Start Invariant & Cut Edges)", () => {
    const clip = { trimIn: 10.0, trimOut: 15.0 }; // 10,000ms to 15,000ms

    it("assigns word whose start and end fall completely within clip range", () => {
      const word = { startMs: 11000, endMs: 11400 };
      expect(isWordInClipRange(word, clip)).toBe(true);
    });

    it("assigns word whose start is inside clip, but end extends past trimOut (tail edge cut)", () => {
      // Word starts at 14,800ms and ends at 15,300ms (cuts across 15.0s boundary)
      const word = { startMs: 14800, endMs: 15300 };
      expect(isWordInClipRange(word, clip)).toBe(true);
    });

    it("rejects word whose start is before trimIn, even if end overlaps into clip (head edge cut)", () => {
      // Word starts at 9,800ms and ends at 10,200ms (cuts across 10.0s boundary)
      // Must NOT be assigned to this clip to avoid duplicate display with preceding clip
      const word = { startMs: 9800, endMs: 10200 };
      expect(isWordInClipRange(word, clip)).toBe(false);
    });

    it("assigns word starting exactly on trimIn lower bound (inclusive)", () => {
      const word = { startMs: 10000, endMs: 10300 };
      expect(isWordInClipRange(word, clip)).toBe(true);
    });

    it("rejects word starting exactly on trimOut upper bound (exclusive)", () => {
      const word = { startMs: 15000, endMs: 15300 };
      expect(isWordInClipRange(word, clip)).toBe(false);
    });

    it("filters a word list guaranteeing zero word duplication across adjacent split clips", () => {
      const clipA = { trimIn: 0.0, trimOut: 5.0 };
      const clipB = { trimIn: 5.0, trimOut: 10.0 };

      const words = [
        { id: "w1", startMs: 1000, endMs: 1400 },
        { id: "w2", startMs: 4800, endMs: 5200 }, // cuts boundary at 5.0s
        { id: "w3", startMs: 5000, endMs: 5400 }, // exactly on boundary at 5.0s
        { id: "w4", startMs: 7000, endMs: 7300 },
      ];

      const wordsA = getWordsForClip(words, clipA);
      const wordsB = getWordsForClip(words, clipB);

      // w2 starts at 4800 (< 5000) -> belongs exclusively to clipA
      expect(wordsA.map((w) => w.id)).toEqual(["w1", "w2"]);

      // w3 starts at 5000 (>= 5000) -> belongs exclusively to clipB
      expect(wordsB.map((w) => w.id)).toEqual(["w3", "w4"]);

      // Invariant: Intersection of assigned words across adjacent cuts is strictly empty
      const intersection = wordsA.filter((w) => wordsB.includes(w));
      expect(intersection).toHaveLength(0);
    });
  });
});
