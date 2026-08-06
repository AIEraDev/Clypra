import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseSubtitleTime, formatSubtitleTime, parseSubtitles } from "../parser";

describe("Subtitle Parser Generative & Edge Case Invariants", () => {
  describe("parseSubtitleTime", () => {
    it("parses valid SRT time strings correctly", () => {
      expect(parseSubtitleTime("01:02:03,456")).toBe(3723.456);
      expect(parseSubtitleTime("00:01:30.500")).toBe(90.5);
    });

    it("returns 0 for garbage or malformed time strings", () => {
      expect(parseSubtitleTime("abc:def:xyz")).toBe(0);
      expect(parseSubtitleTime("invalid")).toBe(0);
      expect(parseSubtitleTime("")).toBe(0);
    });

    it("property test: parseSubtitleTime always returns a non-negative finite number", () => {
      fc.assert(
        fc.property(fc.string(), (timeStr) => {
          const result = parseSubtitleTime(timeStr);
          expect(Number.isFinite(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
        })
      );
    });
  });

  describe("formatSubtitleTime", () => {
    it("formats seconds into SRT format with comma separator", () => {
      expect(formatSubtitleTime(3723.456, "srt")).toBe("01:02:03,456");
    });

    it("formats seconds into VTT format with dot separator", () => {
      expect(formatSubtitleTime(3723.456, "vtt")).toBe("01:02:03.456");
    });

    it("safely handles negative, NaN, and Infinity values by resetting to 00:00:00", () => {
      expect(formatSubtitleTime(-10, "srt")).toBe("00:00:00,000");
      expect(formatSubtitleTime(NaN, "srt")).toBe("00:00:00,000");
      expect(formatSubtitleTime(Infinity, "srt")).toBe("00:00:00,000");
    });

    it("property test: formatSubtitleTime output string never contains NaN", () => {
      fc.assert(
        fc.property(fc.double(), fc.constantFrom<"srt" | "vtt">("srt", "vtt"), (sec, fmt) => {
          const formatted = formatSubtitleTime(sec, fmt);
          expect(formatted.includes("NaN")).toBe(false);
          expect(formatted.includes("undefined")).toBe(false);
        })
      );
    });
  });

  describe("parseSubtitles", () => {
    it("never throws or crashes on arbitrary file contents", () => {
      fc.assert(
        fc.property(fc.string(), (content) => {
          const blocks = parseSubtitles(content);
          expect(Array.isArray(blocks)).toBe(true);
          blocks.forEach((block) => {
            expect(Number.isFinite(block.startTime)).toBe(true);
            expect(Number.isFinite(block.endTime)).toBe(true);
            expect(block.startTime).toBeGreaterThanOrEqual(0);
            expect(block.endTime).toBeGreaterThanOrEqual(0);
          });
        })
      );
    });
  });
});
