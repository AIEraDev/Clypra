import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineEmptySpaceContextMenu } from "../TimelineEmptySpaceContextMenu";
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
  getPlaybackClock: () => ({ time: 10 }),
}));

describe("TimelineEmptySpaceContextMenu component", () => {
  beforeEach(() => {
    clipboardService.clear();
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "audio", name: "Audio 1", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [],
      gaps: [],
      transitions: [],
    });
    useUIStore.setState({ selectedClipIds: [], selectedTrackId: null });
  });

  it("renders empty-space context menu items", () => {
    const onClose = vi.fn();
    render(
      <TimelineEmptySpaceContextMenu
        clickedTrackId="track-1"
        clickedTime={10}
        position={{ x: 200, y: 300 }}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Paste at Cursor")).toBeInTheDocument();
    expect(screen.getByText("Insert Gap (2s)")).toBeInTheDocument();
    expect(screen.getByText("Close All Gaps on Track")).toBeInTheDocument();
    expect(screen.getByText("Add Video Track")).toBeInTheDocument();
    expect(screen.getByText("Add Audio Track")).toBeInTheDocument();
    expect(screen.getByText("Toggle Track Lock")).toBeInTheDocument();
    expect(screen.getByText("Toggle Track Mute")).toBeInTheDocument();
    expect(screen.getByText("Toggle Track Visibility")).toBeInTheDocument();
  });

  it("disables Paste when clipboard is empty, and enables when clipboard has clips", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <TimelineEmptySpaceContextMenu
        clickedTrackId="track-1"
        clickedTime={10}
        position={{ x: 200, y: 300 }}
        onClose={onClose}
      />,
    );

    const pasteBtn = screen.getByRole("button", { name: /paste at cursor/i });
    expect(pasteBtn).toBeDisabled();
    expect(pasteBtn).toHaveAttribute("title", "Clipboard is empty");

    // Add items to clipboard
    useTimelineStore.setState({
      clips: [
        {
          id: "clip-src",
          trackId: "track-1",
          mediaId: "asset-1",
          startTime: 0,
          duration: 5,
          trimIn: 0,
          trimOut: 5,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        } as any,
      ],
    });
    clipboardService.copyClips(["clip-src"]);

    rerender(
      <TimelineEmptySpaceContextMenu
        clickedTrackId="track-1"
        clickedTime={10}
        position={{ x: 200, y: 300 }}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole("button", { name: /paste at cursor/i })).not.toBeDisabled();
  });

  it("executes Add Video Track when clicked", () => {
    const onClose = vi.fn();
    render(
      <TimelineEmptySpaceContextMenu
        clickedTrackId="track-1"
        clickedTime={10}
        position={{ x: 200, y: 300 }}
        onClose={onClose}
      />,
    );

    const addVideoBtn = screen.getByRole("button", { name: /add video track/i });
    fireEvent.click(addVideoBtn);

    expect(useTimelineStore.getState().tracks.length).toBe(3);
    expect(useTimelineStore.getState().tracks[0].type).toBe("video");
    expect(useTimelineStore.getState().tracks[1].id).toBe("track-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("toggles track lock on clicked track", () => {
    const onClose = vi.fn();
    render(
      <TimelineEmptySpaceContextMenu
        clickedTrackId="track-1"
        clickedTime={10}
        position={{ x: 200, y: 300 }}
        onClose={onClose}
      />,
    );

    const lockBtn = screen.getByRole("button", { name: /toggle track lock/i });
    fireEvent.click(lockBtn);

    expect(useTimelineStore.getState().tracks.find((t) => t.id === "track-1")?.locked).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});
