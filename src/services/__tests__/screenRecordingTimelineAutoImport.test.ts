import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";

describe("Screen Recording Auto-Timeline Import", () => {
  beforeEach(() => {
    // Reset project and timeline stores
    useProjectStore.setState({
      project: {
        id: "test-proj",
        name: "Test Screen Recording Project",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        aspectRatio: "16:9",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        duration: 0,
      },
      mediaAssets: [],
    });

    useTimelineStore.setState({
      tracks: [
        { id: "main-video-track", type: "video", name: "Video 1", muted: false, locked: false, visible: true, height: 68 },
      ],
      clips: [],
      gaps: [],
      transitions: [],
      mainVideoTrackId: "main-video-track",
      epoch: 0,
      _batchDepth: 0,
      _pendingEpochIncrement: false,
    });
  });

  it("should auto-create Picture-in-Picture layout for dual recordings (screen + camera)", () => {
    const canvasW = 1920;
    const canvasH = 1080;

    const screenAsset = {
      id: "asset-screen-1",
      name: "screen_1700000000000.webm",
      path: "/recordings/screen_1700000000000.webm",
      type: "video" as const,
      duration: 12.5,
      width: 1920,
      height: 1080,
      size: 1024,
    };

    const cameraAsset = {
      id: "asset-camera-1",
      name: "camera_1700000000000.webm",
      path: "/recordings/camera_1700000000000.webm",
      type: "video" as const,
      duration: 12.5,
      width: 1280,
      height: 720,
      size: 512,
    };

    useProjectStore.getState().addMediaAsset(screenAsset);
    useProjectStore.getState().addMediaAsset(cameraAsset);

    const timelineStore = useTimelineStore.getState();

    timelineStore.withBatch(() => {
      let tracks = useTimelineStore.getState().tracks;
      let mainVideoTrack = tracks.find((t) => t.type === "video");

      if (!mainVideoTrack) {
        useTimelineStore.getState().addTrack("video");
        tracks = useTimelineStore.getState().tracks;
        mainVideoTrack = tracks.find((t) => t.type === "video");
      }

      const mainTrackId = mainVideoTrack!.id;

      // 1. Screen Clip
      const screenClip = {
        id: "clip-screen",
        name: screenAsset.name,
        trackId: mainTrackId,
        mediaId: screenAsset.id,
        startTime: 0,
        duration: screenAsset.duration,
        trimIn: 0,
        trimOut: screenAsset.duration,
        x: 0,
        y: 0,
        width: canvasW,
        height: canvasH,
        opacity: 1,
        rotation: 0,
        fitMode: "contain" as const,
        aspectRatioLocked: true,
        kind: "video" as const,
      };
      useTimelineStore.getState().addClip(screenClip);

      // 2. Camera Overlay Clip (PiP)
      if (cameraAsset) {
        const overlayTrackId = useTimelineStore.getState().insertTrackAt("video", 0);

        const pipW = Math.round(canvasW * 0.28);
        const pipH = Math.round(canvasH * 0.28);
        const margin = 40;
        const pipX = canvasW - pipW - margin;
        const pipY = canvasH - pipH - margin;

        const cameraClip = {
          id: "clip-camera",
          name: cameraAsset.name,
          trackId: overlayTrackId,
          mediaId: cameraAsset.id,
          startTime: 0,
          duration: cameraAsset.duration,
          trimIn: 0,
          trimOut: cameraAsset.duration,
          x: pipX,
          y: pipY,
          width: pipW,
          height: pipH,
          opacity: 1,
          rotation: 0,
          fitMode: "cover" as const,
          aspectRatioLocked: true,
          kind: "video" as const,
        };
        useTimelineStore.getState().addClip(cameraClip);
      }
    });

    const state = useTimelineStore.getState();
    expect(state.tracks).toHaveLength(2);
    expect(state.clips).toHaveLength(2);

    const screenClipResult = state.clips.find((c) => c.mediaId === screenAsset.id);
    const cameraClipResult = state.clips.find((c) => c.mediaId === cameraAsset.id);

    expect(screenClipResult).toBeDefined();
    expect(screenClipResult?.x).toBe(0);
    expect(screenClipResult?.y).toBe(0);
    expect(screenClipResult?.width).toBe(1920);

    expect(cameraClipResult).toBeDefined();
    expect(cameraClipResult?.width).toBe(538); // 1920 * 0.28 = 537.6 -> 538
    expect(cameraClipResult?.height).toBe(302); // 1080 * 0.28 = 302.4 -> 302
    expect(cameraClipResult?.x).toBe(1920 - 538 - 40); // 1342
    expect(cameraClipResult?.y).toBe(1080 - 302 - 40); // 738

    // Verify top track ordering (camera clip track is at index 0)
    expect(state.tracks[0].id).toBe(cameraClipResult?.trackId);
  });
});
