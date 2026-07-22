import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrackLabel } from "../TrackLabel";
import { TrackList } from "../TrackList";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { GapManager } from "@/lib/timeline/gapManager";

describe("TrackLabel interactions", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
        { id: "track-2", type: "audio", name: "Audio 1", muted: false, locked: false, visible: true, height: 52 },
      ],
      clips: [],
      gaps: [],
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
    render(
      <>
        <TrackLabel track={tracks[0]} />
        <TrackLabel track={tracks[1]} />
      </>
    );

    const lockButton = screen.getAllByLabelText("锁定轨道")[0];
    const visibilityButton = screen.getAllByLabelText("隐藏轨道")[0];
    const muteButton = screen.getAllByLabelText("静音轨道")[0];
    expect(lockButton).toHaveAttribute("title", "锁定轨道");
    expect(visibilityButton).toHaveAttribute("title", "隐藏轨道");
    expect(muteButton).toHaveAttribute("title", "静音轨道");

    fireEvent.click(lockButton);
    fireEvent.click(visibilityButton);
    fireEvent.click(muteButton);

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

    fireEvent.click(screen.getAllByLabelText("锁定轨道")[0]);
    fireEvent.click(screen.getAllByLabelText("隐藏轨道")[0]);
    fireEvent.click(screen.getAllByLabelText("静音轨道")[0]);

    expect(useUIStore.getState().selectedTrackId).toBeNull();
  });

  it("renders the raw track name and localized inverse controls", () => {
    const track = { id: "raw-track-id", type: "video" as const, name: "客户原始 Track 7", muted: true, locked: true, visible: false, height: 68 };
    render(<TrackLabel track={track} />);

    expect(screen.getByText("客户原始 Track 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "解锁轨道" })).toHaveAttribute("title", "解锁轨道");
    expect(screen.getByRole("button", { name: "显示轨道" })).toHaveAttribute("title", "显示轨道");
    expect(screen.getByRole("button", { name: "取消静音" })).toHaveAttribute("title", "取消静音");
  });

  it("packs the original track and exposes a localized accessible name", () => {
    const packTrack = vi.spyOn(GapManager, "packTrack").mockImplementation(() => undefined);
    const track = useTimelineStore.getState().tracks[0];
    useTimelineStore.setState({ gaps: [{ id: "gap-1", trackId: track.id, startTime: 1, duration: 2, type: "manual", source: "user-insert", protected: false }] });
    render(<TrackLabel track={track} />);

    const button = screen.getByRole("button", { name: "收紧轨道（移除间隙）" });
    expect(button).toHaveAttribute("title", "收紧轨道 - 移除所有未保护间隙");
    fireEvent.click(button);
    expect(packTrack).toHaveBeenCalledWith("track-1");
  });
});

describe("TrackList localization", () => {
  it("renders localized heading and empty state", () => {
    useTimelineStore.setState({ tracks: [], clips: [], gaps: [] });

    render(<TrackList />);

    expect(screen.getByText("轨道")).toBeInTheDocument();
    expect(screen.getByText("暂无轨道")).toBeInTheDocument();
  });
});
