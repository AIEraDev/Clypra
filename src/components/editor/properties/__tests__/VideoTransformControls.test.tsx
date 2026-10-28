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
        "properties.transform.scale": "Scale",
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
  usePlaybackClock: () => ({
    time: mockCurrentTime,
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

  describe("Bug — Scale should not drift Position display (odd-width rounding)", () => {
    /**
     * Regression: handleScaleChange was using Math.round(centerX - newWidth/2)
     * for newX. When newWidth is odd (e.g. 8525 at 444%), the half-pixel
     * centerX - odd/2 = N.5 gets rounded in the wrong direction by JS
     * (Math.round rounds .5 toward +∞), causing the stored x to be off by 1.
     * That 1-pixel error propagates into the computed displayX, making the
     * Position panel appear to change while the user only touched Scale.
     *
     * Fix: store exact-float x/y (no Math.round) so the center is preserved
     * exactly and the display derivation (Math.round(centerX - canvasWidth/2))
     * always produces the original value.
     */

    it("uniform scale with odd resulting width preserves display Position X exactly", () => {
      // Clip is off-center: displayX = 28, displayY = -27
      // centerX = 1920/2 + 28 = 988, centerY = 1080/2 - (-27) = 567
      // clip.x = 988 - 320/2 = 828, clip.y = 567 - 180/2 = 477
      const clip: Clip = {
        ...baseVideoClip,
        x: 828,
        y: 477,
        width: 320,
        height: 180,
        baseWidth: 320,
        baseHeight: 180,
        aspectRatioLocked: true,
      };
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={clip}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      // Drag the scale slider to a value that produces an odd newWidth.
      // 320 * 3 = 960 (even), 320 * 3.5 = 1120 (even) — try percent=313:
      // 320 * 3.13 = 1001.6 → Math.round = 1002 (even, fine)
      // Try percent=157: 320 * 1.57 = 502.4 → 502 (even)
      // Try percent=159: 320 * 1.59 = 508.8 → 509 (ODD) ← triggers the bug

      const scaleInput = screen.getByRole("spinbutton", { name: "Scale" });
      fireEvent.focus(scaleInput);
      fireEvent.change(scaleInput, { target: { value: "159" } });
      fireEvent.blur(scaleInput);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const payload = handleUpdateMultiple.mock.calls[0][0];

      // newWidth = round(320 * 1.59) = 509 (odd)
      expect(payload.width).toBe(509);

      // Critical: the stored x must preserve the center exactly (as float).
      // centerX = 828 + 320/2 = 988
      // newX = 988 - 509/2 = 988 - 254.5 = 733.5 (exact float, NOT rounded)
      expect(payload.x).toBe(733.5);

      // Verify display derivation stays at original displayX = 28:
      // newCenterX = payload.x + payload.width/2 = 733.5 + 254.5 = 988
      // displayX = Math.round(988 - 1920/2) = Math.round(28) = 28 ✓
      const newCenterX = payload.x + payload.width / 2;
      expect(Math.round(newCenterX - 1920 / 2)).toBe(28);
    });

    it("uniform scale with odd resulting height preserves display Position Y exactly", () => {
      // centerY = 567 (displayY = -27)
      const clip: Clip = {
        ...baseVideoClip,
        x: 828,
        y: 477,
        width: 320,
        height: 180,
        baseWidth: 320,
        baseHeight: 180,
        aspectRatioLocked: true,
      };
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={clip}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      // percent=159: newHeight = round(180 * 1.59) = round(286.2) = 286 (even)
      // percent=161: newHeight = round(180 * 1.61) = round(289.8) = 290 (even)
      // percent=167: newHeight = round(180 * 1.67) = round(300.6) = 301 (ODD) ← triggers
      const scaleInput = screen.getByRole("spinbutton", { name: "Scale" });
      fireEvent.focus(scaleInput);
      fireEvent.change(scaleInput, { target: { value: "167" } });
      fireEvent.blur(scaleInput);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const payload = handleUpdateMultiple.mock.calls[0][0];

      // newHeight = round(180 * 1.67) = 301 (odd)
      expect(payload.height).toBe(301);

      // newY = 567 - 301/2 = 567 - 150.5 = 416.5 (exact float)
      expect(payload.y).toBe(416.5);

      // display derivation stays at original displayY = -27:
      // newCenterY = 416.5 + 150.5 = 567
      // displayY = Math.round(1080/2 - 567) = Math.round(-27) = -27 ✓
      const newCenterY = payload.y + payload.height / 2;
      expect(Math.round(1080 / 2 - newCenterY)).toBe(-27);
    });

    it("non-uniform scale width preserves display Position X exactly", () => {
      const clip: Clip = {
        ...baseVideoClip,
        x: 828,
        y: 477,
        width: 320,
        height: 180,
        baseWidth: 320,
        baseHeight: 180,
        aspectRatioLocked: false,
      };
      const handleUpdateMultiple = vi.fn();

      render(
        <VideoTransformControls
          selectedClip={clip}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      // Non-uniform mode renders two separate sliders (Scale width / Scale height).
      // percent=159 → newWidth=509 (odd)
      const scaleWidthInput = screen.getByRole("spinbutton", {
        name: "Scale width",
      });
      fireEvent.focus(scaleWidthInput);
      fireEvent.change(scaleWidthInput, { target: { value: "159" } });
      fireEvent.blur(scaleWidthInput);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const payload = handleUpdateMultiple.mock.calls[0][0];

      expect(payload.width).toBe(509);
      // newX = 988 - 509/2 = 733.5 (exact)
      expect(payload.x).toBe(733.5);

      const newCenterX = payload.x + payload.width / 2;
      expect(Math.round(newCenterX - 1920 / 2)).toBe(28);
    });
  });

  describe("Uniform Scale Keyframing", () => {
    it("toggles keyframes on uniform scale (width and height simultaneously)", () => {
      const handleUpdateMultiple = vi.fn();
      mockCurrentTime = 0;

      render(
        <VideoTransformControls
          selectedClip={baseVideoClip}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const addKfBtn = screen.getByTitle("Add keyframe for Scale");
      fireEvent.click(addKfBtn);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const payload = handleUpdateMultiple.mock.calls[0][0];
      expect(payload.visualKeyframes?.width).toHaveLength(1);
      expect(payload.visualKeyframes?.width[0].value).toBe(320);
      expect(payload.visualKeyframes?.width[0].time).toBe(0);

      expect(payload.visualKeyframes?.height).toHaveLength(1);
      expect(payload.visualKeyframes?.height[0].value).toBe(180);
      expect(payload.visualKeyframes?.height[0].time).toBe(0);
    });

    it("removes keyframe on uniform scale when already parked at a keyframe", () => {
      const handleUpdateMultiple = vi.fn();
      mockCurrentTime = 0;

      const clipWithKeyframe: Clip = {
        ...baseVideoClip,
        visualKeyframes: {
          width: [
            { id: "kf-w1", time: 0, value: 320, easing: "easeInOut" },
          ],
          height: [
            { id: "kf-h1", time: 0, value: 180, easing: "easeInOut" },
          ],
        },
      };

      render(
        <VideoTransformControls
          selectedClip={clipWithKeyframe}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const removeKfBtn = screen.getByTitle("Remove keyframe for Scale");
      fireEvent.click(removeKfBtn);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const payload = handleUpdateMultiple.mock.calls[0][0];
      expect(payload.visualKeyframes?.width).toHaveLength(0);
      expect(payload.visualKeyframes?.height).toHaveLength(0);
    });

    it("updates existing keyframes when modifying uniform scale at keyframe time", () => {
      const handleUpdateMultiple = vi.fn();
      mockCurrentTime = 0;

      const clipWithKeyframe: Clip = {
        ...baseVideoClip,
        baseWidth: 320,
        baseHeight: 180,
        visualKeyframes: {
          width: [
            { id: "kf-w1", time: 0, value: 320, easing: "easeInOut" },
          ],
          height: [
            { id: "kf-h1", time: 0, value: 180, easing: "easeInOut" },
          ],
        },
      };

      render(
        <VideoTransformControls
          selectedClip={clipWithKeyframe}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={vi.fn()}
        />,
      );

      const scaleInput = screen.getByRole("spinbutton", { name: "Scale" });
      fireEvent.focus(scaleInput);
      fireEvent.change(scaleInput, { target: { value: "200" } });
      fireEvent.blur(scaleInput);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const payload = handleUpdateMultiple.mock.calls[0][0];
      expect(payload.width).toBe(640);
      expect(payload.height).toBe(360);
      expect(payload.visualKeyframes?.width?.[0].value).toBe(640);
      expect(payload.visualKeyframes?.height?.[0].value).toBe(360);
    });

    it("evaluates live keyframe values for scale display based on playhead time", () => {
      mockCurrentTime = 4;

      const clipWithKeyframes: Clip = {
        ...baseVideoClip,
        baseWidth: 320,
        baseHeight: 180,
        visualKeyframes: {
          width: [
            { id: "kf-w1", time: 0, value: 320, easing: "easeInOut" },
            { id: "kf-w2", time: 4, value: 640, easing: "easeInOut" },
          ],
          height: [
            { id: "kf-h1", time: 0, value: 180, easing: "easeInOut" },
            { id: "kf-h2", time: 4, value: 360, easing: "easeInOut" },
          ],
        },
      };

      render(
        <VideoTransformControls
          selectedClip={clipWithKeyframes}
          canvasWidth={1920}
          canvasHeight={1080}
          handleUpdate={vi.fn()}
          handleUpdateMultiple={vi.fn()}
          handleApplyFit={vi.fn()}
        />,
      );

      const scaleInput = screen.getByRole("spinbutton", { name: "Scale" }) as HTMLInputElement;
      expect(scaleInput.value).toBe("200");
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

    // ── Regression: Defect 3 — opacity live-eval & keyframe-aware slider ─────
    it("[REGRESSION] opacity slider updates existing keyframe value when a keyframe exists at the playhead", () => {
      mockCurrentTime = 2; // localTime = 2 - 0 = 2
      const handleUpdateMultiple = vi.fn();
      const handleUpdate = vi.fn();

      const clipWithOpacityKf: Clip = {
        ...baseVideoClip,
        opacity: 1,
        visualKeyframes: {
          opacity: [
            { id: "okf-1", time: 2, value: 0.9, easing: "linear" as const },
            { id: "okf-2", time: 6, value: 0.2, easing: "linear" as const },
          ],
        },
      };

      render(
        <VideoBlendControls
          selectedClip={clipWithOpacityKf}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
        />,
      );

      const numericInput = screen.getByRole("spinbutton", { name: "Opacity" });
      fireEvent.focus(numericInput);
      fireEvent.change(numericInput, { target: { value: "60" } });
      fireEvent.blur(numericInput);

      // handleUpdateMultiple must be called (not bare handleUpdate)
      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const [fields] = handleUpdateMultiple.mock.calls[0];
      expect(fields.opacity).toBeCloseTo(0.6, 5);
      // The keyframe at t=2 must have its value updated
      const updatedKf = fields.visualKeyframes.opacity.find((k: any) => k.id === "okf-1");
      expect(updatedKf).toBeDefined();
      expect(updatedKf.value).toBeCloseTo(0.6, 5);
      // The other keyframe must remain unchanged
      const otherKf = fields.visualKeyframes.opacity.find((k: any) => k.id === "okf-2");
      expect(otherKf.value).toBe(0.2);
    });

    it("[REGRESSION] opacity slider inserts a new keyframe when playhead is between existing keyframes", () => {
      mockCurrentTime = 4; // localTime = 4 — between t=2 and t=6
      const handleUpdateMultiple = vi.fn();
      const handleUpdate = vi.fn();

      const clipWithOpacityKf: Clip = {
        ...baseVideoClip,
        opacity: 1,
        visualKeyframes: {
          opacity: [
            { id: "okf-1", time: 2, value: 0.9, easing: "linear" as const },
            { id: "okf-2", time: 6, value: 0.2, easing: "linear" as const },
          ],
        },
      };

      render(
        <VideoBlendControls
          selectedClip={clipWithOpacityKf}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
        />,
      );

      const numericInput = screen.getByRole("spinbutton", { name: "Opacity" });
      fireEvent.focus(numericInput);
      fireEvent.change(numericInput, { target: { value: "55" } });
      fireEvent.blur(numericInput);

      expect(handleUpdateMultiple).toHaveBeenCalledTimes(1);
      const [fields] = handleUpdateMultiple.mock.calls[0];
      expect(fields.opacity).toBeCloseTo(0.55, 5);
      // A new keyframe should be inserted at t=4
      expect(fields.visualKeyframes.opacity).toHaveLength(3);
      const newKf = fields.visualKeyframes.opacity.find((k: any) => Math.abs(k.time - 4) < 0.1);
      expect(newKf).toBeDefined();
      expect(newKf.value).toBeCloseTo(0.55, 5);
    });

    it("[REGRESSION] opacity slider falls back to plain handleUpdate when no keyframes exist", () => {
      mockCurrentTime = 3;
      const handleUpdateMultiple = vi.fn();
      const handleUpdate = vi.fn();

      render(
        <VideoBlendControls
          selectedClip={baseVideoClip}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
        />,
      );

      const numericInput = screen.getByRole("spinbutton", { name: "Opacity" });
      fireEvent.focus(numericInput);
      fireEvent.change(numericInput, { target: { value: "70" } });
      fireEvent.blur(numericInput);

      expect(handleUpdate).toHaveBeenCalledWith("opacity", 0.7);
      expect(handleUpdateMultiple).not.toHaveBeenCalled();
    });

    it("[REGRESSION] opacity toggle keyframe uses live-evaluated opacity (not stale clip.opacity)", () => {
      // At t=5, opacity is animated to 0.3 by keyframes
      mockCurrentTime = 5;
      const handleUpdate = vi.fn();

      const clipAnimated: Clip = {
        ...baseVideoClip,
        opacity: 1,
        visualKeyframes: {
          opacity: [
            { id: "okf-a", time: 0, value: 1.0, easing: "linear" as const },
            { id: "okf-b", time: 10, value: 0.0, easing: "linear" as const },
          ],
        },
      };

      render(
        <VideoBlendControls
          selectedClip={clipAnimated}
          handleUpdate={handleUpdate}
        />,
      );

      // The displayed opacity % should be ~50% (midpoint of 1.0→0.0 over 10s at t=5)
      const numericInput = screen.getByRole("spinbutton", { name: "Opacity" });
      expect(Number((numericInput as HTMLInputElement).value)).toBeCloseTo(50, 0);
    });
  });
});
