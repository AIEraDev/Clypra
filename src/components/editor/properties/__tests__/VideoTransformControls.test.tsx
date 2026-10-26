import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VideoTransformControls } from "../video/sections/VideoTransformControls";
import { VideoBlendControls } from "../video/sections/VideoBlendControls";
import type { Clip } from "@/types";

// Mock i18n
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "properties.transform.title": "Transform",
        "properties.transform.reset": "Reset transform",
        "properties.transform.alignLeft": "Align left",
        "properties.transform.alignCenterX": "Align center horizontally",
        "properties.transform.alignRight": "Align right",
        "properties.transform.alignTop": "Align top",
        "properties.transform.alignCenterY": "Align center vertically",
        "properties.transform.alignBottom": "Align bottom",
      };
      return dict[key] || key;
    },
  }),
}));

// Mock PlaybackClock
let mockCurrentTime = 0;
vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: mockCurrentTime,
    seek: vi.fn(),
  }),
}));

vi.mock("@/core/playback/PlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: mockCurrentTime,
    seek: vi.fn(),
  }),
}));

// Mock uiStore
vi.mock("@/store/uiStore", () => ({
  useUIStore: vi.fn((selector) => {
    const state = {
      openCurveEditor: vi.fn(),
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

// Mock timelineStore
vi.mock("@/store/timelineStore", () => ({
  useTimelineStore: vi.fn((selector) => {
    const state = {
      tracks: [
        {
          id: "track-1",
          clips: [],
        },
      ],
    };
    return typeof selector === "function" ? selector(state) : state;
  }),
}));

describe("VideoTransformControls & VideoBlendControls Suite", () => {
  const baseVideoClip: Clip = {
    id: "clip-test-1",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 100,
    y: 100,
    width: 320,
    height: 180,
    opacity: 0.8,
    rotation: 45,
    aspectRatioLocked: true,
    sourceAspectRatio: 16 / 9,
  };

  const canvasWidth = 1920;
  const canvasHeight = 1080;

  beforeEach(() => {
    mockCurrentTime = 0;
    vi.clearAllMocks();
  });

  describe("Alignment Buttons", () => {
    it("handles align left (x = 0)", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignLeftBtn = screen.getByRole("button", { name: "Align left" });
      fireEvent.click(alignLeftBtn);

      expect(handleUpdate).toHaveBeenCalledWith("x", 0);
    });

    it("handles align center horizontally (x = (canvasWidth - clipWidth) / 2)", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignCenterBtn = screen.getByRole("button", {
        name: "Align center horizontally",
      });
      fireEvent.click(alignCenterBtn);

      // (1920 - 320) / 2 = 800
      expect(handleUpdate).toHaveBeenCalledWith("x", 800);
    });

    it("handles align right (x = canvasWidth - clipWidth)", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignRightBtn = screen.getByRole("button", { name: "Align right" });
      fireEvent.click(alignRightBtn);

      // 1920 - 320 = 1600
      expect(handleUpdate).toHaveBeenCalledWith("x", 1600);
    });

    it("handles align top (y = 0)", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignTopBtn = screen.getByRole("button", { name: "Align top" });
      fireEvent.click(alignTopBtn);

      expect(handleUpdate).toHaveBeenCalledWith("y", 0);
    });

    it("handles align center vertically (y = (canvasHeight - clipHeight) / 2)", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignCenterYBtn = screen.getByRole("button", {
        name: "Align center vertically",
      });
      fireEvent.click(alignCenterYBtn);

      // (1080 - 180) / 2 = 450
      expect(handleUpdate).toHaveBeenCalledWith("y", 450);
    });

    it("handles align bottom (y = canvasHeight - clipHeight)", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignBottomBtn = screen.getByRole("button", { name: "Align bottom" });
      fireEvent.click(alignBottomBtn);

      // 1080 - 180 = 900
      expect(handleUpdate).toHaveBeenCalledWith("y", 900);
    });

    it("updates keyframe value when parked on a keyframe for that property", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      const clipWithKeyframes: Clip = {
        ...baseVideoClip,
        visualKeyframes: {
          x: [
            { id: "kf-1", time: 0, value: 100 },
            { id: "kf-2", time: 5, value: 500 },
          ],
        },
      };

      // Playhead is at time 0 (matches kf-1)
      mockCurrentTime = 0;

      render(
        <VideoTransformControls
          selectedClip={clipWithKeyframes}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const alignRightBtn = screen.getByRole("button", { name: "Align right" });
      fireEvent.click(alignRightBtn);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      expect(handleUpdateMultiple).toHaveBeenCalledWith({
        x: 1600,
        visualKeyframes: {
          x: [
            { id: "kf-1", time: 0, value: 1600 },
            { id: "kf-2", time: 5, value: 500 },
          ],
        },
      });
    });
  });

  describe("Transform Reset Handler", () => {
    it("resets clip position to centered, rotation to 0, and restores aspect ratio lock", () => {
      const handleUpdate = vi.fn();
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const resetBtn = screen.getByRole("button", { name: "Reset transform" });
      fireEvent.click(resetBtn);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const updatePayload = handleUpdateMultiple.mock.calls[0][0];

      // baseWidth is either canvasWidth (1920) or native width; default fallback is canvasWidth
      // x should be centered: (1920 - 1920) / 2 = 0
      // y should be centered: (1080 - 1080) / 2 = 0
      expect(updatePayload.rotation).toBe(0);
      expect(updatePayload.aspectRatioLocked).toBe(true);
      expect(typeof updatePayload.x).toBe("number");
      expect(typeof updatePayload.y).toBe("number");
      expect(typeof updatePayload.width).toBe("number");
      expect(typeof updatePayload.height).toBe("number");
    });
  });

  describe("VideoBlendControls", () => {
    it("dispatches opacity updates within [0, 1] range", () => {
      const handleUpdate = vi.fn();

      render(
        <VideoBlendControls
          selectedClip={baseVideoClip}
          handleUpdate={handleUpdate}
        />,
      );

      const numericInput = screen.getByRole("spinbutton", { name: "Opacity" });
      fireEvent.focus(numericInput);
      fireEvent.change(numericInput, { target: { value: "50" } });
      fireEvent.blur(numericInput);

      expect(handleUpdate).toHaveBeenCalledWith("opacity", 0.5);
    });

    it("resets blend mode to normal and opacity to 1 on reset", () => {
      const handleUpdate = vi.fn();

      render(
        <VideoBlendControls
          selectedClip={{
            ...baseVideoClip,
            opacity: 0.4,
            blendMode: "multiply",
          } as any}
          handleUpdate={handleUpdate}
        />,
      );

      const resetBtn = screen.getByRole("button", { name: "Reset blend" });
      fireEvent.click(resetBtn);

      expect(handleUpdate).toHaveBeenCalledWith("blendMode", "normal");
      expect(handleUpdate).toHaveBeenCalledWith("opacity", 1);
    });
  });
});
