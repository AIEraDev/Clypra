import { describe, it, expect } from "vitest";
import {
  formatSrtTimestamp,
  formatVttTimestamp,
  generateSrt,
  generateVtt,
  generateSidecar,
} from "../exportSidecar";
import {
  getActiveCaptionCue,
  evaluateCaptionsAtTicks,
} from "../captionEvaluator";
import {
  type CaptionTrack,
  CAPTION_MODEL_VERSION,
  DEFAULT_CAPTION_STYLE,
} from "@/types/captions";

describe("Caption Sidecar Export & Frame Evaluator", () => {
  describe("Timestamp Formatting", () => {
    it("formats SRT and VTT timestamps with correct precision and separators", () => {
      // 0 seconds
      expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
      expect(formatVttTimestamp(0)).toBe("00:00:00.000");

      // 1.5 seconds (1,500,000 ticks)
      expect(formatSrtTimestamp(1_500_000)).toBe("00:00:01,500");
      expect(formatVttTimestamp(1_500_000)).toBe("00:00:01.500");

      // 1 minute, 5.432 seconds (65,432,000 ticks)
      expect(formatSrtTimestamp(65_432_000)).toBe("00:01:05,432");
      expect(formatVttTimestamp(65_432_000)).toBe("00:01:05.432");

      // 1 hour, 1 minute, 1.123 seconds (3,661,123,000 ticks)
      expect(formatSrtTimestamp(3_661_123_000)).toBe("01:01:01,123");
      expect(formatVttTimestamp(3_661_123_000)).toBe("01:01:01.123");
    });
  });

  const sampleTrack: CaptionTrack = {
    id: "track-1",
    captionModelVersion: CAPTION_MODEL_VERSION,
    name: "Subtitles",
    visible: true,
    locked: false,
    defaultStyle: { ...DEFAULT_CAPTION_STYLE, fontSize: 40 },
    cues: [
      {
        id: "cue-2",
        startTicks: 3_000_000,
        endTicks: 5_000_000,
        text: "Second subtitle line",
        styleVersion: 1,
      },
      {
        id: "cue-1",
        startTicks: 500_000,
        endTicks: 2_500_000,
        text: "First subtitle line",
        speaker: "Alex",
        styleOverride: { color: "#facc15" },
        styleVersion: 1,
      },
    ],
  };

  describe("generateSrt & generateVtt", () => {
    it("generates correctly formatted, monotonically sorted SRT sidecar content", () => {
      const srt = generateSrt(sampleTrack);

      // Cue 1 must come first even though it was placed second in the array
      expect(srt).toContain("1\n00:00:00,500 --> 00:00:02,500\n[Alex]: First subtitle line");
      expect(srt).toContain("2\n00:00:03,000 --> 00:00:05,000\nSecond subtitle line");
    });

    it("generates correctly formatted, monotonically sorted WebVTT sidecar content", () => {
      const vtt = generateVtt(sampleTrack);

      expect(vtt.startsWith("WEBVTT\n")).toBe(true);
      expect(vtt).toContain("00:00:00.500 --> 00:00:02.500\n<v Alex>First subtitle line");
      expect(vtt).toContain("00:00:03.000 --> 00:00:05.000\nSecond subtitle line");
    });

    it("generateSidecar dispatches to the requested format", () => {
      expect(generateSidecar(sampleTrack, "srt")).toBe(generateSrt(sampleTrack));
      expect(generateSidecar(sampleTrack, "vtt")).toBe(generateVtt(sampleTrack));
    });
  });

  describe("Caption Frame Evaluator", () => {
    it("finds the active cue at exact tick precision", () => {
      // Before any cue (time = 200,000 ticks)
      expect(getActiveCaptionCue(sampleTrack, 200_000)).toBeNull();

      // Inside cue 1 (time = 1,000,000 ticks)
      const active1 = getActiveCaptionCue(sampleTrack, 1_000_000);
      expect(active1?.id).toBe("cue-1");

      // Gap between cue 1 and cue 2 (time = 2,700,000 ticks)
      expect(getActiveCaptionCue(sampleTrack, 2_700_000)).toBeNull();

      // Inside cue 2 (time = 4,000,000 ticks)
      const active2 = getActiveCaptionCue(sampleTrack, 4_000_000);
      expect(active2?.id).toBe("cue-2");

      // After cue 2 (time = 6,000,000 ticks)
      expect(getActiveCaptionCue(sampleTrack, 6_000_000)).toBeNull();
    });

    it("evaluates caption layers with cascade style resolution", () => {
      const layers = evaluateCaptionsAtTicks([sampleTrack], 1_000_000, 1920, 1080, true);

      expect(layers).toHaveLength(1);
      expect(layers[0].cueId).toBe("cue-1");
      expect(layers[0].text).toBe("First subtitle line");
      // Cue override applied
      expect(layers[0].style.color).toBe("#facc15");
      // Track default preserved
      expect(layers[0].style.fontSize).toBe(40);
      expect(layers[0].x).toBe(192); // (1920 - 1536) / 2
      expect(layers[0].boxWidth).toBe(1536);
    });

    it("respects track visibility and burnInOption flag (Dual Export Independence)", () => {
      // Invisible track yields 0 layers
      const invisibleTrack = { ...sampleTrack, visible: false };
      expect(evaluateCaptionsAtTicks([invisibleTrack], 1_000_000, 1920, 1080, true)).toHaveLength(0);

      // burnInOption = false yields 0 layers even if track is visible (Sidecar-only export)
      expect(evaluateCaptionsAtTicks([sampleTrack], 1_000_000, 1920, 1080, false)).toHaveLength(0);
    });
  });
});
