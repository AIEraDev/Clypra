import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Track } from "../Track";
import { useUIStore } from "@/store/uiStore";
import type { TrackVisualSpec } from "@/lib/timeline/trackTypeConfig";

const addClipFromAsset = vi.fn();
const getMediaAsset = vi.fn(() => ({ id: "asset-1", name: "Clip A", type: "video", duration: 5, path: "/a", size: 1 }));

vi.mock("react-dnd", () => ({
  useDrop: () => [{}, () => undefined],
  useDrag: () => [{ isDragging: false }, () => undefined],
}));

vi.mock("@/hooks", () => ({
  useTimeline: () => ({
    addClipFromAsset,
    getMediaAsset,
  }),
}));

vi.mock("../TimelineWaveform", () => ({
  TimelineWaveform: () => null,
}));

vi.mock("../ClipFilmstrip", () => ({
  ClipFilmstrip: () => null,
}));

describe("Track timeline behavior", () => {
  beforeEach(() => {
    addClipFromAsset.mockClear();
    getMediaAsset.mockClear();
    useUIStore.setState({
      selectedClipIds: [],
      selectedTrackId: null,
      previewMediaId: null,
      activePanel: "media",
      showExportModal: false,
      showNewProjectModal: false,
      showSettingsModal: false,
    });
  });

  it("does not render clips when track is invisible", () => {
    render(<Track track={{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: false, height: 68 }} pixelsPerSecond={100} clips={[{ id: "clip-1", trackId: "track-1", mediaId: "asset-1", name: "Clip A", startTime: 0, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 }]} />);

    expect(screen.queryByText("Clip A")).not.toBeInTheDocument();
  });

  it("prevents clip selection when track is locked", () => {
    render(<Track track={{ id: "track-1", type: "video", name: "Video", muted: false, locked: true, visible: true, height: 68 }} pixelsPerSecond={100} clips={[{ id: "clip-1", trackId: "track-1", mediaId: "asset-1", name: "Clip A", startTime: 0, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 }]} />);

    fireEvent.click(screen.getByTestId("clip-clip-1"));
    expect(useUIStore.getState().selectedClipIds).toHaveLength(0);
  });

  it("repaints the clip volume immediately when the track receives an update", () => {
    const track = { id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 80 } as any;
    const clip = {
      id: "clip-1",
      trackId: "track-1",
      mediaId: "asset-1",
      name: "Clip A",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1,
      rotation: 0,
      volume: 0.66,
    };

    const { rerender } = render(
      <Track track={track} pixelsPerSecond={100} clips={[clip] as any} />,
    );
    expect(screen.getByRole("slider", { name: "Clip volume" })).toHaveAttribute(
      "aria-valuenow",
      "66",
    );

    rerender(
      <Track
        track={track}
        pixelsPerSecond={100}
        clips={[{ ...clip, volume: 0.31 }] as any}
      />,
    );

    expect(screen.getByRole("slider", { name: "Clip volume" })).toHaveAttribute(
      "aria-valuenow",
      "31",
    );
  });

  it("passes the strict B-roll visual role to the track and its clips", () => {
    const visualSpec: TrackVisualSpec = {
      role: "b-roll",
      label: "B-Roll",
      height: 80,
      opacity: 0.8,
      tone: "secondary",
    };
    const track = { id: "track-b", type: "video", name: "Overlay", muted: false, locked: false, visible: true, height: 68 } as any;

    render(<Track track={track} visualSpec={visualSpec} pixelsPerSecond={100} clips={[]} />);

    expect(document.querySelector('[data-track-id="track-b"]')).toHaveStyle({ height: "80px" });
  });
});
