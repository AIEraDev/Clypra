import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClipContextMenu } from "../ClipContextMenu";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";

vi.mock("@/lib/toast", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({ time: 5 }),
}));

describe("ClipContextMenu Variant Filtering & Selection Awareness", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [
        {
          id: "clip-1",
          trackId: "track-1",
          mediaId: "asset-1",
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
          volume: 1.0,
        } as any,
        {
          id: "clip-2",
          trackId: "track-1",
          mediaId: "asset-2",
          startTime: 10,
          duration: 10,
          trimIn: 0,
          trimOut: 10,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
          volume: 1.0,
        } as any,
        {
          id: "clip-3",
          trackId: "track-1",
          mediaId: "asset-3",
          startTime: 20,
          duration: 10,
          trimIn: 0,
          trimOut: 10,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
          volume: 1.0,
        } as any,
      ],
    });
  });

  it("renders single-clip only commands when a single clip is selected", () => {
    useUIStore.setState({ selectedClipIds: ["clip-1"] });

    render(
      <ClipContextMenu
        clickedClipId="clip-1"
        clickedTrackId="track-1"
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />,
    );

    // Single-clip actions should be present
    expect(screen.getByText("Trim Start to Playhead")).toBeInTheDocument();
    expect(screen.getByText("Trim End to Playhead")).toBeInTheDocument();
    expect(screen.getByText("Inspect Properties")).toBeInTheDocument();
    // Swap requires exactly 2 clips, so it should not be visible when 1 clip is selected
    expect(screen.queryByText("Swap Clips")).not.toBeInTheDocument();
  });

  it("renders Swap Clips when exactly 2 clips are selected", () => {
    useUIStore.setState({ selectedClipIds: ["clip-1", "clip-2"] });

    render(
      <ClipContextMenu
        clickedClipId="clip-1"
        clickedTrackId="track-1"
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Swap Clips")).toBeInTheDocument();
  });

  it("filters out single-clip only commands when 3 clips are selected (Batch Multi-Select Menu)", () => {
    useUIStore.setState({ selectedClipIds: ["clip-1", "clip-2", "clip-3"] });

    render(
      <ClipContextMenu
        clickedClipId="clip-1"
        clickedTrackId="track-1"
        position={{ x: 100, y: 100 }}
        onClose={vi.fn()}
      />,
    );

    // Batch operations must be present
    expect(screen.getByText("Cut")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Ripple Delete")).toBeInTheDocument();
    expect(screen.getByText("Delete / Lift (Leave Gap)")).toBeInTheDocument();
    expect(screen.getByText("Mute / Unmute")).toBeInTheDocument();

    // Single-clip specific operations must NOT be present
    expect(screen.queryByText("Trim Start to Playhead")).not.toBeInTheDocument();
    expect(screen.queryByText("Trim End to Playhead")).not.toBeInTheDocument();
    expect(screen.queryByText("Inspect Properties")).not.toBeInTheDocument();
    expect(screen.queryByText("Swap Clips")).not.toBeInTheDocument();
  });
});
