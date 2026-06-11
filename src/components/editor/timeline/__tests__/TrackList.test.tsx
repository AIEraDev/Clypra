import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrackLabel } from "../TrackLabel";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";

describe("TrackLabel interactions", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "audio", name: "Audio 1", muted: false, locked: false, visible: true, height: 52 },
      ],
      clips: [],
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
    });
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

  it("toggles lock, eye, and mute for only the clicked track", () => {
    const tracks = useTimelineStore.getState().tracks;
    const { rerender } = render(
      <>
        <TrackLabel track={tracks[0]} />
        <TrackLabel track={tracks[1]} />
      </>
    );

    fireEvent.click(screen.getAllByLabelText("Lock track")[0]);
    fireEvent.click(screen.getAllByLabelText("Hide track")[0]);
    fireEvent.click(screen.getAllByLabelText("Mute track")[0]);

    const [first, second] = useTimelineStore.getState().tracks;
    expect(first.locked).toBe(true);
    expect(first.visible).toBe(false);
    expect(first.muted).toBe(true);

    expect(second.locked).toBe(false);
    expect(second.visible).toBe(true);
    expect(second.muted).toBe(false);
  });

  it("button clicks do not change selected track", () => {
    const tracks = useTimelineStore.getState().tracks;
    render(
      <>
        <TrackLabel track={tracks[0]} />
        <TrackLabel track={tracks[1]} />
      </>
    );

    fireEvent.click(screen.getAllByLabelText("Lock track")[0]);
    fireEvent.click(screen.getAllByLabelText("Hide track")[0]);
    fireEvent.click(screen.getAllByLabelText("Mute track")[0]);

    expect(useUIStore.getState().selectedTrackId).toBeNull();
  });
});
