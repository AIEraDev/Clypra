import { describe, it, expect, beforeEach } from "vitest";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import { SwapClipsCommand } from "@/core/history/commands/SwapClipsCommand";
import { evaluateTimelineScene } from "@/core/evaluation/evaluator";
import { getActiveAudioClips } from "@/core/timeline/audioClips";
import { useTimelineStore } from "@/store/timelineStore";
import type { Clip, Track, TransitionTimelineItem } from "@/types";

describe("Timeline Pipeline Bug Fix Regressions (CLY-BUG-014 through CLY-BUG-018)", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      transitions: [],
      gaps: [],
      mainVideoTrackId: null,
    });
  });

  describe("CLY-BUG-014: SplitClipCommand speed remapping and duration coherence", () => {
    it("preserves timeline duration and scales source trims for 2.0x speed clip", () => {
      // 20s of source media played at 2.0x speed occupies 10s on the timeline.
      const clip: Clip = {
        id: "clip-2x",
        trackId: "v1",
        mediaId: "media-1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 20,
        speed: 2.0,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const timelineState = {
        clips: [clip],
        tracks: [{ id: "v1", type: "video" as const, name: "V1", locked: false, muted: false, visible: true, height: 64 }],
        transitions: [],
        gaps: [],
        epoch: 1,
      };

      // Split at t = 5.0s
      const cmd = new SplitClipCommand(clip.id, 5.0, 30, clip);
      const nextState = cmd.apply(timelineState as any);

      const leftClip = nextState.clips.find((c: Clip) => c.startTime === 0);
      const rightClip = nextState.clips.find((c: Clip) => c.startTime === 5.0);

      expect(leftClip).toBeDefined();
      expect(rightClip).toBeDefined();

      // Regression assertions: Durations must match timeline slice exactly (5s + 5s = 10s)
      expect(leftClip?.duration).toBe(5);
      expect(rightClip?.duration).toBe(5);
      expect(leftClip!.duration + rightClip!.duration).toBe(10);

      // Source trims must be scaled by speed (5 timeline seconds * 2.0x = 10 source seconds)
      expect(leftClip?.trimIn).toBe(0);
      expect(leftClip?.trimOut).toBe(10);
      expect(rightClip?.trimIn).toBe(10);
      expect(rightClip?.trimOut).toBe(20);
    });

    it("assigns valid positive duration when splitting 0.5x speed clip", () => {
      // 10s of source media played at 0.5x speed occupies 20s on the timeline.
      const clip: Clip = {
        id: "clip-0.5x",
        trackId: "v1",
        mediaId: "media-1",
        startTime: 0,
        duration: 20,
        trimIn: 0,
        trimOut: 10,
        speed: 0.5,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1,
        rotation: 0,
      };

      const timelineState = {
        clips: [clip],
        tracks: [{ id: "v1", type: "video" as const, name: "V1", locked: false, muted: false, visible: true, height: 64 }],
        transitions: [],
        gaps: [],
        epoch: 1,
      };

      // Split at t = 12s on timeline
      const cmd = new SplitClipCommand(clip.id, 12.0, 30, clip);
      const nextState = cmd.apply(timelineState as any);

      const leftClip = nextState.clips.find((c: Clip) => c.startTime === 0);
      const rightClip = nextState.clips.find((c: Clip) => c.startTime === 12.0);

      expect(leftClip).toBeDefined();
      expect(rightClip).toBeDefined();

      // Timeline durations: 12s + 8s = 20s (strictly positive, non-negative)
      expect(leftClip?.duration).toBe(12);
      expect(rightClip?.duration).toBe(8);
      expect(leftClip!.duration + rightClip!.duration).toBe(20);

      // Source trims scaled by 0.5x (12s * 0.5 = 6 source seconds)
      expect(leftClip?.trimIn).toBe(0);
      expect(leftClip?.trimOut).toBe(6);
      expect(rightClip?.trimIn).toBe(6);
      expect(rightClip?.trimOut).toBe(10);
    });
  });

  describe("CLY-BUG-015: SwapClipsCommand adjacent rippling without collision", () => {
    it("ripples adjacent clips on the same track with differing durations", () => {
      // Clip A: 2s (t: 0..2)
      const clipA: Clip = {
        id: "clip-a",
        trackId: "v1",
        mediaId: "m1",
        startTime: 0,
        duration: 2,
        trimIn: 0,
        trimOut: 2,
        x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
      };
      // Clip B: 8s (t: 2..10)
      const clipB: Clip = {
        id: "clip-b",
        trackId: "v1",
        mediaId: "m2",
        startTime: 2,
        duration: 8,
        trimIn: 0,
        trimOut: 8,
        x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
      };

      const timelineState = {
        clips: [clipA, clipB],
        tracks: [{ id: "v1", type: "video" as const, name: "V1", locked: false, muted: false, visible: true, height: 64 }],
        transitions: [],
        gaps: [],
        epoch: 1,
      };

      const validationError = SwapClipsCommand.validate(timelineState as any, clipA.id, clipB.id);
      expect(validationError).toBeNull();

      const cmd = new SwapClipsCommand(clipA.id, clipB.id);
      const nextState = cmd.apply(timelineState as any);

      const swappedA = nextState.clips.find((c: Clip) => c.id === clipA.id)!;
      const swappedB = nextState.clips.find((c: Clip) => c.id === clipB.id)!;

      // Swapped B is now at 0..8s
      expect(swappedB.startTime).toBe(0);
      expect(swappedB.duration).toBe(8);

      // Swapped A is now at 8..10s
      expect(swappedA.startTime).toBe(8);
      expect(swappedA.duration).toBe(2);

      // Non-overlapping invariant: overlap interval must be 0
      const overlapStart = Math.max(swappedA.startTime, swappedB.startTime);
      const overlapEnd = Math.min(swappedA.startTime + swappedA.duration, swappedB.startTime + swappedB.duration);
      expect(Math.max(0, overlapEnd - overlapStart)).toBe(0);
    });

    it("rejects non-adjacent same-track swap if right clip would collide with left clip", () => {
      // Clip A: 10s (t: 0..10)
      const clipA: Clip = {
        id: "clip-a",
        trackId: "v1",
        mediaId: "m1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
      };
      // Clip B: 2s at t: 8 (non-adjacent, starts before clipA finishes if moving to 0)
      const clipB: Clip = {
        id: "clip-b",
        trackId: "v1",
        mediaId: "m2",
        startTime: 12,
        duration: 20, // moving to 0 would span 0..20, colliding with clipA at 12!
        trimIn: 0,
        trimOut: 20,
        x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
      };

      const timelineState = {
        clips: [clipA, clipB],
        tracks: [{ id: "v1", type: "video" as const, name: "V1", locked: false, muted: false, visible: true, height: 64 }],
        transitions: [],
        gaps: [],
        epoch: 1,
      };

      const error = SwapClipsCommand.validate(timelineState as any, clipA.id, clipB.id);
      expect(error).toContain("overlap");
    });
  });

  describe("CLY-BUG-016: Ghost transition suppression when clips lose adjacency", () => {
    it("does not activate transition when clips are separated by a gap or moved", () => {
      const clipA: Clip = {
        id: "clip-a",
        trackId: "v1",
        mediaId: "m1",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
      };
      const clipB: Clip = {
        id: "clip-b",
        trackId: "v1",
        mediaId: "m2",
        startTime: 50, // Separated by 45s gap
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 0, y: 0, width: 1920, height: 1080, opacity: 1, rotation: 0,
      };

      const tracks: Track[] = [{ id: "v1", type: "video", name: "V1", locked: false, muted: false, visible: true, height: 64 }];
      const assets = [
        { id: "m1", type: "video" as const, path: "http://test/video1.mp4", duration: 10, width: 1920, height: 1080 },
        { id: "m2", type: "video" as const, path: "http://test/video2.mp4", duration: 10, width: 1920, height: 1080 },
      ];

      const transition: TransitionTimelineItem = {
        id: "trans-ab",
        kind: "transition",
        type: "dissolve",
        placement: {
          trackId: "v1",
          startTime: 4.5,
          duration: 1.0,
          role: "overlay",
          zIndex: 0,
        },
        fromItemId: clipA.id,
        toItemId: clipB.id,
        alignment: "center",
        easing: "ease-in-out" as any,
        effects: { effects: [], version: 1 },
      };

      // Evaluate at t = 5.0s
      const scene = evaluateTimelineScene(5.0, [clipA, clipB], tracks, assets as any, null, [transition]);
      const clipALayer = scene.visualLayers.find((l) => l.clipId === clipA.id);

      // Regression: Non-adjacent transition must NOT activate
      expect(clipALayer?.inTransition).toBeFalsy();
      expect(scene.transitions).toHaveLength(0);
    });
  });

  describe("CLY-BUG-017: Audio export range slicing speed remapping", () => {
    it("computes speed-scaled relativeTrimIn and passes speed for audio clip", () => {
      const clip: Clip = {
        id: "audio-clip-1",
        kind: "audio",
        trackId: "a1",
        mediaId: "m1",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 20,
        speed: 2.0,
        x: 0, y: 0, width: 0, height: 0, opacity: 1, rotation: 0,
      };

      const tracks: Track[] = [{ id: "a1", type: "audio", name: "A1", locked: false, muted: false, visible: true, height: 48 }];
      const assets = [{ id: "m1", type: "audio" as const, path: "/test/audio.mp3", duration: 20 }];

      // Slicing export range from t = 2s to t = 8s
      const activeAudio = getActiveAudioClips([clip], tracks, assets as any, 2.0, 8.0);
      expect(activeAudio.length).toBe(1);

      // Regression: 2.0s timeline offset at 2.0x speed = 4.0s source offset
      expect(activeAudio[0].trimIn).toBe(4.0);
      expect(activeAudio[0].speed).toBe(2.0);
      expect(activeAudio[0].duration).toBe(6.0);
      expect(activeAudio[0].startTime).toBe(0);
    });
  });

  describe("CLY-BUG-018 & CLY-OBS-001: Track lifecycle and primary track ID resolution", () => {
    it("re-resolves mainVideoTrackId when deleting primary track and returns track ID on addTrack", () => {
      const store = useTimelineStore.getState();
      const track1Id = store.addTrack("video");
      const track2Id = store.addTrack("video");

      // Verify CLY-OBS-001: addTrack returns string track IDs
      expect(typeof track1Id).toBe("string");
      expect(typeof track2Id).toBe("string");
      expect(track1Id).not.toBe(track2Id);

      // Set track1 as primary
      useTimelineStore.setState({ mainVideoTrackId: track1Id });
      expect(useTimelineStore.getState().mainVideoTrackId).toBe(track1Id);

      // Remove track1 via removeTrack
      store.removeTrack(track1Id);

      const remainingTracks = useTimelineStore.getState().tracks;
      const currentMainVideoTrackId = useTimelineStore.getState().mainVideoTrackId;

      // Track1 is gone
      expect(remainingTracks.some((t) => t.id === track1Id)).toBe(false);
      // Regression: mainVideoTrackId is cleanly re-resolved to remaining track2
      expect(currentMainVideoTrackId).toBe(track2Id);
    });
  });
});
