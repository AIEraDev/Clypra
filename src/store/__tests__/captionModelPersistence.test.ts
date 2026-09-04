import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import {
  type CaptionTrack,
  type CaptionCue,
  CAPTION_MODEL_VERSION,
  TICKS_PER_SECOND,
  DEFAULT_CAPTION_STYLE,
  secondsToTicks,
  ticksToSeconds,
  ticksToFrameIndex,
  frameIndexToTicks,
} from "@/types/captions";
import {
  toRustProject,
  validateAndMigrateProjectPayload,
  fromRustProject,
} from "@/types/serialization";
import type { Project } from "@/types";

describe("Caption Track & Cue Model — Serialization & Store Integration", () => {
  beforeEach(() => {
    useTimelineStore.getState().hydrateFromProject({
      tracks: [],
      clips: [],
      transitions: [],
      gaps: [],
      captionTracks: [],
    });
  });

  describe("Tick conversion math", () => {
    it("converts seconds to ticks and back without drift", () => {
      expect(TICKS_PER_SECOND).toBe(1_000_000);
      expect(secondsToTicks(1)).toBe(1_000_000);
      expect(secondsToTicks(0.5)).toBe(500_000);
      expect(secondsToTicks(0.01)).toBe(10_000);
      expect(ticksToSeconds(1_000_000)).toBe(1);
      expect(ticksToSeconds(500_000)).toBe(0.5);
      expect(ticksToSeconds(10_000)).toBe(0.01);
    });

    it("converts frame indices to ticks and back accurately", () => {
      // At 30 fps, 1 frame is 1/30s = 33,333 ticks
      expect(frameIndexToTicks(30, 30)).toBe(1_000_000);
      expect(ticksToFrameIndex(1_000_000, 30)).toBe(30);

      // At 60 fps, 60 frames = 1s = 1,000_000 ticks
      expect(frameIndexToTicks(60, 60)).toBe(1_000_000);
      expect(ticksToFrameIndex(1_000_000, 60)).toBe(60);
    });
  });

  describe("TimelineStore caption track operations", () => {
    it("adds, updates, and removes caption tracks with epoch increments", () => {
      const store = useTimelineStore.getState();
      const initialEpoch = store.epoch;

      const track = store.addCaptionTrack({
        name: "English Subtitles",
        cues: [
          {
            id: "cue-1",
            startTicks: 0,
            endTicks: 2_000_000,
            text: "Hello world",
            styleVersion: 1,
          },
        ],
      });

      expect(track.id).toBeDefined();
      expect(track.name).toBe("English Subtitles");
      expect(useTimelineStore.getState().captionTracks).toHaveLength(1);
      expect(useTimelineStore.getState().activeCaptionTrackId).toBe(track.id);
      expect(useTimelineStore.getState().epoch).toBeGreaterThan(initialEpoch);

      // Update track
      const epochBeforeUpdate = useTimelineStore.getState().epoch;
      useTimelineStore.getState().updateCaptionTrack(track.id, {
        name: "English (SDH)",
        visible: false,
      });

      const updated = useTimelineStore.getState().captionTracks[0];
      expect(updated.name).toBe("English (SDH)");
      expect(updated.visible).toBe(false);
      expect(useTimelineStore.getState().epoch).toBeGreaterThan(epochBeforeUpdate);

      // Remove track
      const epochBeforeRemove = useTimelineStore.getState().epoch;
      useTimelineStore.getState().removeCaptionTrack(track.id);
      expect(useTimelineStore.getState().captionTracks).toHaveLength(0);
      expect(useTimelineStore.getState().activeCaptionTrackId).toBeNull();
      expect(useTimelineStore.getState().epoch).toBeGreaterThan(epochBeforeRemove);
    });

    it("hydrates caption tracks from project payload", () => {
      const mockCaptionTrack: CaptionTrack = {
        id: "cap-track-1",
        captionModelVersion: CAPTION_MODEL_VERSION,
        name: "Spanish Subtitles",
        visible: true,
        locked: false,
        defaultStyle: { ...DEFAULT_CAPTION_STYLE, fontSize: 42 },
        cues: [
          {
            id: "cue-es-1",
            startTicks: 500_000,
            endTicks: 1_500_000,
            text: "Hola mundo",
            styleVersion: 1,
          },
        ],
      };

      useTimelineStore.getState().hydrateFromProject({
        tracks: [],
        clips: [],
        transitions: [],
        gaps: [],
        captionTracks: [mockCaptionTrack],
      });

      expect(useTimelineStore.getState().captionTracks).toHaveLength(1);
      expect(useTimelineStore.getState().captionTracks[0].name).toBe("Spanish Subtitles");
      expect(useTimelineStore.getState().activeCaptionTrackId).toBe("cap-track-1");
      expect(useTimelineStore.getState().captionTracks[0].cues[0].text).toBe("Hola mundo");
    });
  });

  describe("Serialization roundtrip", () => {
    it("serializes captionTracks to Rust project format and migrates back cleanly", () => {
      const mockProject: Project = {
        id: "proj-1",
        name: "Test Project",
        createdAt: 1000,
        updatedAt: 2000,
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 10,
        captionModelVersion: CAPTION_MODEL_VERSION,
      };

      const mockCaptionTrack: CaptionTrack = {
        id: "track-c1",
        captionModelVersion: CAPTION_MODEL_VERSION,
        name: "Subtitles",
        visible: true,
        locked: false,
        defaultStyle: { ...DEFAULT_CAPTION_STYLE },
        cues: [
          {
            id: "cue-1",
            startTicks: 1_000_000,
            endTicks: 3_000_000,
            text: "Caption line 1",
            speaker: "Host",
            styleVersion: 1,
          },
        ],
      };

      // 1. Frontend → Rust
      const rustProject = toRustProject(mockProject, {
        tracks: [],
        clips: [],
        captionTracks: [mockCaptionTrack],
        updateModifiedTime: false,
      });

      expect(rustProject.caption_model_version).toBe(CAPTION_MODEL_VERSION);
      expect(rustProject.caption_tracks).toHaveLength(1);
      expect(rustProject.caption_tracks?.[0].id).toBe("track-c1");

      // 2. Validate and migrate payload
      const snapshot = validateAndMigrateProjectPayload(rustProject);
      expect(snapshot.captionTracks).toHaveLength(1);
      expect(snapshot.captionTracks?.[0].id).toBe("track-c1");
      expect(snapshot.captionTracks?.[0].cues[0].speaker).toBe("Host");
      expect(snapshot.project.captionModelVersion).toBe(CAPTION_MODEL_VERSION);

      // 3. Rust → Frontend Project
      const frontendProject = fromRustProject(rustProject);
      expect(frontendProject.captionModelVersion).toBe(CAPTION_MODEL_VERSION);
    });
  });
});
