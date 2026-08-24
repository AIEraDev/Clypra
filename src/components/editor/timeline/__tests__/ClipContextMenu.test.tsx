import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ClipContextMenu } from "../ClipContextMenu";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { clipboardService } from "@/core/clipboard/clipboardService";

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

describe("ClipContextMenu component", () => {
  beforeEach(() => {
    clipboardService.clear();
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
          startTime: 12,
          duration: 8,
          trimIn: 0,
          trimOut: 8,
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
    useUIStore.setState({ selectedClipIds: ["clip-1"] });
  });

  it("renders single-clip context menu with groups and actions", () => {
    const onClose = vi.fn();
    render(
      <ClipContextMenu
        clickedClipId="clip-1"
        clickedTrackId="track-1"
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Cut")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Split at Playhead")).toBeInTheDocument();
    expect(screen.getByText("Ripple Delete")).toBeInTheDocument();
    expect(screen.getByText("Mute / Unmute")).toBeInTheDocument();
    expect(screen.getByText("Inspect Properties")).toBeInTheDocument();
  });

  it("disables Split at Playhead when playhead is outside clicked clip bounds", () => {
    const onClose = vi.fn();
    // Playhead is at 5s, clip-2 is 12s..20s
    useUIStore.setState({ selectedClipIds: ["clip-2"] });

    render(
      <ClipContextMenu
        clickedClipId="clip-2"
        clickedTrackId="track-1"
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />,
    );

    const splitBtn = screen.getByRole("button", { name: /split at playhead/i });
    expect(splitBtn).toBeDisabled();
    expect(splitBtn).toHaveAttribute("title", "Playhead is outside clip bounds");
  });

  it("executes copy and closes menu on item click", () => {
    const onClose = vi.fn();
    render(
      <ClipContextMenu
        clickedClipId="clip-1"
        clickedTrackId="track-1"
        position={{ x: 100, y: 100 }}
        onClose={onClose}
      />,
    );

    const copyBtn = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyBtn);

    expect(clipboardService.hasClips()).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});
