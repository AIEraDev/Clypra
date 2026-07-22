import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineToolbar } from "../TimelineToolbar";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN } from "@/lib/timeline/timelineZoom";
import { EditingActions } from "@/core/interactions";

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({
    time: 2,
  }),
}));

describe("TimelineToolbar zoom controls", () => {
  let scroller: HTMLDivElement;

  beforeEach(() => {
    useHistoryStore.getState().clear();
    useTimelineStore.setState({
      tracks: [{ id: "track-1", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 }],
      clips: [
        {
          id: "clip-1",
          kind: "video",
          trackId: "track-1",
          mediaId: "asset-1",
          startTime: 0,
          duration: 20,
          trimIn: 0,
          trimOut: 20,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        } as any,
        {
          id: "clip-2",
          kind: "video",
          trackId: "track-1",
          mediaId: "asset-2",
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
        } as any,
      ],
      zoomLevel: 1,
      scrollLeft: 100,
      pixelsPerSecond: 100,
    });
    useUIStore.setState({ selectedClipIds: [] });

    scroller = document.createElement("div");
    scroller.id = "timeline-tracks-container";
    Object.defineProperty(scroller, "clientWidth", { value: 800, configurable: true });
    Object.defineProperty(scroller, "scrollLeft", { value: 100, writable: true, configurable: true });
    Object.defineProperty(scroller, "scrollWidth", { value: 2160, configurable: true });
    document.body.appendChild(scroller);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    scroller.remove();
  });

  it("keeps the visible playhead anchored when zooming with toolbar buttons", () => {
    render(<TimelineToolbar />);

    fireEvent.click(screen.getByRole("button", { name: "放大时间线" }));

    expect(useTimelineStore.getState().pixelsPerSecond).toBeCloseTo(110, 5);
    expect(scroller.scrollLeft).toBeCloseTo(120, 5);
    expect(useTimelineStore.getState().scrollLeft).toBeCloseTo(120, 5);
  });

  it("gives every toolbar button a Chinese accessible name matching its tooltip", () => {
    useUIStore.setState({ selectedClipIds: ["clip-1", "clip-2"] });
    render(<TimelineToolbar />);

    const labels = [
      "撤销 (Cmd+Z)",
      "重做 (Cmd+Shift+Z)",
      "交换所选片段 (Ctrl+Shift+S)",
      "删除播放头左侧 (Q)",
      "删除播放头右侧 (W)",
      "拆分播放头处全部片段 (S)",
      "波纹模式 (R)：影响拖动、裁剪和删除操作",
      "删除所选片段",
      "复制所选片段 (Cmd/Ctrl+D)",
      "消除间隙",
      "缩小时间线",
      "放大时间线",
    ];

    labels.forEach((label) => {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-label", label);
    });
    expect(screen.getByRole("button", { name: "缩小时间线" })).toHaveAttribute("title", "缩小时间线");
    expect(screen.getByRole("button", { name: "放大时间线" })).toHaveAttribute("title", "放大时间线");
  });

  it("describes the zoom slider entirely in Chinese with two decimal places", () => {
    useTimelineStore.setState({ zoomLevel: 1.25, pixelsPerSecond: 125 });
    render(<TimelineToolbar />);

    const slider = screen.getByRole("slider", { name: "时间线缩放" });
    expect(slider).toHaveAttribute("aria-valuetext", "缩放 1.25 倍，空间层级：细节，时间层级：编辑采样，采样间隔：200 毫秒");
    expect(slider).toHaveAttribute("aria-valuemin", String(TIMELINE_ZOOM_MIN));
    expect(slider).toHaveAttribute("aria-valuemax", String(TIMELINE_ZOOM_MAX));
    expect(slider).toHaveAttribute("aria-valuenow", "1.25");
  });

  it("preserves Arrow, Home, and End zoom keyboard behavior", () => {
    render(<TimelineToolbar />);
    const slider = screen.getByRole("slider", { name: "时间线缩放" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(useTimelineStore.getState().zoomLevel).toBeCloseTo(1.1, 5);

    fireEvent.keyDown(slider, { key: "Home" });
    expect(useTimelineStore.getState().zoomLevel).toBe(TIMELINE_ZOOM_MIN);

    fireEvent.keyDown(slider, { key: "End" });
    expect(useTimelineStore.getState().zoomLevel).toBe(TIMELINE_ZOOM_MAX);
  });

  it("shows localized split counts without English plural logic", () => {
    vi.spyOn(EditingActions, "splitAtPlayhead").mockReturnValue([
      { success: true, leftClipId: "left-1", rightClipId: "right-1" },
      { success: true, leftClipId: "left-2", rightClipId: "right-2" },
    ]);
    render(<TimelineToolbar />);

    fireEvent.click(screen.getByRole("button", { name: "拆分播放头处全部片段 (S)" }));

    expect(screen.getByRole("alert")).toHaveTextContent("已拆分 2 个片段");
  });

  it("begins a localized transaction when deleting selected clips", () => {
    const beginTransaction = vi.spyOn(useHistoryStore.getState().journal, "beginTransaction");
    useUIStore.setState({ selectedClipIds: ["clip-1"] });

    const { container } = render(<TimelineToolbar />);
    const deleteButton = container.querySelector(".lucide-trash-2")?.closest("button");
    expect(deleteButton).toBeTruthy();
    fireEvent.click(deleteButton!);

    expect(beginTransaction).toHaveBeenCalledWith("删除片段");
  });
});
