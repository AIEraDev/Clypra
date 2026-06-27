import { describe, it, expect } from "vitest";
import { 
  snapToFrameBoundary, 
  snapToFrameFloor, 
  snapToFrameCeil, 
  getFrameIndex, 
  getTimeFromFrame 
} from "../frameTime";
import { 
  formatTime, 
  formatTimecode, 
  formatTimeWithDeciseconds 
} from "../timeFormatting";

describe("Time & Frame Utilities", () => {
  
  describe("Frame Snapping Utilities", () => {
    const fps = 30;

    it("should snap to the nearest frame boundary correctly", () => {
      // 1.04s should snap to 1.0333s (frame 31)
      expect(snapToFrameBoundary(1.04, fps)).toBeCloseTo(31 / 30);
      // 1.06s should snap to 1.0667s (frame 32)
      expect(snapToFrameBoundary(1.06, fps)).toBeCloseTo(32 / 30);
    });

    it("should snap floor to previous boundary", () => {
      // 1.06s floor snaps to 1.0333s (frame 31)
      expect(snapToFrameFloor(1.06, fps)).toBeCloseTo(31 / 30);
    });

    it("should snap ceil to next boundary", () => {
      // 1.04s ceil snaps to 1.0667s (frame 32)
      expect(snapToFrameCeil(1.04, fps)).toBeCloseTo(32 / 30);
    });

    it("should convert time to frame index and back", () => {
      expect(getFrameIndex(2.0, fps)).toBe(60);
      expect(getTimeFromFrame(60, fps)).toBe(2.0);
    });
  });

  describe("Time Formatting Utilities", () => {
    it("should format time in MM:SS or HH:MM:SS format", () => {
      expect(formatTime(45)).toBe("00:45");
      expect(formatTime(125)).toBe("02:05");
      expect(formatTime(3665)).toBe("01:01:05");
    });

    it("should format precise timecode as HH:MM:SS:FF or MM:SS:FF", () => {
      // 30fps: 0.5s is frame 15
      expect(formatTimecode(0.5, 30)).toBe("00:00:15");
      expect(formatTimecode(65.1, 30)).toBe("01:05:03");
      expect(formatTimecode(3665.2, 30)).toBe("01:01:05:06");
    });

    it("should format time with deciseconds", () => {
      expect(formatTimeWithDeciseconds(5.25)).toBe("00:05.2");
      expect(formatTimeWithDeciseconds(125.79)).toBe("02:05.7");
    });
  });
});
