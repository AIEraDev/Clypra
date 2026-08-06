import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import type { Clip, TimelineMarker, AudioFXConfig } from "@/types";

describe("Audio Automation & Marker Edge Cases", () => {
  const sampleClip: Clip = {
    id: "audio-clip-1",
    kind: "audio",
    trackId: "audio-track-1",
    mediaId: "media-audio-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    x: 0,
    y: 0,
    width: 100,
    height: 52,
    opacity: 1,
    rotation: 0,
    volume: 0.8,
    fadeIn: 1.5,
    fadeOut: 2.0,
    fadeInCurve: "exponential",
    fadeOutCurve: "s-curve",
  };

  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [
        { id: "audio-track-1", type: "audio", name: "Audio 1", muted: false, locked: false, visible: true, height: 52 },
      ],
      clips: [sampleClip],
      gaps: [],
      transitions: [],
      markers: [],
      epoch: 0,
    });
  });

  describe("Audio Automation Keyframes", () => {
    it("adds volume keyframes and preserves chronological sorting", () => {
      const store = useTimelineStore.getState();

      const kf3Id = store.addAudioKeyframe("audio-clip-1", 8.0, 1.2, "linear");
      const kf1Id = store.addAudioKeyframe("audio-clip-1", 1.5, 0.5, "exponential");
      const kf2Id = store.addAudioKeyframe("audio-clip-1", 4.0, 0.9, "bezier");

      const clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      expect(clip?.volumeKeyframes).toBeDefined();
      expect(clip?.volumeKeyframes).toHaveLength(3);

      // Verify sorted order by timestamp
      expect(clip?.volumeKeyframes?.map((k) => k.time)).toEqual([1.5, 4.0, 8.0]);
      expect(clip?.volumeKeyframes?.map((k) => k.id)).toEqual([kf1Id, kf2Id, kf3Id]);
    });

    it("updates an existing audio keyframe", () => {
      const store = useTimelineStore.getState();
      const kfId = store.addAudioKeyframe("audio-clip-1", 3.0, 1.0, "linear");

      store.updateAudioKeyframe("audio-clip-1", kfId, { gain: 1.5, easing: "exponential" });

      const clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      const kf = clip?.volumeKeyframes?.find((k) => k.id === kfId);

      expect(kf?.gain).toBe(1.5);
      expect(kf?.easing).toBe("exponential");
    });

    it("removes a keyframe cleanly by ID", () => {
      const store = useTimelineStore.getState();
      const kf1 = store.addAudioKeyframe("audio-clip-1", 2.0, 0.8);
      const kf2 = store.addAudioKeyframe("audio-clip-1", 5.0, 1.1);

      store.removeAudioKeyframe("audio-clip-1", kf1);

      const clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      expect(clip?.volumeKeyframes).toHaveLength(1);
      expect(clip?.volumeKeyframes?.[0].id).toBe(kf2);
    });

    it("handles non-existent clip IDs gracefully without throwing", () => {
      const store = useTimelineStore.getState();

      expect(() => {
        store.addAudioKeyframe("non-existent-clip", 1.0, 1.0);
        store.removeAudioKeyframe("non-existent-clip", "kf-99");
        store.updateAudioKeyframe("non-existent-clip", "kf-99", { gain: 0.5 });
      }).not.toThrow();
    });

    it("deduplicates audio keyframes at identical timestamps and clamps time to clip duration", () => {
      const store = useTimelineStore.getState();

      // Add first keyframe at 4.0s
      const kf1 = store.addAudioKeyframe("audio-clip-1", 4.0, 0.5);
      // Add second keyframe at 4.0001s (duplicate threshold)
      const kf2 = store.addAudioKeyframe("audio-clip-1", 4.0001, 1.2);

      let clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      expect(clip?.volumeKeyframes).toHaveLength(1);
      expect(clip?.volumeKeyframes?.[0].gain).toBe(1.2);

      // Add keyframe beyond clip duration (clip duration = 10s)
      const kf3 = store.addAudioKeyframe("audio-clip-1", 15.0, 0.8);
      clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      const kf3Obj = clip?.volumeKeyframes?.find((k) => k.id === kf3);
      expect(kf3Obj?.time).toBe(10.0);
    });

    it("populates trimOut by default when adding a new clip without trimOut", () => {
      const store = useTimelineStore.getState();
      const newClip: Clip = {
        id: "clip-no-trimout",
        trackId: "audio-track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 5,
        trimIn: 2,
        x: 0,
        y: 0,
        width: 100,
        height: 52,
        opacity: 1,
        rotation: 0,
      } as Clip;

      store.addClip(newClip);
      const added = useTimelineStore.getState().clips.find((c) => c.id === "clip-no-trimout");
      expect(added?.trimOut).toBe(7); // 2 + 5
    });
  });

  describe("Audio FX Processing", () => {
    it("updates clip Audio FX properties and merges partial configs", () => {
      const store = useTimelineStore.getState();

      // Step 1: Set EQ
      store.updateClipAudioFX("audio-clip-1", {
        eq: { low: 4, mid: -2, high: 3 },
      });

      let clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      expect(clip?.audioFX?.eq).toEqual({ low: 4, mid: -2, high: 3 });

      // Step 2: Add Stereo Panning and Noise Suppression without clearing EQ
      store.updateClipAudioFX("audio-clip-1", {
        pan: -0.5,
        noiseSuppression: 0.8,
      });

      clip = useTimelineStore.getState().clips.find((c) => c.id === "audio-clip-1");
      expect(clip?.audioFX?.eq).toEqual({ low: 4, mid: -2, high: 3 });
      expect(clip?.audioFX?.pan).toBe(-0.5);
      expect(clip?.audioFX?.noiseSuppression).toBe(0.8);
    });
  });

  describe("Timeline Markers Operations", () => {
    it("adds timeline markers and maintains chronological sorting", () => {
      const store = useTimelineStore.getState();

      const m3 = store.addMarker(12.5, "Chorus", "purple");
      const m1 = store.addMarker(2.0, "Intro", "blue");
      const m2 = store.addMarker(6.0, "Verse 1", "green");

      const markers = useTimelineStore.getState().markers;
      expect(markers).toHaveLength(3);
      expect(markers.map((m) => m.time)).toEqual([2.0, 6.0, 12.5]);
      expect(markers.map((m) => m.name)).toEqual(["Intro", "Verse 1", "Chorus"]);
    });

    it("updates marker details and re-sorts if timestamp changes", () => {
      const store = useTimelineStore.getState();

      const m1 = store.addMarker(5.0, "Section A", "yellow");
      const m2 = store.addMarker(10.0, "Section B", "red");

      // Move Section B to before Section A
      store.updateMarker(m2, { time: 2.0, name: "Section B (Moved)" });

      const markers = useTimelineStore.getState().markers;
      expect(markers[0].name).toBe("Section B (Moved)");
      expect(markers[0].time).toBe(2.0);
      expect(markers[1].time).toBe(5.0);
    });

    it("removes marker by ID", () => {
      const store = useTimelineStore.getState();

      const m1 = store.addMarker(1.0, "M1", "red");
      const m2 = store.addMarker(4.0, "M2", "blue");

      store.removeMarker(m1);

      const markers = useTimelineStore.getState().markers;
      expect(markers).toHaveLength(1);
      expect(markers[0].id).toBe(m2);
    });
  });
});
