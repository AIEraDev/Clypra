import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { formatTime, formatTimecode, formatTimeWithDeciseconds } from "../timeFormatting";

describe("timeFormatting Edge Cases & Invariants", () => {
  describe("formatTime", () => {
    it("handles 0 seconds", () => {
      expect(formatTime(0)).toBe("00:00");
    });

    it("formats minutes and seconds correctly", () => {
      expect(formatTime(125)).toBe("02:05");
    });

    it("formats hours, minutes, and seconds correctly", () => {
      expect(formatTime(3665)).toBe("01:01:05");
    });

    it("safely handles negative, NaN, and Infinity values by resetting to 00:00", () => {
      expect(formatTime(-10)).toBe("00:00");
      expect(formatTime(NaN)).toBe("00:00");
      expect(formatTime(Infinity)).toBe("00:00");
      expect(formatTime(-Infinity)).toBe("00:00");
    });

    it("property test: formatTime never produces NaN in string output", () => {
      fc.assert(
        fc.property(fc.double(), (sec) => {
          const res = formatTime(sec);
          expect(res.includes("NaN")).toBe(false);
          expect(res.includes("undefined")).toBe(false);
        })
      );
    });
  });

  describe("formatTimecode", () => {
    it("formats timecode with frame rate 30 fps", () => {
      expect(formatTimecode(0, 30)).toBe("00:00:00");
      expect(formatTimecode(1.5, 30)).toBe("00:01:15");
    });

    it("handles invalid frame rate (<= 0 or NaN) by defaulting to 30 fps", () => {
      expect(formatTimecode(1.5, 0)).toBe("00:01:15");
      expect(formatTimecode(1.5, NaN)).toBe("00:01:15");
    });

    it("property test: formatTimecode never produces NaN in string output", () => {
      fc.assert(
        fc.property(fc.double(), fc.double(), (sec, fps) => {
          const res = formatTimecode(sec, fps);
          expect(res.includes("NaN")).toBe(false);
          expect(res.includes("undefined")).toBe(false);
        })
      );
    });
  });

  describe("formatTimeWithDeciseconds", () => {
    it("formats seconds with decisecond precision", () => {
      expect(formatTimeWithDeciseconds(12.34)).toBe("00:12.3");
    });

    it("safely handles negative, NaN, and Infinity values", () => {
      expect(formatTimeWithDeciseconds(-5)).toBe("00:00.0");
      expect(formatTimeWithDeciseconds(NaN)).toBe("00:00.0");
      expect(formatTimeWithDeciseconds(Infinity)).toBe("00:00.0");
    });

    it("property test: formatTimeWithDeciseconds never produces NaN in string output", () => {
      fc.assert(
        fc.property(fc.double(), (sec) => {
          const res = formatTimeWithDeciseconds(sec);
          expect(res.includes("NaN")).toBe(false);
          expect(res.includes("undefined")).toBe(false);
        })
      );
    });
  });
});
