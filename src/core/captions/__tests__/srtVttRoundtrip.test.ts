/**
 * SRT & WebVTT Roundtrip and Word Estimation Tests
 *
 * Verifies:
 * 1. SRT import parses cue blocks and estimates word-level timestamps proportionally.
 * 2. WebVTT import ignores WEBVTT headers and parses dot-decimal timestamps.
 * 3. Proportional word timing estimation preserves cue duration boundaries.
 * 4. HTML tags in subtitles are stripped cleanly.
 * 5. Export to SRT and WebVTT reproduces standard formatted subtitles.
 * 6. Full roundtrip (import -> export -> re-import) preserves word sequence and cue timings.
 */

import { describe, it, expect } from "vitest";
import {
  parseSrtToTranscript,
  parseVttToTranscript,
  exportTranscriptToSrt,
  exportTranscriptToVtt,
  parseSubtitleTimestampMs,
  formatSrtTimestamp,
  formatVttTimestamp,
} from "../srtVtt";

describe("SRT & WebVTT Subtitle Parsing and Estimation", () => {
  const sampleSrt = `1
00:00:01,000 --> 00:00:03,500
The quick brown fox

2
00:00:04,000 --> 00:00:06,500
jumps over <i>the</i> lazy dog.
`;

  const sampleVtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.500
The quick brown fox

2
00:00:04.000 --> 00:00:06.500
jumps over the lazy dog.
`;

  describe("Timecode helpers", () => {
    it("parses both SRT comma and VTT dot timestamp formats accurately", () => {
      expect(parseSubtitleTimestampMs("00:01:23,456")).toBe(83456);
      expect(parseSubtitleTimestampMs("00:01:23.456")).toBe(83456);
      expect(parseSubtitleTimestampMs("01:23.456")).toBe(83456);
      expect(parseSubtitleTimestampMs("00:00:00,000")).toBe(0);
    });

    it("formats milliseconds to standard SRT and VTT formats", () => {
      expect(formatSrtTimestamp(83456)).toBe("00:01:23,456");
      expect(formatVttTimestamp(83456)).toBe("00:01:23.456");
    });
  });

  describe("SRT parsing and word estimation", () => {
    it("parses SRT and estimates word timings across cue boundaries", () => {
      const transcript = parseSrtToTranscript(sampleSrt, {
        transcriptId: "test-srt-transcript",
        mediaId: "test-media",
      });

      expect(transcript.id).toBe("test-srt-transcript");
      expect(transcript.mediaId).toBe("test-media");
      expect(transcript.words.length).toBe(9); // "The quick brown fox jumps over the lazy dog."

      // Check first cue words: 1000ms to 3500ms (duration: 2500ms)
      const cue1Words = transcript.words.slice(0, 4);
      expect(cue1Words.map((w) => w.text)).toEqual(["The", "quick", "brown", "fox"]);
      expect(cue1Words[0].startMs).toBe(1000);
      expect(cue1Words[3].endMs).toBe(3500);

      // Verify monotonicity: each word starts at or after previous word
      for (let i = 1; i < cue1Words.length; i++) {
        expect(cue1Words[i].startMs).toBe(cue1Words[i - 1].endMs);
      }

      // Check HTML stripping in second cue: "<i>the</i>" -> "the"
      const cue2Words = transcript.words.slice(4);
      expect(cue2Words.map((w) => w.text)).toEqual(["jumps", "over", "the", "lazy", "dog."]);
      expect(cue2Words[0].startMs).toBe(4000);
      expect(cue2Words[4].endMs).toBe(6500);
    });
  });

  describe("WebVTT parsing", () => {
    it("parses WebVTT content ignoring headers", () => {
      const transcript = parseVttToTranscript(sampleVtt, {
        transcriptId: "test-vtt-transcript",
      });

      expect(transcript.words.length).toBe(9);
      expect(transcript.words[0].startMs).toBe(1000);
      expect(transcript.words[transcript.words.length - 1].endMs).toBe(6500);
    });
  });

  describe("Export and Roundtrip", () => {
    it("exports transcript to valid SRT and re-imports preserving word sequence", () => {
      const initial = parseSrtToTranscript(sampleSrt);
      const exportedSrt = exportTranscriptToSrt(initial);

      expect(exportedSrt).toContain("00:00:01,000 -->");
      expect(exportedSrt).toContain("The quick brown fox");

      // Re-import exported SRT
      const roundtripped = parseSrtToTranscript(exportedSrt);
      expect(roundtripped.words.map((w) => w.text)).toEqual(initial.words.map((w) => w.text));
      expect(roundtripped.words[0].startMs).toBe(initial.words[0].startMs);
    });

    it("exports transcript to valid WebVTT and re-imports preserving word sequence", () => {
      const initial = parseVttToTranscript(sampleVtt);
      const exportedVtt = exportTranscriptToVtt(initial);

      expect(exportedVtt.startsWith("WEBVTT")).toBe(true);
      expect(exportedVtt).toContain("00:00:01.000 -->");

      // Re-import exported VTT
      const roundtripped = parseVttToTranscript(exportedVtt);
      expect(roundtripped.words.map((w) => w.text)).toEqual(initial.words.map((w) => w.text));
      expect(roundtripped.words[0].startMs).toBe(initial.words[0].startMs);
    });
  });
});
