import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { InlineKeyframeLane } from "../InlineKeyframeLane";
import { useUIStore } from "@/store/uiStore";
import { useTimelineStore } from "@/store/timelineStore";
import type { Clip } from "@/types";

const mockSeek = vi.fn();
let mockClockTime = 1.0;
vi.mock("@/hooks/usePlaybackClock", () => ({
  usePlaybackClock: () => ({ time: mockClockTime, isPlaying: false, duration: 10 }),
  usePlaybackControls: () => ({ seek: mockSeek, play: vi.fn(), pause: vi.fn() }),
  getPlaybackClock: () => ({ time: mockClockTime, isPlaying: false, duration: 10, seek: mockSeek }),
}));

describe("InlineKeyframeLane", () => {
  const clipWithKeyframes: Clip = {
    id: "clip-kf-1",
    trackId: "track-1",
    mediaId: "media-1",
    startTime: 2,
    duration: 6,
    trimIn: 0,
    trimOut: 6,
    x: 100,
    y: 200,
    width: 1920,
    height: 1080,
    rotation: 0,
    opacity: 1,
    visualKeyframes: {
      rotation: [
        { id: "kf-rot-1", time: 0, value: 0, easing: "linear" },
        { id: "kf-rot-2", time: 3, value: 45, easing: "easeOut" },
      ],
      opacity: [
        { id: "kf-op-1", time: 1, value: 0, easing: "easeIn" },
        { id: "kf-op-2", time: 4, value: 1, easing: "easeOut" },
      ],
    },
  };

  beforeEach(() => {
    mockClockTime = 1.0;
    mockSeek.mockClear();
    useTimelineStore.setState({
      clips: [clipWithKeyframes],
    });
    useUIStore.setState({
      expandedKeyframeClipIds: [],
      activeCurveEditor: null,
    });
  });

  it("renders compact mode with diamond keyframe markers", () => {
    render(
      <InlineKeyframeLane
        clip={clipWithKeyframes}
        clipWidthPx={600}
        pixelsPerSecond={100}
        isExpanded={false}
      />,
    );

    const diamonds = screen.getAllByRole("button");
    expect(diamonds.length).toBeGreaterThan(0);
  });

  it("seeks playhead when a keyframe diamond is clicked", () => {
    render(
      <InlineKeyframeLane
        clip={clipWithKeyframes}
        clipWidthPx={600}
        pixelsPerSecond={100}
        isExpanded={false}
      />,
    );

    const diamonds = screen.getAllByRole("button");
    fireEvent.click(diamonds[0]);
    expect(mockSeek).toHaveBeenCalledWith(clipWithKeyframes.startTime + 0);
  });

  it("renders expanded sub-lanes with property labels when isExpanded is true", () => {
    render(
      <InlineKeyframeLane
        clip={clipWithKeyframes}
        clipWidthPx={600}
        pixelsPerSecond={100}
        isExpanded={true}
      />,
    );

    expect(screen.getByText(/Keyframe Animation Lanes/i)).toBeInTheDocument();
    expect(screen.getByText("Rotation")).toBeInTheDocument();
    expect(screen.getByText("Opacity")).toBeInTheDocument();
  });

  it("opens Curve Editor when segment curve is clicked in expanded mode", () => {
    render(
      <InlineKeyframeLane
        clip={clipWithKeyframes}
        clipWidthPx={600}
        pixelsPerSecond={100}
        isExpanded={true}
      />,
    );

    const curveSegments = screen.getAllByTitle(/Click to Edit Curve/i);
    fireEvent.click(curveSegments[0]);

    expect(useUIStore.getState().activeCurveEditor).toEqual({
      clipId: "clip-kf-1",
      property: "rotation",
      keyframeIndex: 0,
    });
  });

  it("highlights the parked keyframe in Clypra's bg-accent and inactive in bg-white/95", () => {
    // clip.startTime is 2. Setting clock time to 5.0 puts localTime at 3.0 (kf-rot-2 at 3s)
    mockClockTime = 5.0;

    render(
      <InlineKeyframeLane
        clip={clipWithKeyframes}
        clipWidthPx={600}
        pixelsPerSecond={100}
        isExpanded={false}
      />,
    );

    const diamonds = screen.getAllByRole("button");
    // We have unique times: 0, 1, 3, 4 -> 4 diamonds
    expect(diamonds.length).toBe(4);

    // The 3rd diamond (at local time 3s) should be parked / active with Clypra's bg-accent
    expect(diamonds[2].className).toContain("bg-accent");

    // The other diamonds (e.g. 1st at local time 0s) should be inactive with Clypra's bg-white/95
    expect(diamonds[0].className).toContain("bg-white/95");
    expect(diamonds[1].className).toContain("bg-white/95");
    expect(diamonds[3].className).toContain("bg-white/95");
  });

  it("deletes selected compound keyframe when Delete key is pressed", () => {
    mockClockTime = 0;

    render(
      <InlineKeyframeLane
        clip={clipWithKeyframes}
        clipWidthPx={600}
        pixelsPerSecond={100}
        isExpanded={false}
      />,
    );

    const diamonds = screen.getAllByRole("button");
    // Click 1st diamond at time 0
    fireEvent.click(diamonds[0]);

    // Press Delete
    fireEvent.keyDown(window, { key: "Delete" });

    const updatedClips = useTimelineStore.getState().clips;
    const clipAfterDelete = updatedClips.find((c) => c.id === clipWithKeyframes.id);
    expect(clipAfterDelete?.visualKeyframes?.rotation?.some((k) => k.time === 0)).toBe(false);
  });
});
