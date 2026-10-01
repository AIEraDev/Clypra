import { describe, expect, it } from "vitest";
import {
  framesToSeconds,
  framesToSmpteTimecode,
  parseSmpteTimecode,
  secondsToFrames,
  secondsToSmpteTimecode,
  smpteComponentsToFrames,
} from "../smpteTimecode";

describe("SMPTE 12M Timecode Engine", () => {
  describe("Non-Drop-Frame (NDF)", () => {
    it("formats 24fps NDF timecode correctly", () => {
      expect(framesToSmpteTimecode(0, 24, false)).toBe("00:00:00:00");
      expect(framesToSmpteTimecode(23, 24, false)).toBe("00:00:00:23");
      expect(framesToSmpteTimecode(24, 24, false)).toBe("00:00:01:00");
      expect(framesToSmpteTimecode(1440, 24, false)).toBe("00:01:00:00");
      expect(framesToSmpteTimecode(86400, 24, false)).toBe("01:00:00:00");
    });

    it("formats 30fps NDF timecode correctly", () => {
      expect(secondsToSmpteTimecode(0, 30, false)).toBe("00:00:00:00");
      expect(secondsToSmpteTimecode(1.5, 30, false)).toBe("00:00:01:15");
      expect(secondsToSmpteTimecode(3665.2, 30, false)).toBe("01:01:05:06");
    });

    it("converts NDF components back to exact frames", () => {
      expect(smpteComponentsToFrames(1, 1, 5, 6, 30, false)).toBe(109956);
      expect(framesToSmpteTimecode(109956, 30, false)).toBe("01:01:05:06");
    });
  });

  describe("Drop-Frame (DF) 29.97 fps", () => {
    it("uses semicolon delimiter for drop-frame timecode", () => {
      const tc = framesToSmpteTimecode(0, 29.97, true);
      expect(tc).toBe("00:00:00;00");
    });

    it("drops frames 00 and 01 on regular minute boundaries", () => {
      // Minute 0 has 1800 frames (0 to 1799)
      expect(framesToSmpteTimecode(1799, 29.97, true)).toBe("00:00:59;29");
      // Minute 1 drops frame 00 and 01, starting at frame 02
      expect(framesToSmpteTimecode(1800, 29.97, true)).toBe("00:01:00;02");
    });

    it("does NOT drop frames on 10th minute boundaries", () => {
      // 10 minutes in 29.97 DF is exactly 17982 frames: frame 17981 is 00:09:59;29, frame 17982 is 00:10:00;00
      expect(framesToSmpteTimecode(17981, 29.97, true)).toBe("00:09:59;29");
      expect(framesToSmpteTimecode(17982, 29.97, true)).toBe("00:10:00;00");
    });

    it("accurately inverts drop-frame timecode back to frame count", () => {
      const testFrames = [0, 100, 1799, 1800, 5000, 17981, 17982, 107892];
      for (const f of testFrames) {
        const tc = framesToSmpteTimecode(f, 29.97, true);
        const parsed = parseSmpteTimecode(tc, 0, 29.97, true);
        expect(parsed.success).toBe(true);
        expect(parsed.frames).toBe(f);
      }
    });
  });

  describe("Drop-Frame (DF) 59.94 fps", () => {
    it("drops 4 frames on regular minute boundaries", () => {
      // Minute 0 has 3600 frames (0 to 3599)
      expect(framesToSmpteTimecode(3599, 59.94, true)).toBe("00:00:59;59");
      // Minute 1 drops frames 00..03, starting at frame 04
      expect(framesToSmpteTimecode(3600, 59.94, true)).toBe("00:01:00;04");
    });

    it("does not drop frames on 10th minute at 59.94 fps", () => {
      // 10 minutes at 59.94 DF is 35964 frames
      expect(framesToSmpteTimecode(35963, 59.94, true)).toBe("00:09:59;59");
      expect(framesToSmpteTimecode(35964, 59.94, true)).toBe("00:10:00;00");
    });
  });

  describe("parseSmpteTimecode", () => {
    it("parses standard full timecode strings", () => {
      const res = parseSmpteTimecode("01:00:00:00", 0, 30, false);
      expect(res.success).toBe(true);
      expect(res.frames).toBe(108000);
      expect(res.seconds).toBe(3600);
      expect(res.isRelative).toBe(false);
    });

    it("parses shorthand timecodes (MM:SS:FF and SS:FF)", () => {
      const mmssff = parseSmpteTimecode("02:10:15", 0, 30, false);
      expect(mmssff.success).toBe(true);
      expect(mmssff.frames).toBe((2 * 60 + 10) * 30 + 15);

      const ssff = parseSmpteTimecode("05:12", 0, 30, false);
      expect(ssff.success).toBe(true);
      expect(ssff.frames).toBe(5 * 30 + 12);
    });

    it("parses unpunctuated 8-digit timecode", () => {
      const res = parseSmpteTimecode("01020304", 0, 30, false);
      expect(res.success).toBe(true);
      expect(res.frames).toBe((1 * 3600 + 2 * 60 + 3) * 30 + 4);
    });

    it("parses relative positive and negative frame jumps", () => {
      const current = 10.0; // 300 frames at 30fps
      const jump15 = parseSmpteTimecode("+15", current, 30, false);
      expect(jump15.success).toBe(true);
      expect(jump15.isRelative).toBe(true);
      expect(jump15.frames).toBe(315);
      expect(jump15.seconds).toBeCloseTo(10.5, 5);

      const jumpBack = parseSmpteTimecode("-30", current, 30, false);
      expect(jumpBack.success).toBe(true);
      expect(jumpBack.isRelative).toBe(true);
      expect(jumpBack.frames).toBe(270);
      expect(jumpBack.seconds).toBeCloseTo(9.0, 5);
    });

    it("parses relative timecode jumps (+1:00)", () => {
      const current = 10.0;
      const jump1Sec = parseSmpteTimecode("+00:01:00", current, 30, false);
      expect(jump1Sec.success).toBe(true);
      expect(jump1Sec.isRelative).toBe(true);
      expect(jump1Sec.seconds).toBeCloseTo(11.0, 5);
    });

    it("handles invalid timecode gracefully", () => {
      expect(parseSmpteTimecode("").success).toBe(false);
      expect(parseSmpteTimecode("abc:def").success).toBe(false);
      expect(parseSmpteTimecode("1:2:3:4:5").success).toBe(false);
    });
  });
});
