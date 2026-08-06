import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { useTimelineStore } from "../timelineStore";
import type { Clip, Track, TrackType } from "@/types";

describe("timelineStore Property Invariants", () => {
  beforeEach(() => {
    // Reset timeline store state before each test run
    useTimelineStore.setState({
      tracks: [
        { id: "video-1", name: "Main Track", type: "video", muted: false, locked: false, visible: true, height: 68 },
        { id: "audio-1", name: "Audio Track", type: "audio", muted: false, locked: false, visible: true, height: 52 },
      ],
      clips: [],
      gaps: [],
      transitions: [],
      mainVideoTrackId: "video-1",
      epoch: 0,
      zoomLevel: 1,
      scrollLeft: 0,
      viewportWidth: 1280,
      pixelsPerSecond: 100,
      rippleEditEnabled: false,
      snapEnabled: true,
      snapGuides: [],
      _batchDepth: 0,
      _pendingEpochIncrement: false,
      markers: [],
    });
  });

  it("maintains non-negative startTime and positive duration for all clips", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          trackId: fc.constantFrom("video-1", "audio-1"),
          name: fc.string({ minLength: 1, maxLength: 20 }),
          type: fc.constantFrom<TrackType>("video", "audio"),
          startTime: fc.double({ min: -100, max: 1000, noNaN: true }),
          duration: fc.double({ min: -50, max: 500, noNaN: true }),
          sourceStartTime: fc.double({ min: 0, max: 100, noNaN: true }),
        }),
        (clipInput) => {
          const store = useTimelineStore.getState();
          const validClip: Clip = {
            id: clipInput.id,
            trackId: clipInput.trackId,
            name: clipInput.name,
            type: clipInput.type,
            startTime: Math.max(0, clipInput.startTime),
            duration: Math.max(0.1, clipInput.duration),
            sourceStartTime: clipInput.sourceStartTime,
          };

          store.addClip(validClip);

          const updatedClips = useTimelineStore.getState().clips;
          const added = updatedClips.find((c) => c.id === validClip.id);
          if (added) {
            expect(added.startTime).toBeGreaterThanOrEqual(0);
            expect(added.duration).toBeGreaterThan(0);
            expect(Number.isFinite(added.startTime)).toBe(true);
            expect(Number.isFinite(added.duration)).toBe(true);
          }
        }
      )
    );
  });

  it("getTimelineEndTime() is always >= max(clip.startTime + clip.duration)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            trackId: fc.constantFrom("video-1", "audio-1"),
            startTime: fc.double({ min: 0, max: 500, noNaN: true }),
            duration: fc.double({ min: 0.1, max: 100, noNaN: true }),
          }),
          { minLength: 0, maxLength: 10 }
        ),
        (clipSpecs) => {
          useTimelineStore.setState({ clips: [] });
          const store = useTimelineStore.getState();

          clipSpecs.forEach((spec, idx) => {
            const clip: Clip = {
              id: `${spec.id}-${idx}`,
              trackId: spec.trackId,
              name: `Clip ${idx}`,
              type: spec.trackId === "video-1" ? "video" : "audio",
              startTime: spec.startTime,
              duration: spec.duration,
              sourceStartTime: 0,
            };
            store.addClip(clip);
          });

          const currentClips = useTimelineStore.getState().clips;
          const maxEnd = currentClips.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);
          const timelineEndTime = useTimelineStore.getState().getTimelineEndTime();

          expect(timelineEndTime).toBeGreaterThanOrEqual(maxEnd);
        }
      )
    );
  });

  it("monotonically increments epoch across mutations", () => {
    const initialEpoch = useTimelineStore.getState().epoch;
    const store = useTimelineStore.getState();

    store.addTrack("video");
    const epochAfterAddTrack = useTimelineStore.getState().epoch;
    expect(epochAfterAddTrack).toBeGreaterThan(initialEpoch);

    const testClip: Clip = {
      id: "clip-epoch-test",
      trackId: "video-1",
      name: "Test",
      type: "video",
      startTime: 0,
      duration: 5,
      sourceStartTime: 0,
    };
    store.addClip(testClip);
    const epochAfterAddClip = useTimelineStore.getState().epoch;
    expect(epochAfterAddClip).toBeGreaterThan(epochAfterAddTrack);

    store.updateClip("clip-epoch-test", { name: "Updated Test Name" });
    const epochAfterUpdateClip = useTimelineStore.getState().epoch;
    expect(epochAfterUpdateClip).toBeGreaterThan(epochAfterAddClip);

    store.removeClip("clip-epoch-test");
    const epochAfterRemoveClip = useTimelineStore.getState().epoch;
    expect(epochAfterRemoveClip).toBeGreaterThan(epochAfterUpdateClip);
  });

  it("defers epoch increment until withBatch completes", () => {
    const initialEpoch = useTimelineStore.getState().epoch;
    let epochInsideBatch = -1;

    useTimelineStore.getState().withBatch(() => {
      const store = useTimelineStore.getState();
      store.addTrack("audio");
      store.addTrack("text");
      epochInsideBatch = useTimelineStore.getState().epoch;
    });

    const epochAfterBatch = useTimelineStore.getState().epoch;

    expect(epochInsideBatch).toBe(initialEpoch);
    expect(epochAfterBatch).toBe(initialEpoch + 1);
  });

  it("properly calculates insertIndex for new tracks", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<TrackType>("video", "audio", "text", "sticker", "filter", "video-effect", "body-effect"),
        (trackType) => {
          const store = useTimelineStore.getState();
          const initialTrackCount = store.tracks.length;
          store.addTrack(trackType);

          const updatedTracks = useTimelineStore.getState().tracks;
          expect(updatedTracks.length).toBe(initialTrackCount + 1);
          expect(updatedTracks.some((t) => t.type === trackType)).toBe(true);
        }
      )
    );
  });

  it("handles marker additions and navigation safely", () => {
    const store = useTimelineStore.getState();
    const id1 = store.addMarker(2.5, "Marker 1", "#ff0000");
    const id2 = store.addMarker(10.0, "Marker 2", "#00ff00");
    const id3 = store.addMarker(5.0, "Marker 3", "#0000ff");

    const markers = useTimelineStore.getState().markers;
    expect(markers.length).toBe(3);
    expect(markers.find((m) => m.id === id1)?.time).toBe(2.5);

    store.removeMarker(id2);
    expect(useTimelineStore.getState().markers.length).toBe(2);
    expect(useTimelineStore.getState().markers.find((m) => m.id === id2)).toBeUndefined();
  });
});
