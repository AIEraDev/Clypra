import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditingActions } from "../EditingActions";
import { SplitClipCommand } from "@/core/history/commands";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip, Project } from "@/types";

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => ({ time: 2 }),
}));

const project: Project = {
  id: "project-1",
  name: "Test Project",
  createdAt: 0,
  updatedAt: 0,
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 10,
};

const makeClip = (overrides: Partial<Clip> = {}): Clip => ({
  id: "clip-1",
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
  ...overrides,
});

describe("EditingActions split interactions", () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useProjectStore.setState({ project, mediaAssets: [] });
    useUIStore.setState({
      selectedClipIds: [],
      selectedGapId: null,
      selectedTransitionId: null,
      selectedTrackId: null,
    });
    useTimelineStore.setState({
      tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
      clips: [makeClip()],
      transitions: [],
      mainVideoTrackId: "track-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns and selects the right clip when split time is frame-snapped", () => {
    const result = EditingActions.executeSplit({
      clipId: "clip-1",
      time: 5.467,
      source: "click",
    });

    const snappedTime = Math.round(5.467 * project.frameRate) / project.frameRate;
    const clips = useTimelineStore.getState().clips;
    const rightClip = clips.find((clip) => clip.id === result.rightClipId);

    expect(result.success).toBe(true);
    expect(result.rightClipId).toBeDefined();
    expect(rightClip).toBeDefined();
    expect(rightClip?.startTime).toBeCloseTo(snappedTime, 6);
    expect(useUIStore.getState().selectedClipIds).toEqual([result.leftClipId, result.rightClipId]);
  });

  it("rejects split when the requested time snaps to a clip boundary", () => {
    const result = EditingActions.executeSplit({
      clipId: "clip-1",
      time: 0.001,
      source: "click",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("拆分时间 0.00 秒吸附到片段边界");
    expect(useTimelineStore.getState().clips).toHaveLength(1);
    expect(useUIStore.getState().selectedClipIds).toEqual([]);
  });

  it("keeps a dynamic clip ID in the localized missing-clip error", () => {
    const result = EditingActions.executeSplit({ clipId: "clip-dynamic-42", time: 1, source: "click" });

    expect(result.error).toBe("未找到片段 clip-dynamic-42");
  });

  it("keeps dynamic seconds in the localized out-of-bounds error", () => {
    const result = EditingActions.executeSplit({ clipId: "clip-1", time: 12.345, source: "click" });

    expect(result.error).toBe("拆分时间 12.35 秒超出片段范围 [0.00 秒, 10.00 秒]");
  });

  it("localizes locked-track and non-Error split failures", () => {
    useTimelineStore.setState({ tracks: [{ ...useTimelineStore.getState().tracks[0], locked: true }] });
    expect(EditingActions.executeSplit({ clipId: "clip-1", time: 5, source: "click" }).error).toBe("锁定轨道上的片段无法拆分");

    useTimelineStore.setState({ tracks: [{ ...useTimelineStore.getState().tracks[0], locked: false }] });
    vi.spyOn(useHistoryStore.getState(), "execute").mockImplementation(() => {
      throw "split failure";
    });
    expect(EditingActions.executeSplit({ clipId: "clip-1", time: 5, source: "click" }).error).toBe("未知拆分错误");
  });

  it("passes through external Error messages unchanged", () => {
    vi.spyOn(useHistoryStore.getState(), "execute").mockImplementation(() => {
      throw new Error("external encoder failure");
    });

    expect(EditingActions.executeSplit({ clipId: "clip-1", time: 5, source: "click" }).error).toBe("external encoder failure");
  });

  it("localizes the error when the split command does not provide both clip IDs", () => {
    vi.spyOn(SplitClipCommand.prototype, "getLeftClipId").mockReturnValue(null);

    const result = EditingActions.executeSplit({ clipId: "clip-1", time: 5, source: "click" });

    expect(result.error).toBe("拆分未生成两个片段");
  });

  it("localizes the error when split IDs are absent from the new timeline state", () => {
    vi.spyOn(useHistoryStore.getState(), "execute").mockImplementation(() => {});
    vi.spyOn(SplitClipCommand.prototype, "getLeftClipId").mockReturnValue("left-id");
    vi.spyOn(SplitClipCommand.prototype, "getRightClipId").mockReturnValue("right-id");

    const result = EditingActions.executeSplit({ clipId: "clip-1", time: 5, source: "click" });

    expect(result.error).toBe("在时间线中未找到拆分后的片段");
  });

  it("localizes the non-Error trim fallback", () => {
    vi.spyOn(useHistoryStore.getState(), "execute").mockImplementation(() => {
      throw "trim failure";
    });

    expect(EditingActions.deleteLeftAtPlayhead()).toEqual([{ success: false, clipId: "clip-1", error: "未知裁剪错误" }]);
  });

  it("passes through external trim Error messages unchanged", () => {
    vi.spyOn(useHistoryStore.getState(), "execute").mockImplementation(() => {
      throw new Error("REMOTE_TRIM_ERR_RAW");
    });

    expect(EditingActions.deleteLeftAtPlayhead()).toEqual([{ success: false, clipId: "clip-1", error: "REMOTE_TRIM_ERR_RAW" }]);
  });

  it.each([
    ["left", () => EditingActions.deleteLeftAtPlayhead(), "删除播放头左侧"],
    ["right", () => EditingActions.deleteRightAtPlayhead(), "删除播放头右侧"],
  ] as const)("begins a localized delete-%s transaction", (_side, action, expectedLabel) => {
    const beginTransaction = vi.spyOn(useHistoryStore.getState().journal, "beginTransaction");

    const result = action();

    expect(result).toHaveLength(1);
    expect(beginTransaction).toHaveBeenCalledWith(expectedLabel);
  });
});
