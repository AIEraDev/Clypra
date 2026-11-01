import { describe, expect, it } from "vitest";
import {
  collectPlayheadSnapTargets,
  evaluatePlayheadSnap,
  PLAYHEAD_SNAP_DEFAULTS,
  type PlayheadSnapTarget,
} from "../playheadSnapEngine";
import type { Clip, Track, TransitionTimelineItem, TimelineMarker, Gap } from "@/types";

describe("Playhead Magnetic Snapping Engine (playheadSnapEngine)", () => {
  const sampleTracks: Track[] = [
    {
      id: "track-v1",
      type: "video",
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 64,
    },
    {
      id: "track-a1",
      type: "audio",
      name: "Audio 1",
      muted: false,
      locked: false,
      visible: true,
      height: 48,
    },
    {
      id: "track-locked",
      type: "video",
      name: "Locked Video",
      muted: false,
      locked: true,
      visible: true,
      height: 64,
    },
  ];

  const clipA: Clip = {
    id: "clip-a",
    trackId: "track-v1",
    startTime: 2.0,
    duration: 5.0, // Ends at 7.0
    name: "Clip A",
    kind: "video",
    visualKeyframes: {
      opacity: [{ time: 1.5, value: 0.5 }], // Absolute time: 3.5
    },
  } as unknown as Clip;

  const clipB: Clip = {
    id: "clip-b",
    trackId: "track-v1",
    startTime: 7.0, // Abutting clip A at 7.0! (Cut point)
    duration: 4.0, // Ends at 11.0
    name: "Clip B",
    kind: "video",
    markers: [
      { id: "cm-1", localTime: 2.0, name: "Beat 1", color: "#f00" }, // Absolute: 9.0
    ],
  } as unknown as Clip;

  const clipOnLockedTrack: Clip = {
    id: "clip-locked",
    trackId: "track-locked",
    startTime: 15.0,
    duration: 5.0,
    name: "Locked Clip",
    kind: "video",
  } as unknown as Clip;

  const sampleMarkers: TimelineMarker[] = [
    { id: "m-1", time: 4.0, name: "Chorus", color: "#d946ef" },
  ];

  const sampleTransitions: TransitionTimelineItem[] = [
    {
      id: "tr-1",
      trackId: "track-v1",
      startTime: 6.5,
      duration: 1.0,
      type: "crossfade",
    } as unknown as TransitionTimelineItem,
  ];

  const sampleGaps: Gap[] = [
    {
      id: "gap-1",
      trackId: "track-v1",
      startTime: 11.0,
      duration: 2.0,
      type: "auto",
      source: "clip-delete",
      protected: false,
    },
  ];

  describe("collectPlayheadSnapTargets", () => {
    it("collects all 10 snapping places across sequence bounds, cuts, clips, keyframes, transitions, markers, and gaps", () => {
      const targets = collectPlayheadSnapTargets({
        clips: [clipA, clipB, clipOnLockedTrack],
        tracks: sampleTracks,
        markers: sampleMarkers,
        transitions: sampleTransitions,
        gaps: sampleGaps,
        duration: 30.0,
      });

      // 1. Sequence boundaries
      expect(targets.some((t) => t.id === "seq-start" && t.time === 0)).toBe(true);
      expect(targets.some((t) => t.id === "seq-end" && t.time === 30.0)).toBe(true);

      // 2. Clip A start (isolated edge)
      expect(targets.some((t) => t.time === 2.0 && t.category === "clip-edge")).toBe(true);

      // 3. Cut point at 7.0s where Clip A abuts Clip B
      const cutTarget = targets.find((t) => t.time === 7.0);
      expect(cutTarget).toBeDefined();
      expect(cutTarget?.category).toBe("cut");
      expect(cutTarget?.guideType).toBe("cut");

      // 4. Clip B end at 11.0s
      expect(targets.some((t) => t.time === 11.0 && t.category === "clip-edge")).toBe(true);

      // 5. Global Timeline Marker at 4.0s
      expect(targets.some((t) => t.time === 4.0 && t.category === "marker")).toBe(true);

      // 6. Clip-level marker on Clip B at 9.0s (7.0 + 2.0)
      expect(targets.some((t) => t.time === 9.0 && t.category === "marker")).toBe(true);

      // 7. Transition at 6.5s start, 7.0s center, 7.5s end
      expect(targets.some((t) => t.time === 6.5 && t.category === "transition")).toBe(true);
      expect(targets.some((t) => t.time === 7.5 && t.category === "transition")).toBe(true);

      // 8. Keyframe on Clip A at 3.5s (2.0 + 1.5)
      expect(targets.some((t) => t.time === 3.5 && t.category === "keyframe")).toBe(true);

      // 9. Gap from 11.0s to 13.0s
      expect(targets.some((t) => t.time === 13.0 && t.category === "gap")).toBe(true);

      // 10. Clips on locked tracks are ignored
      expect(targets.some((t) => t.id.includes("clip-locked"))).toBe(false);
    });

    it("resolves coincident targets strictly by priority order", () => {
      // Coincident at 0.0s: Sequence Origin (priority 1) vs Clip at 0.0s (priority 3)
      const clipAtZero: Clip = {
        id: "clip-zero",
        trackId: "track-v1",
        startTime: 0.0,
        duration: 3.0,
        name: "Zero Clip",
        kind: "video",
      } as unknown as Clip;

      const targets = collectPlayheadSnapTargets({
        clips: [clipAtZero],
        tracks: sampleTracks,
        duration: 20.0,
      });

      // Target at 0.0s must be sequence-boundary (priority 1), not clip-edge (priority 3)
      const targetAtZero = targets.find((t) => Math.abs(t.time - 0) < 0.001);
      expect(targetAtZero?.category).toBe("sequence-boundary");
    });
  });

  describe("evaluatePlayheadSnap", () => {
    const snapTargets: PlayheadSnapTarget[] = [
      {
        id: "t-start",
        time: 0,
        category: "sequence-boundary",
        guideType: "sequence-boundary",
        priority: 1,
      },
      {
        id: "clip-a",
        time: 5.0,
        category: "clip-edge",
        guideType: "clip-start",
        label: "Clip A",
        priority: 3,
      },
      {
        id: "marker-1",
        time: 10.0,
        category: "marker",
        guideType: "marker",
        label: "Marker 1",
        priority: 3,
      },
    ];

    const pps = 100; // 100 pixels per second -> 10px snap radius = 0.1s

    it("snaps to target when pointer is within snap-in radius (10px)", () => {
      // Candidate time 5.05s is 5px away at 100pps (within 10px threshold)
      const result = evaluatePlayheadSnap({
        candidateTime: 5.05,
        pointerPx: 505,
        currentSnappedTarget: null,
        anchorPointerPx: null,
        snapTargets,
        pixelsPerSecond: pps,
        snapEnabled: true,
      });

      expect(result.snapped).toBe(true);
      expect(result.time).toBe(5.0);
      expect(result.activeTarget?.id).toBe("clip-a");
      expect(result.anchorPointerPx).toBe(505);
      expect(result.guide?.type).toBe("clip-start");
    });

    it("does not snap when pointer is outside snap-in radius", () => {
      // Candidate time 5.15s is 15px away at 100pps (> 10px threshold)
      const result = evaluatePlayheadSnap({
        candidateTime: 5.15,
        pointerPx: 515,
        currentSnappedTarget: null,
        anchorPointerPx: null,
        snapTargets,
        pixelsPerSecond: pps,
        snapEnabled: true,
      });

      expect(result.snapped).toBe(false);
      expect(result.time).toBe(5.15);
      expect(result.activeTarget).toBeNull();
      expect(result.guide).toBeNull();
    });

    it("maintains magnetic lock due to escape hysteresis (sticky resistance)", () => {
      const currentTarget = snapTargets[1]; // Clip A at 5.0s
      const anchorPx = 500;

      // Pointer moves 15px away (from 500 to 515px)
      // 15px > 10px snap-in threshold, BUT < 22px escape threshold!
      // Must REMAIN locked!
      const lockedResult = evaluatePlayheadSnap({
        candidateTime: 5.15,
        pointerPx: 515,
        currentSnappedTarget: currentTarget,
        anchorPointerPx: anchorPx,
        snapTargets,
        pixelsPerSecond: pps,
        snapEnabled: true,
      });

      expect(lockedResult.snapped).toBe(true);
      expect(lockedResult.time).toBe(5.0);
      expect(lockedResult.activeTarget?.id).toBe("clip-a");

      // Pointer moves 25px away (from 500 to 525px)
      // 25px >= 22px escape threshold -> breaks free!
      const escapedResult = evaluatePlayheadSnap({
        candidateTime: 5.25,
        pointerPx: 525,
        currentSnappedTarget: currentTarget,
        anchorPointerPx: anchorPx,
        snapTargets,
        pixelsPerSecond: pps,
        snapEnabled: true,
      });

      expect(escapedResult.snapped).toBe(false);
      expect(escapedResult.time).toBe(5.25);
      expect(escapedResult.activeTarget).toBeNull();
    });

    it("completely bypasses snapping when snapEnabled is false", () => {
      const result = evaluatePlayheadSnap({
        candidateTime: 5.02,
        pointerPx: 502,
        currentSnappedTarget: null,
        anchorPointerPx: null,
        snapTargets,
        pixelsPerSecond: pps,
        snapEnabled: false,
      });

      expect(result.snapped).toBe(false);
      expect(result.time).toBe(5.02);
    });

    it("completely bypasses snapping when bypassModifier is true (holding Cmd/Ctrl)", () => {
      const result = evaluatePlayheadSnap({
        candidateTime: 5.02,
        pointerPx: 502,
        currentSnappedTarget: null,
        anchorPointerPx: null,
        snapTargets,
        pixelsPerSecond: pps,
        snapEnabled: true,
        bypassModifier: true,
      });

      expect(result.snapped).toBe(false);
      expect(result.time).toBe(5.02);
    });
  });
});
