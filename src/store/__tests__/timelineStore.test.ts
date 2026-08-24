import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import { useHistoryStore } from "../historyStore";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import type { Clip } from "@/types";

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

  it("allows sequence-fit density below the normal edit density floor", () => {
    const store = useTimelineStore.getState();

    store.setPixelsPerSecond(0.0001, true);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(0.0001);

    store.setPixelsPerSecond(0.0001);
    expect(useTimelineStore.getState().pixelsPerSecond).toBe(10);
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
      if (result.transition) useTimelineStore.getState().addTransition(result.transition);

      expect(result.error).toBeNull();
      expect(useTimelineStore.getState().transitions).toHaveLength(1);
      expect(useTimelineStore.getState().transitions[0]).toMatchObject({
        type: "dissolve",
        fromItemId: "left",
        toItemId: "right",
        placement: { startTime: 4.5, duration: 1 },
      });
    });

    it("rejects transitions across gaps and locked tracks", () => {
      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: true, visible: true, height: 68 }],
        clips: [makeClip("left", 0), makeClip("right", 6)],
        transitions: [],
      });

      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("Unlock the track before adding a transition");

      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
      });

      expect(useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1).error).toBe("Move clips together before adding a transition");
    });

    it("removes transitions attached to deleted clips", () => {
      useTimelineStore.setState({
        tracks: [{ id: "track-1", type: "video", name: "Video", muted: false, locked: false, visible: true, height: 68 }],
        clips: [makeClip("left", 0), makeClip("right", 5)],
        transitions: [],
      });
      const res = useTimelineStore.getState().createTransitionBetweenClips("left", "right", "fade", 1);
      if (res.transition) useTimelineStore.getState().addTransition(res.transition);

      useTimelineStore.getState().removeClip("left");

      expect(useTimelineStore.getState().transitions).toHaveLength(0);
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

  describe("hydrateFromProject cleanEmptyTracks", () => {
    const mockTracks = [
      { id: "track-video-main", type: "video", name: "Main Video Track", muted: false, locked: false, visible: true, height: 68 },
      { id: "track-video-empty", type: "video", name: "Empty Video Track", muted: false, locked: false, visible: true, height: 68 },
      { id: "track-audio-empty", type: "audio", name: "Empty Audio Track", muted: false, locked: false, visible: true, height: 52 },
    ];
    const mockClips = [
      {
        id: "clip-main",
        trackId: "track-video-main",
        mediaId: "media-main",
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
      },
    ];

    it("keeps all tracks when cleanEmptyTracks is false or omitted", () => {
      const { hydrateFromProject } = useTimelineStore.getState();
      hydrateFromProject({ tracks: mockTracks, clips: mockClips });
      expect(useTimelineStore.getState().tracks).toHaveLength(3);
    });

    it("filters out empty tracks when cleanEmptyTracks is true", () => {
      const { hydrateFromProject } = useTimelineStore.getState();
      hydrateFromProject({ tracks: mockTracks, clips: mockClips, cleanEmptyTracks: true });
      expect(useTimelineStore.getState().tracks).toHaveLength(1);
      expect(useTimelineStore.getState().tracks[0].id).toBe("track-video-main");
    });
  });
});
