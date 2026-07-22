import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Track } from "../Track";
import { useUIStore } from "@/store/uiStore";

const addClipFromAsset = vi.fn();
const getMediaAsset = vi.fn(() => ({ id: "asset-1", name: "Clip A", type: "video", duration: 5, path: "/a", size: 1 }));

vi.mock("react-dnd", () => ({
  useDrop: () => [{}, () => undefined],
  useDrag: () => [{ isDragging: false }, () => undefined],
}));

vi.mock("@/hooks/useTimeline", () => ({
  useTimeline: () => ({
    addClipFromAsset,
    getMediaAsset,
  }),
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
    render(<Track track={{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: false, height: 68 }} pixelsPerSecond={100} clips={[{ id: "clip-1", trackId: "track-1", mediaId: "asset-1", startTime: 0, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 }]} />);

    expect(screen.queryByText("Clip A")).not.toBeInTheDocument();
  });

  it("prevents clip selection when track is locked", () => {
    render(<Track track={{ id: "track-1", type: "video", name: "Video", muted: false, locked: true, visible: true, height: 68 }} pixelsPerSecond={100} clips={[{ id: "clip-1", trackId: "track-1", mediaId: "asset-1", startTime: 0, duration: 5, trimIn: 0, trimOut: 5, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 }]} />);

    fireEvent.click(screen.getByText("Clip A"));
    expect(useUIStore.getState().selectedClipIds).toHaveLength(0);
    expect(screen.getByText("已锁定")).toBeInTheDocument();
  });
});
