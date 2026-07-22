import { describe, it, expect, beforeEach } from "vitest";
import { getDefaultTrackName, useTimelineStore } from "../timelineStore";
import { useHistoryStore } from "../historyStore";
import { useUIStore } from "../uiStore";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import { resetIdGenerator } from "@/lib/utils/id";
import type { Clip, TrackType } from "@/types";

beforeEach(() => {
  useUIStore.setState({ selectedClipIds: [] });
});

describe("timeline track localization", () => {
  beforeEach(() => {
    resetIdGenerator("timeline-track-test");
    useTimelineStore.setState({ tracks: [], clips: [], transitions: [], mainVideoTrackId: null });
  });

  it.each([
    ["video", "视频轨道 7"],
    ["audio", "音频轨道 7"],
    ["text", "文字轨道 7"],
    ["sticker", "贴纸轨道 7"],
    ["filter", "滤镜轨道 7"],
    ["video-effect", "视频特效轨道 7"],
    ["body-effect", "人体特效轨道 7"],
    ["animated-overlay", "动画叠加轨道 7"],
  ] satisfies Array<[TrackType, string]>)('names a new %s track without changing its stable type', (type, expectedName) => {
    expect({ type, name: getDefaultTrackName(type, 7) }).toEqual({ type, name: expectedName });
  });

  it("uses the shared formatter in both store creation paths while preserving their counters", () => {
    useTimelineStore.getState().addTrack("video");
    const insertedId = useTimelineStore.getState().insertTrackAt("audio", 0);

    expect(useTimelineStore.getState().tracks).toMatchObject([
      { id: insertedId, type: "audio", name: "音频轨道 2", height: 52 },
      { type: "video", name: "视频轨道 1", height: 68 },
    ]);
  });

  it("preserves names loaded from existing projects", () => {
    useTimelineStore.getState().hydrateFromProject({
      tracks: [{ id: "legacy", type: "video", name: "My Custom Track", muted: false, locked: false, visible: true, height: 68 }],
      clips: [],
      transitions: [],
      gaps: [],
    });

    expect(useTimelineStore.getState().tracks[0].name).toBe("My Custom Track");
  });
});

describe("timeline marker localization", () => {
  beforeEach(() => {
    resetIdGenerator("timeline-marker-test");
    useTimelineStore.setState({ markers: [], epoch: 0 });
  });

  it("defaults only an omitted marker name and preserves explicit names verbatim", () => {
    const store = useTimelineStore.getState();

    store.addMarker(1);
    store.addMarker(2, "");
    store.addMarker(3, "  客户 Marker  ");

    expect(useTimelineStore.getState().markers.map(({ time, name }) => ({ time, name }))).toEqual([
      { time: 1, name: "标记" },
      { time: 2, name: "" },
      { time: 3, name: "  客户 Marker  " },
    ]);
  });
});

describe("timelineStore clip operations", () => {
  beforeEach(() => {
    // Reset store before each test
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      transitions: [],
      mainVideoTrackId: null,
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
    });
  });

  describe("transitions", () => {
    const makeClip = (id: string, startTime: number): Clip => ({
      id,
      trackId: "track-1",
      mediaId: `media-${id}`,
      startTime,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
    });

    it("creates a transition between adjacent visual clips", () => {
      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
        clips: [makeClip("left", 0), makeClip("right", 5)],
        transitions: [],
      });

      const result = useTimelineStore.getState().createTransitionBetweenClips("left", "right", "dissolve", 1);

      expect(result.error).toBeNull();
      expect(useTimelineStore.getState().transitions).toHaveLength(1);
      expect(useTimelineStore.getState().transitions[0]).toMatchObject({
        type: "dissolve",
        fromItemId: "left",
        toItemId: "right",
        placement: { startTime: 4.5, duration: 1 },
      });
    });

    it("returns localized transition errors for every validation branch", () => {
      expect(useTimelineStore.getState().createTransitionBetweenClips("missing-a", "missing-b", "fade", 1).error).toBe("请选择两个片段以添加转场");

      useTimelineStore.setState({
        tracks: [
          { id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 },
          { id: "track-2", type: "video", name: "Video 2", muted: false, locked: false, visible: true, height: 68 },
        ],
        clips: [makeClip("left", 0), { ...makeClip("right", 5), trackId: "track-2" }],
      });
      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("转场要求两个片段位于同一轨道");

      useTimelineStore.setState({ tracks: [], clips: [makeClip("left", 0), makeClip("right", 5)] });
      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("未找到转场轨道");

      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: true, visible: true, height: 68 }],
        clips: [makeClip("left", 0), makeClip("right", 6)],
        transitions: [],
      });

      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("请先解锁轨道再添加转场");

      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "audio", name: "Audio", muted: false, locked: false, visible: true, height: 52 }],
      });
      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("视觉转场只能添加到视频或文字轨道");

      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
      });

      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("请先将片段相邻排列再添加转场");

      useTimelineStore.setState({ clips: [{ ...makeClip("left", 0), duration: 0.1 }, { ...makeClip("right", 0.1), duration: 0.1 }] });
      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("片段过短，无法添加此转场");
    });

    it("removes transitions attached to deleted clips", () => {
      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
        clips: [makeClip("left", 0), makeClip("right", 5)],
        transitions: [],
      });
      useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1);

      useTimelineStore.getState().removeClip("left");

      expect(useTimelineStore.getState().transitions).toHaveLength(0);
    });
  });

  describe("swap errors", () => {
    const clip = (id: string, startTime: number, duration = 2): Clip => ({
      id,
      trackId: "track-1",
      mediaId: `media-${id}`,
      startTime,
      duration,
      trimIn: 0,
      trimOut: duration,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      opacity: 1,
      rotation: 0,
    });

    it("requires exactly two selected clips", () => {
      expect(useTimelineStore.getState().swapClips().error).toBe("请选择恰好两个片段进行交换");
    });

    it("reports missing selected clips", () => {
      useUIStore.setState({ selectedClipIds: ["missing-a", "missing-b"] });
      expect(useTimelineStore.getState().swapClips().error).toBe("未找到所选片段");
    });

    it("reports insufficient space without changing clip IDs", () => {
      useTimelineStore.setState({ clips: [clip("left", 0, 2), clip("right", 2, 4), clip("blocker", 4, 2)] });
      useUIStore.setState({ selectedClipIds: ["left", "right"] });

      expect(useTimelineStore.getState().swapClips().error).toBe("空间不足，交换后片段会重叠");
      expect(useTimelineStore.getState().clips.map(({ id }) => id)).toEqual(["left", "right", "blocker"]);
    });
  });

  describe("addClip", () => {
    it("preserves duration === trimOut - trimIn invariant", () => {
      const { addClip } = useTimelineStore.getState();

      const clip: Clip = {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
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
      };

      addClip(clip);

      const { clips } = useTimelineStore.getState();
      expect(clips).toHaveLength(1);
      expect(clips[0].duration).toBe(clips[0].trimOut - clips[0].trimIn);
    });
  });

  describe("updateClip", () => {
    it("preserves duration === trimOut - trimIn when updating trim points", () => {
      const { addClip, updateClip } = useTimelineStore.getState();

      const clip: Clip = {
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
      };

      addClip(clip);

      // Update trim points and duration together
      updateClip("clip-1", {
        trimIn: 2,
        trimOut: 8,
        duration: 6,
      });

      const { clips } = useTimelineStore.getState();
      expect(clips[0].duration).toBe(6);
      expect(clips[0].duration).toBe(clips[0].trimOut - clips[0].trimIn);
    });
  });

  describe("SplitClipCommand via command system", () => {
    it("preserves duration === trimOut - trimIn for both split clips", () => {
      const { addClip, addTrack } = useTimelineStore.getState();
      const { execute } = useHistoryStore.getState();

      addTrack("video");
      const { tracks } = useTimelineStore.getState();

      const clip: Clip = {
        id: "clip-1",
        trackId: tracks[0].id,
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
      };

      addClip(clip);

      // Use command system instead of direct method
      const command = new SplitClipCommand("clip-1", 4, 30, clip);
      execute(command);

      const { clips } = useTimelineStore.getState();
      expect(clips).toHaveLength(2);

      // Left clip: 0-4
      const leftClip = clips.find((c) => c.startTime === 0);
      expect(leftClip).toBeDefined();
      expect(leftClip!.duration).toBe(4);
      expect(leftClip!.trimIn).toBe(0);
      expect(leftClip!.trimOut).toBe(4);
      expect(leftClip!.duration).toBe(leftClip!.trimOut - leftClip!.trimIn);

      // Right clip: 4-10
      const rightClip = clips.find((c) => c.startTime === 4);
      expect(rightClip).toBeDefined();
      expect(rightClip!.duration).toBe(6);
      expect(rightClip!.trimIn).toBe(4);
      expect(rightClip!.trimOut).toBe(10);
      expect(rightClip!.duration).toBe(rightClip!.trimOut - rightClip!.trimIn);
    });

    it("handles split with existing trim points", () => {
      const { addClip, addTrack } = useTimelineStore.getState();
      const { execute } = useHistoryStore.getState();

      addTrack("video");
      const { tracks } = useTimelineStore.getState();

      const clip: Clip = {
        id: "clip-1",
        trackId: tracks[0].id,
        mediaId: "media-1",
        startTime: 0,
        duration: 6, // trimmed from 10s source
        trimIn: 2,
        trimOut: 8,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      addClip(clip);

      // Use command system instead of direct method
      const command = new SplitClipCommand("clip-1", 3, 30, clip);
      execute(command);

      const { clips } = useTimelineStore.getState();
      expect(clips).toHaveLength(2);

      const leftClip = clips.find((c) => c.startTime === 0);
      expect(leftClip!.duration).toBe(3);
      expect(leftClip!.trimIn).toBe(2);
      expect(leftClip!.trimOut).toBe(5);
      expect(leftClip!.duration).toBe(leftClip!.trimOut - leftClip!.trimIn);

      const rightClip = clips.find((c) => c.startTime === 3);
      expect(rightClip!.duration).toBe(3);
      expect(rightClip!.trimIn).toBe(5);
      expect(rightClip!.trimOut).toBe(8);
      expect(rightClip!.duration).toBe(rightClip!.trimOut - rightClip!.trimIn);
    });
  });

  describe("normalizeTrack", () => {
    it("preserves duration === trimOut - trimIn when normalizing", () => {
      const { addClip, addTrack, normalizeTrack } = useTimelineStore.getState();

      addTrack("video");
      const { tracks } = useTimelineStore.getState();
      const trackId = tracks[0].id;

      // Add clips with gaps
      const clip1: Clip = {
        id: "clip-1",
        trackId,
        mediaId: "media-1",
        startTime: 5,
        duration: 3,
        trimIn: 1,
        trimOut: 4,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const clip2: Clip = {
        id: "clip-2",
        trackId,
        mediaId: "media-2",
        startTime: 15,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      addClip(clip1);
      addClip(clip2);

      normalizeTrack(trackId);

      const { clips } = useTimelineStore.getState();

      // Clips should be packed to start, but durations preserved
      expect(clips[0].startTime).toBe(0);
      expect(clips[0].duration).toBe(3);
      expect(clips[0].duration).toBe(clips[0].trimOut - clips[0].trimIn);

      expect(clips[1].startTime).toBe(3);
      expect(clips[1].duration).toBe(5);
      expect(clips[1].duration).toBe(clips[1].trimOut - clips[1].trimIn);
    });
  });

  describe("insertClipAtIndex", () => {
    it("preserves duration === trimOut - trimIn when inserting", () => {
      const { addClip, addTrack, insertClipAtIndex } = useTimelineStore.getState();

      addTrack("video");
      const { tracks } = useTimelineStore.getState();
      const trackId = tracks[0].id;

      const clip1: Clip = {
        id: "clip-1",
        trackId,
        mediaId: "media-1",
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
      };

      const clip2: Clip = {
        id: "clip-2",
        trackId,
        mediaId: "media-2",
        startTime: 5,
        duration: 3,
        trimIn: 1,
        trimOut: 4,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      addClip(clip1);
      addClip(clip2);

      // Insert clip2 at index 0 (before clip1)
      insertClipAtIndex("clip-2", trackId, 0);

      const { clips } = useTimelineStore.getState();

      // clip2 should now be first
      const firstClip = clips.find((c) => c.startTime === 0);
      expect(firstClip!.id).toBe("clip-2");
      expect(firstClip!.duration).toBe(3);
      expect(firstClip!.duration).toBe(firstClip!.trimOut - firstClip!.trimIn);

      // clip1 should be second
      const secondClip = clips.find((c) => c.startTime === 3);
      expect(secondClip!.id).toBe("clip-1");
      expect(secondClip!.duration).toBe(5);
      expect(secondClip!.duration).toBe(secondClip!.trimOut - secondClip!.trimIn);
    });
  });

  describe("getTimelineEndTime", () => {
    it("returns 0 for empty timeline", () => {
      const { getTimelineEndTime } = useTimelineStore.getState();
      expect(getTimelineEndTime()).toBe(0);
    });

    it("returns actual content end time, not viewport padding", () => {
      const { addClip, addTrack, getTimelineEndTime } = useTimelineStore.getState();

      addTrack("video");
      const { tracks } = useTimelineStore.getState();

      const clip: Clip = {
        id: "clip-1",
        trackId: tracks[0].id,
        mediaId: "media-1",
        startTime: 0,
        duration: 4.365,
        trimIn: 0,
        trimOut: 4.365,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      addClip(clip);

      // Should return 4.365, not 10 (viewport padding)
      expect(getTimelineEndTime()).toBe(4.365);
    });

    it("returns max clip end time for multiple clips", () => {
      const { addClip, addTrack, getTimelineEndTime } = useTimelineStore.getState();

      addTrack("video");
      const { tracks } = useTimelineStore.getState();

      const clip1: Clip = {
        id: "clip-1",
        trackId: tracks[0].id,
        mediaId: "media-1",
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
      };

      const clip2: Clip = {
        id: "clip-2",
        trackId: tracks[0].id,
        mediaId: "media-2",
        startTime: 5,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      addClip(clip1);
      addClip(clip2);

      expect(getTimelineEndTime()).toBe(15); // 5 + 10
    });
  });

  describe("withBatch", () => {
    beforeEach(() => {
      const { addClip } = useTimelineStore.getState();
      addClip({ id: "c1", trackId: "t1", mediaId: "m1", startTime: 0, duration: 2, trimIn: 0, trimOut: 2, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 });
      addClip({ id: "c2", trackId: "t1", mediaId: "m2", startTime: 2, duration: 3, trimIn: 0, trimOut: 3, x: 0, y: 0, width: 100, height: 100, opacity: 1, rotation: 0 });
      // Reset epoch after setup
      useTimelineStore.setState({ epoch: 0 });
    });

    it("defers epoch increment until batch completes", () => {
      const { withBatch, updateClip } = useTimelineStore.getState();

      withBatch(() => {
        updateClip("c1", { startTime: 1 });
        updateClip("c2", { startTime: 4 });

        // Epoch should NOT have incremented yet (still in batch)
        expect(useTimelineStore.getState().epoch).toBe(0);
      });

      // Single epoch increment after batch
      expect(useTimelineStore.getState().epoch).toBe(1);
    });

    it("does not increment epoch if no mutations in batch", () => {
      const { withBatch } = useTimelineStore.getState();

      withBatch(() => {
        // No mutations
      });

      expect(useTimelineStore.getState().epoch).toBe(0);
    });

    it("supports nested batches", () => {
      const { withBatch, updateClip } = useTimelineStore.getState();

      withBatch(() => {
        updateClip("c1", { startTime: 1 });
        withBatch(() => {
          // nested
          updateClip("c2", { startTime: 4 });
          // Still inside outer batch — no epoch yet
          expect(useTimelineStore.getState().epoch).toBe(0);
        });
        // Still inside outer batch — no epoch yet
        expect(useTimelineStore.getState().epoch).toBe(0);
      });

      // After outer batch completes, epoch increments
      expect(useTimelineStore.getState().epoch).toBe(1);
    });

    it("increments epoch immediately outside a batch", () => {
      const { updateClip } = useTimelineStore.getState();

      updateClip("c1", { startTime: 5 });
      expect(useTimelineStore.getState().epoch).toBe(1);

      updateClip("c2", { startTime: 6 });
      expect(useTimelineStore.getState().epoch).toBe(2);
    });
  });
});
