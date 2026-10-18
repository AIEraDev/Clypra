import { describe, it, expect, beforeEach } from "vitest";
import { useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { TimelinePlacementEngine } from "../placementEngine";
import { getTrackVisualSpec, shouldAutoPruneTrack } from "../trackTypeConfig";
import { handleCreateTrackAndDrop } from "../timelineUtils";
import { toRustProject, validateAndMigrateProjectPayload } from "@/types/serialization";

describe("Preserve A-Roll track when adding non-video content to an empty timeline", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      transitions: [],
      gaps: [],
      mainVideoTrackId: null,
      epoch: 0,
    });

    useProjectStore.setState({
      project: {
        id: "test-project-1",
        name: "Test Project",
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
      } as any,
      mediaAssets: [
        {
          id: "video-asset-1",
          name: "Footage.mp4",
          type: "video",
          path: "/path/video.mp4",
          duration: 10.0,
          width: 1920,
          height: 1080,
          size: 2048,
        },
      ],
    });
  });

  it("preserves the primary A-Roll video track below when adding a text clip to an empty timeline", async () => {
    const res = await TimelinePlacementEngine.addToTimeline({
      item: { text: "Default text" },
      type: "text",
      playheadTime: 0,
    });

    expect(res.success).toBe(true);

    const state = useTimelineStore.getState();
    expect(state.tracks.length).toBe(2);

    // Track 0 is the overlay text track
    const textTrack = state.tracks[0];
    expect(textTrack.type).toBe("text");

    // Track 1 is the primary A-Roll video track
    const aRollTrack = state.tracks[1];
    expect(aRollTrack.type).toBe("video");
    expect(state.mainVideoTrackId).toBe(aRollTrack.id);

    // Visual spec resolves correctly to A-Roll
    const visualSpec = getTrackVisualSpec(aRollTrack, state.tracks, state.mainVideoTrackId);
    expect(visualSpec.role).toBe("a-roll");
    expect(visualSpec.tone).toBe("primary");
    expect(visualSpec.height).toBe(80);

    // Clip was placed in the text track, leaving A-Roll track empty for video drops
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].trackId).toBe(textTrack.id);
    expect(state.clips[0].kind).toBe("text");
  });

  it("preserves the primary A-Roll video track above when adding an audio clip to an empty timeline", async () => {
    const res = await TimelinePlacementEngine.addToTimeline({
      item: {
        id: "music-1",
        name: "Background Music",
        path: "/music/track.mp3",
        duration: 12.0,
      },
      type: "audio",
      playheadTime: 0,
    });

    expect(res.success).toBe(true);

    const state = useTimelineStore.getState();
    expect(state.tracks.length).toBe(2);

    // Track 0 is the primary A-Roll video track
    const aRollTrack = state.tracks[0];
    expect(aRollTrack.type).toBe("video");
    expect(state.mainVideoTrackId).toBe(aRollTrack.id);

    // Track 1 is the audio track below A-Roll
    const audioTrack = state.tracks[1];
    expect(audioTrack.type).toBe("audio");

    // Audio clip is in the audio track
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].trackId).toBe(audioTrack.id);
  });

  it("does not spawn duplicate A-Roll tracks when multiple overlay tracks are added", async () => {
    // 1. Add first text clip
    await TimelinePlacementEngine.addToTimeline({
      item: { text: "Title 1" },
      type: "text",
      playheadTime: 0,
    });

    const state1 = useTimelineStore.getState();
    expect(state1.tracks.length).toBe(2);
    const originalARollId = state1.mainVideoTrackId;

    // 2. Add second text clip at the same timestamp (forces a new text track)
    await TimelinePlacementEngine.addToTimeline({
      item: { text: "Title 2" },
      type: "text",
      playheadTime: 0,
    });

    const state2 = useTimelineStore.getState();
    // Two text tracks + one A-roll track = 3 tracks total
    expect(state2.tracks.length).toBe(3);
    const videoTracks = state2.tracks.filter((t) => t.type === "video");
    expect(videoTracks.length).toBe(1);
    expect(videoTracks[0].id).toBe(originalARollId);
    expect(state2.mainVideoTrackId).toBe(originalARollId);

    // Video track is still at the bottom of the visual rows
    expect(state2.tracks[2].id).toBe(originalARollId);
  });

  it("reuses the preserved A-Roll track when a video clip is subsequently added", async () => {
    // 1. Start by adding a text clip
    await TimelinePlacementEngine.addToTimeline({
      item: { text: "Opening Title" },
      type: "text",
      playheadTime: 0,
    });

    const stateAfterText = useTimelineStore.getState();
    const aRollId = stateAfterText.mainVideoTrackId!;
    expect(aRollId).toBeTruthy();

    // 2. Now add a video clip
    const videoRes = await TimelinePlacementEngine.addToTimeline({
      item: { id: "video-asset-1" },
      type: "media",
      playheadTime: 0,
    });

    expect(videoRes.success).toBe(true);

    const stateAfterVideo = useTimelineStore.getState();
    // Tracks count should NOT increase — video clip reused the preserved A-Roll track!
    expect(stateAfterVideo.tracks.length).toBe(2);
    expect(videoRes.trackId).toBe(aRollId);

    const videoClip = stateAfterVideo.clips.find((c) => c.mediaId === "video-asset-1");
    expect(videoClip).toBeDefined();
    expect(videoClip?.trackId).toBe(aRollId);
  });

  it("protects the preserved empty A-Roll track from auto-pruning when deleting clips", () => {
    // Initialize with text track + empty A-Roll track
    const aRollTrack = {
      id: "track-aroll-1",
      type: "video" as const,
      name: "Video 1",
      locked: false,
      muted: false,
      visible: true,
      height: 80,
    };
    const textTrack = {
      id: "track-text-1",
      type: "text" as const,
      name: "Text 1",
      locked: false,
      muted: false,
      visible: true,
      height: 30,
    };

    useTimelineStore.setState({
      tracks: [textTrack, aRollTrack],
      clips: [
        {
          id: "clip-text-1",
          trackId: "track-text-1",
          kind: "text",
          startTime: 0,
          duration: 5,
          text: "Hello",
        } as any,
      ],
      mainVideoTrackId: aRollTrack.id,
    });

    // Verify shouldAutoPruneTrack protects A-Roll but allows pruning textTrack
    expect(shouldAutoPruneTrack(aRollTrack, [textTrack, aRollTrack], aRollTrack.id)).toBe(false);
    expect(shouldAutoPruneTrack(textTrack, [textTrack, aRollTrack], aRollTrack.id)).toBe(true);

    // Delete the text clip
    useTimelineStore.getState().removeClip("clip-text-1");

    const stateAfterDelete = useTimelineStore.getState();
    // Text track was pruned because it became empty, but A-Roll track remains!
    expect(stateAfterDelete.tracks.length).toBe(1);
    expect(stateAfterDelete.tracks[0].id).toBe(aRollTrack.id);
    expect(stateAfterDelete.mainVideoTrackId).toBe(aRollTrack.id);
  });

  it("ensureTrackForType('video') returns existing A-Roll or creates one without throwing", () => {
    const store = useTimelineStore.getState();

    // On empty timeline, ensureTrackForType("video") creates and returns the primary track
    const videoTrackId = store.ensureTrackForType("video");
    expect(videoTrackId).toBeTruthy();

    const state = useTimelineStore.getState();
    expect(state.tracks.length).toBe(1);
    expect(state.tracks[0].id).toBe(videoTrackId);
    expect(state.tracks[0].type).toBe("video");
    expect(state.mainVideoTrackId).toBe(videoTrackId);

    // Subsequent call returns the exact same track
    const secondCallId = store.ensureTrackForType("video");
    expect(secondCallId).toBe(videoTrackId);
    expect(useTimelineStore.getState().tracks.length).toBe(1);
  });

  it("preserves A-Roll track when dropping non-video media onto empty timeline via handleCreateTrackAndDrop", () => {
    handleCreateTrackAndDrop(
      {
        type: "MEDIA_ASSET",
        asset: {
          id: "audio-drop-1",
          name: "Soundtrack",
          type: "audio",
          path: "/audio/soundtrack.mp3",
          duration: 8.0,
          size: 1024,
        },
      } as any,
      { getClientOffset: () => ({ x: 100, y: 100 }) } as any,
      0,
    );

    const state = useTimelineStore.getState();
    expect(state.tracks.length).toBe(2);

    // Track 0 is the primary A-Roll video track
    expect(state.tracks[0].type).toBe("video");
    expect(state.mainVideoTrackId).toBe(state.tracks[0].id);

    // Track 1 is the dropped audio track
    expect(state.tracks[1].type).toBe("audio");
    expect(state.clips.length).toBe(1);
    expect(state.clips[0].trackId).toBe(state.tracks[1].id);
  });

  it("preserves empty A-Roll track and prunes secondary empty tracks when reopening project with cleanEmptyTracks", () => {
    const textTrack = {
      id: "track-text-1",
      type: "text" as const,
      name: "Text 1",
      muted: false,
      locked: false,
      visible: true,
      height: 30,
    };
    const aRollTrack = {
      id: "track-aroll-1",
      type: "video" as const,
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };
    const secondaryBrollTrack = {
      id: "track-broll-unused",
      type: "video" as const,
      name: "Video 2",
      muted: false,
      locked: false,
      visible: true,
      height: 60,
    };
    const secondaryAudioTrack = {
      id: "track-audio-unused",
      type: "audio" as const,
      name: "Audio 1",
      muted: false,
      locked: false,
      visible: true,
      height: 52,
    };
    const textClip = {
      id: "clip-text-1",
      trackId: textTrack.id,
      kind: "text" as const,
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
      text: "Title Overlay",
    };

    useTimelineStore.getState().hydrateFromProject({
      tracks: [textTrack, secondaryBrollTrack, aRollTrack, secondaryAudioTrack],
      clips: [textClip as any],
      mainVideoTrackId: aRollTrack.id,
      cleanEmptyTracks: true,
    });

    const state = useTimelineStore.getState();
    // Secondary empty B-roll and audio tracks are pruned, but text track and empty A-Roll track are kept!
    expect(state.tracks.length).toBe(2);
    expect(state.tracks.map((t) => t.id)).toEqual([textTrack.id, aRollTrack.id]);
    expect(state.mainVideoTrackId).toBe(aRollTrack.id);

    const visualSpec = getTrackVisualSpec(state.tracks[1], state.tracks, state.mainVideoTrackId);
    expect(visualSpec.role).toBe("a-roll");
    expect(visualSpec.tone).toBe("primary");
    expect(visualSpec.height).toBe(80);
  });

  it("re-establishes preserved A-Roll track below text clips when reloading legacy project without video tracks", () => {
    const textTrack = {
      id: "track-legacy-text-1",
      type: "text" as const,
      name: "Text 1",
      muted: false,
      locked: false,
      visible: true,
      height: 30,
    };
    const textClip = {
      id: "clip-legacy-text-1",
      trackId: textTrack.id,
      kind: "text" as const,
      startTime: 0,
      duration: 4,
      trimIn: 0,
      trimOut: 4,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      text: "Legacy text",
    };

    useTimelineStore.getState().hydrateFromProject({
      tracks: [textTrack],
      clips: [textClip as any],
      cleanEmptyTracks: true,
    });

    const state = useTimelineStore.getState();
    // Text track + newly re-established A-Roll track = 2 tracks
    expect(state.tracks.length).toBe(2);
    expect(state.tracks[0].id).toBe(textTrack.id);
    expect(state.tracks[1].type).toBe("video");
    expect(state.tracks[1].name).toBe("Video 1");
    expect(state.tracks[1].height).toBe(80);
    expect(state.mainVideoTrackId).toBe(state.tracks[1].id);

    const visualSpec = getTrackVisualSpec(state.tracks[1], state.tracks, state.mainVideoTrackId);
    expect(visualSpec.role).toBe("a-roll");
    expect(visualSpec.tone).toBe("primary");
  });

  it("leaves intentionally empty projects cleanly empty without creating tracks", () => {
    useTimelineStore.getState().hydrateFromProject({
      tracks: [],
      clips: [],
      cleanEmptyTracks: true,
    });

    const state = useTimelineStore.getState();
    expect(state.tracks).toEqual([]);
    expect(state.clips).toEqual([]);
    expect(state.mainVideoTrackId).toBeNull();
  });

  it("preserves empty A-Roll track and mainVideoTrackId across full serialization and rehydration round-trip", () => {
    const textTrack = {
      id: "track-text-save",
      type: "text" as const,
      name: "Text 1",
      muted: false,
      locked: false,
      visible: true,
      height: 30,
    };
    const aRollTrack = {
      id: "track-aroll-save",
      type: "video" as const,
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };
    const textClip = {
      id: "clip-text-save",
      trackId: textTrack.id,
      kind: "text" as const,
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
      text: "Saved Title",
    };

    const project = {
      id: "project-save-test",
      name: "Save Test",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      timelineSchemaVersion: 1,
    } as any;

    // Serialize to RustProject representation as done during save
    const rustProject = toRustProject(project, {
      tracks: [textTrack, aRollTrack],
      clips: [textClip as any],
      transitions: [],
      gaps: [],
      markers: [],
      mediaAssets: [],
      mainVideoTrackId: aRollTrack.id,
    });

    expect(rustProject.main_video_track_id).toBe(aRollTrack.id);

    // Validate and migrate as done during load in App.tsx / projectStore
    const snapshot = validateAndMigrateProjectPayload(JSON.stringify(rustProject));
    expect(snapshot.mainVideoTrackId).toBe(aRollTrack.id);

    // Hydrate as done in loadProject with cleanEmptyTracks: true
    useTimelineStore.getState().hydrateFromProject({
      tracks: snapshot.tracks,
      clips: snapshot.clips,
      transitions: snapshot.transitions,
      gaps: snapshot.gaps,
      markers: snapshot.markers,
      mainVideoTrackId: snapshot.mainVideoTrackId,
      cleanEmptyTracks: true,
    });

    const state = useTimelineStore.getState();
    expect(state.tracks.length).toBe(2);
    expect(state.tracks[0].id).toBe(textTrack.id);
    expect(state.tracks[1].id).toBe(aRollTrack.id);
    expect(state.mainVideoTrackId).toBe(aRollTrack.id);
  });
});
