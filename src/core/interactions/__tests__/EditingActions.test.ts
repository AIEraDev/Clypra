import { beforeEach, describe, expect, it } from "vitest";
import { EditingActions } from "../EditingActions";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import type { Clip, Project } from "@/types";

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
    expect(result.error).toBe("Split time 0.00s snaps to a clip boundary");
    expect(useTimelineStore.getState().clips).toHaveLength(1);
    expect(useUIStore.getState().selectedClipIds).toEqual([]);
  });

  it("ripple deletes a selected middle range and selects the next clip", () => {
    useTimelineStore.setState({
      clips: [
        makeClip({ id: "left", startTime: 0, duration: 2, trimOut: 2 }),
        makeClip({ id: "middle-a", startTime: 2, duration: 2, trimIn: 2, trimOut: 4 }),
        makeClip({ id: "middle-b", startTime: 4, duration: 2, trimIn: 4, trimOut: 6 }),
        makeClip({ id: "right", startTime: 6, duration: 4, trimIn: 6, trimOut: 10 }),
      ],
      gaps: [{ id: "stale-gap", trackId: "track-1", startTime: 2, duration: 4, type: "auto", source: "clip-delete", protected: false }],
    });

    const result = EditingActions.deleteSelection(["middle-a", "middle-b"]);
    const state = useTimelineStore.getState();
    expect(result).toMatchObject({ editTime: 2, selectedClipId: "right" });
    expect(state.clips.find((clip) => clip.id === "right")?.startTime).toBe(2);
    expect(state.gaps).toEqual([]);
    expect(useUIStore.getState().selectedClipIds).toEqual(["right"]);

    useHistoryStore.getState().undo();
    expect(useTimelineStore.getState().clips.map((clip) => [clip.id, clip.startTime])).toEqual([
      ["left", 0],
      ["middle-a", 2],
      ["middle-b", 4],
      ["right", 6],
    ]);
  });

  it("lift deletes without shifting later clips", () => {
    useTimelineStore.setState({
      clips: [makeClip({ id: "left", startTime: 0, duration: 5, trimOut: 5 }), makeClip({ id: "right", startTime: 5, duration: 5, trimIn: 5, trimOut: 10 })],
    });
    EditingActions.deleteSelection(["left"], true);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === "right")?.startTime).toBe(5);
  });
});
