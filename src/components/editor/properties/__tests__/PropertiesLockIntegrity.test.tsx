import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { VideoStyleSection } from "../video/sections/VideoStyleSection";
import { VideoAdjustTab } from "../video/tabs/VideoAdjustTab";
import { AudioStyleSection } from "../video/sections/AudioStyleSection";
import { SpeedStyleSection } from "../shared/SpeedSection";
import { TextStyleSection } from "../text/sections/TextStyleSection";
import type { Clip, TextClip } from "@/types";

// Mock i18n
vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "properties.tabs.basic": "Basic",
        "properties.tabs.speed": "Speed",
        "properties.tabs.voiceChanger": "Voice changer",
        "properties.transform.title": "Transform",
      };
      return dict[key] || key;
    },
  }),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock PlaybackClock
vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: 0,
    seek: vi.fn(),
  }),
}));

vi.mock("@/core/playback/PlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: 0,
    seek: vi.fn(),
  }),
}));

describe("Properties Panel: Locked Tabs Integrity & Invariant Suite", () => {
  const dummyVideoClip: Clip = {
    id: "test-video-clip",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    aspectRatioLocked: true,
  };

  const dummyTextClip: TextClip = {
    ...dummyVideoClip,
    id: "test-text-clip",
    kind: "text",
    text: "Sample Text",
    fontFamily: "Inter Variable",
    fontSize: 32,
    fontWeight: "normal",
    color: "#ffffff",
    align: "center",
    valign: "middle",
    lineHeight: 1.2,
    paddingX: 16,
    paddingY: 16,
  };

  it("SCN-LOCK-VID-01: VideoStyleSection retains locked tabs (Remove BG, Mask, Retouch) and prevents switching", () => {
    render(
      <VideoStyleSection
        selectedClip={dummyVideoClip}
        isVisualClip={true}
        canvasWidth={1920}
        canvasHeight={1080}
        handleUpdate={vi.fn()}
        handleUpdateMultiple={vi.fn()}
        handleApplyFit={vi.fn()}
      />,
    );

    // Verify all 4 tabs exist
    const basicTab = screen.getByRole("button", { name: /^Basic$/i });
    const removeBgTab = screen.getByRole("button", { name: /^Remove BG$/i });
    const maskTab = screen.getByRole("button", { name: /^Mask$/i });
    const retouchTab = screen.getByRole("button", { name: /^Retouch$/i });

    expect(basicTab).toBeInTheDocument();
    expect(removeBgTab).toBeInTheDocument();
    expect(maskTab).toBeInTheDocument();
    expect(retouchTab).toBeInTheDocument();

    // Verify locked tabs are disabled and have title "Coming soon"
    expect(basicTab).not.toBeDisabled();
    expect(removeBgTab).toBeDisabled();
    expect(removeBgTab).toHaveAttribute("title", "Coming soon");
    expect(maskTab).toBeDisabled();
    expect(maskTab).toHaveAttribute("title", "Coming soon");
    expect(retouchTab).toBeDisabled();
    expect(retouchTab).toHaveAttribute("title", "Coming soon");

    // Clicking locked tab does NOT switch away from Basic
    fireEvent.click(removeBgTab);
    expect(screen.queryByText("Remove Background feature coming soon")).not.toBeInTheDocument();
    // VideoTransformControls should still be mounted
    expect(screen.getByText("Transform")).toBeInTheDocument();
  });

  it("SCN-LOCK-VID-02: VideoAdjustTab keeps Curves, Color wheel, Mask locked while HSL is unlocked", () => {
    render(
      <VideoAdjustTab
        selectedClip={dummyVideoClip}
        handleUpdate={vi.fn()}
      />,
    );

    const basicTab = screen.getByRole("button", { name: /^Basic$/i });
    const hslTab = screen.getByRole("button", { name: /^HSL$/i });
    const curvesTab = screen.getByRole("button", { name: /^Curves$/i });
    const colorWheelTab = screen.getByRole("button", { name: /^Color wheel$/i });
    const maskTab = screen.getByRole("button", { name: /^Mask$/i });

    expect(basicTab).toBeInTheDocument();
    expect(hslTab).toBeInTheDocument();
    expect(curvesTab).toBeInTheDocument();
    expect(colorWheelTab).toBeInTheDocument();
    expect(maskTab).toBeInTheDocument();

    // Basic & HSL are unlocked
    expect(basicTab).not.toBeDisabled();
    expect(hslTab).not.toBeDisabled();

    // Curves, Color wheel, Mask are locked
    expect(curvesTab).toBeDisabled();
    expect(curvesTab).toHaveAttribute("title", "Coming soon");
    expect(colorWheelTab).toBeDisabled();
    expect(colorWheelTab).toHaveAttribute("title", "Coming soon");
    expect(maskTab).toBeDisabled();
    expect(maskTab).toHaveAttribute("title", "Coming soon");

    // Clicking HSL successfully switches
    fireEvent.click(hslTab);
    // Clicking locked Curves does NOT switch to curves
    fireEvent.click(curvesTab);
    expect(screen.queryByText("Curves feature coming soon")).not.toBeInTheDocument();
  });

  it("SCN-LOCK-SPD-01: SpeedSection retains Curve and Velocity effects as locked tabs", () => {
    render(
      <SpeedStyleSection
        selectedClip={dummyVideoClip}
        handleUpdate={vi.fn()}
      />,
    );

    const standardTab = screen.getByRole("button", { name: /^Standard$/i });
    const curveTab = screen.getByRole("button", { name: /^Curve$/i });
    const velocityTab = screen.getByRole("button", { name: /^Velocity effects$/i });

    expect(standardTab).toBeInTheDocument();
    expect(curveTab).toBeInTheDocument();
    expect(velocityTab).toBeInTheDocument();

    expect(standardTab).not.toBeDisabled();
    expect(curveTab).toBeDisabled();
    expect(curveTab).toHaveAttribute("title", "Coming soon");
    expect(velocityTab).toBeDisabled();
    expect(velocityTab).toHaveAttribute("title", "Coming soon");

    // Clicking Curve does NOT switch tab
    fireEvent.click(curveTab);
    expect(screen.queryByText("Speed curve feature coming soon")).not.toBeInTheDocument();
    // Standard speed controls stay visible
    expect(screen.getByText("Speed")).toBeInTheDocument();
  });

  it("SCN-LOCK-AUD-01: AudioStyleSection retains Voice changer locked", () => {
    render(
      <AudioStyleSection
        selectedClip={dummyVideoClip}
        handleUpdate={vi.fn()}
      />,
    );

    const basicTab = screen.getByRole("button", { name: /^Basic$/i });
    const voiceChangerTab = screen.getByRole("button", { name: /^Voice changer$/i });

    expect(basicTab).toBeInTheDocument();
    expect(voiceChangerTab).toBeInTheDocument();

    expect(basicTab).not.toBeDisabled();
    expect(voiceChangerTab).toBeDisabled();
    expect(voiceChangerTab).toHaveAttribute("title", "Coming soon");

    fireEvent.click(voiceChangerTab);
    expect(screen.getByText("Volume")).toBeInTheDocument();
  });

  it("SCN-LOCK-TXT-01: TextStyleSection retains Bubble locked and prevents switching", () => {
    render(
      <TextStyleSection
        textClip={dummyTextClip}
        presets={[]}
        newPresetName=""
        setNewPresetName={vi.fn()}
        handleUpdate={vi.fn()}
        handleUpdateMultiple={vi.fn()}
        handleUpdateImmediate={vi.fn()}
        handleUpdateMultipleImmediate={vi.fn()}
        handleApplyPreset={vi.fn()}
        savePreset={vi.fn()}
        deletePreset={vi.fn()}
      />,
    );

    const basicTab = screen.getByRole("button", { name: /^Basic$/i });
    const bubbleTab = screen.getByRole("button", { name: /^Bubble$/i });

    expect(basicTab).toBeInTheDocument();
    expect(bubbleTab).toBeInTheDocument();

    expect(basicTab).not.toBeDisabled();
    expect(bubbleTab).toBeDisabled();
    expect(bubbleTab).toHaveAttribute("title", "Coming soon");

    fireEvent.click(bubbleTab);
    // Textarea content remains visible
    expect(screen.getByRole("textbox", { name: /Plain text content/i })).toBeInTheDocument();
  });
});
