import { describe, expect, it, beforeEach } from "vitest";
import { useTimelineStore } from "../timelineStore";
import { useHistoryStore } from "../historyStore";
import { SplitClipCommand } from "@/core/history/commands/SplitClipCommand";
import { buildTimelineDragCommand } from "@/core/history/commands/TimelineDragCommand";
import {
  toRustProject,
  validateAndMigrateProjectPayload,
} from "@/types/serialization";
import { getTrackVisualSpec } from "@/lib/timeline/trackTypeConfig";
import { compareCompositorClips } from "@/core/compositor/ordering";
import type { Clip, Track, Project } from "@/types";
import type { CompositorClip } from "@/core/compositor/types";

/** Minimal valid Clip fixture — required geometry fields are set to neutral defaults */
function makeClip(
  overrides: Partial<Clip> &
    Pick<
      Clip,
      | "id"
      | "trackId"
      | "mediaId"
      | "startTime"
      | "duration"
      | "trimIn"
      | "trimOut"
    >,
): Clip {
  return {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
    kind: "video",
    ...overrides,
  } as Clip;
}

describe("Split Clip -> New Track -> Project Reload Architectural Invariants", () => {
  beforeEach(() => {
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      gaps: [],
      transitions: [],
      markers: [],
      captionTracks: [],
      mainVideoTrackId: null,
      epoch: 0,
    });
    useHistoryStore.getState().clear();
  });

  it("preserves A-Roll/B-Roll roles and preview stacking order across save and reload", () => {
    const mainTrack: Track = {
      id: "track-main-v1",
      type: "video",
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const initialClip = makeClip({
      id: "clip-original",
      trackId: "track-main-v1",
      mediaId: "asset-video-1",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
    });

    // 1. Initial State: Single video track (A-Roll)
    useTimelineStore.setState({
      tracks: [mainTrack],
      clips: [initialClip],
      mainVideoTrackId: "track-main-v1",
      epoch: 1,
    });

    expect(
      getTrackVisualSpec(mainTrack, [mainTrack], "track-main-v1"),
    ).toMatchObject({
      role: "a-roll",
      label: "A-Roll (Main)",
      height: 80,
    });

    // 2. Split Clip at 6.0 seconds into two halves
    // SplitClipCommand(clipId, splitTime, frameRate, originalClip)
    const splitCommand = new SplitClipCommand(
      "clip-original",
      6.0,
      30,
      initialClip,
    );
    useHistoryStore.getState().execute(splitCommand);

    const stateAfterSplit = useTimelineStore.getState();
    expect(stateAfterSplit.clips).toHaveLength(2);
    expect(stateAfterSplit.mainVideoTrackId).toBe("track-main-v1");

    const leftClip = stateAfterSplit.clips.find((c) => c.startTime === 0)!;
    const rightClip = stateAfterSplit.clips.find((c) => c.startTime > 0)!;
    expect(leftClip).toBeDefined();
    expect(rightClip).toBeDefined();

    // 3. Move clip-right to a brand new video track (B-Roll)
    // OriginalClipPlacement only has { trackId, startTime, index }
    const dragCommand = buildTimelineDragCommand({
      state: stateAfterSplit,
      drag: {
        draggingClipId: rightClip.id,
        draggedClipIds: [rightClip.id],
        originalPlacements: {
          [rightClip.id]: {
            trackId: "track-main-v1",
            startTime: rightClip.startTime,
            index: 1,
          },
        },
        originalStartTime: rightClip.startTime,
        offsetX: 0,
        willCreateNewTrack: true,
        newTrackPosition: "above",
      },
      clip: rightClip,
      trackType: "video",
      snapEnabled: false,
      currentTime: rightClip.startTime,
      pixelsPerSecond: 100,
      newTrackInsertIndex: 0,
    });

    expect(dragCommand).not.toBeNull();
    useHistoryStore.getState().execute(dragCommand!);

    const stateAfterDrag = useTimelineStore.getState();
    expect(stateAfterDrag.tracks).toHaveLength(2);

    const bRollTrack = stateAfterDrag.tracks[0];
    const aRollTrack = stateAfterDrag.tracks[1];

    expect(bRollTrack.id).not.toBe("track-main-v1");
    expect(aRollTrack.id).toBe("track-main-v1");
    expect(stateAfterDrag.mainVideoTrackId).toBe("track-main-v1");

    // Check visual roles before save
    const bRollSpec = getTrackVisualSpec(
      bRollTrack,
      stateAfterDrag.tracks,
      stateAfterDrag.mainVideoTrackId,
    );
    const aRollSpec = getTrackVisualSpec(
      aRollTrack,
      stateAfterDrag.tracks,
      stateAfterDrag.mainVideoTrackId,
    );

    expect(bRollSpec.role).toBe("b-roll");
    expect(bRollSpec.height).toBe(60);
    expect(aRollSpec.role).toBe("a-roll");
    expect(aRollSpec.height).toBe(80);

    // Verify preview compositor ordering: B-Roll (track index 0) renders on top of A-Roll (track index 1)
    // Use `as unknown as CompositorClip` for test fixtures that only need the sort-relevant fields.
    const compositorClips = [
      {
        ...leftClip,
        trackIndex: 1,
        role: "video" as const,
        zIndex: 0,
        evaluationPriority: 0,
      } as unknown as CompositorClip,
      {
        ...rightClip,
        trackIndex: 0,
        role: "video" as const,
        zIndex: 0,
        evaluationPriority: 0,
      } as unknown as CompositorClip,
    ];
    // compareCompositorClips orders bottom to top (first is background, last is foreground)
    const sorted = [...compositorClips].sort(compareCompositorClips);
    expect(sorted[0].id).toBe(leftClip.id); // A-roll background
    expect(sorted[1].id).toBe(rightClip.id); // B-roll foreground

    // 4. Save to Rust JSON payload
    const projectMeta: Project = {
      id: "test-proj-1",
      name: "Test Project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 10,
      timelineSchemaVersion: 1,
    };

    const rustPayload = toRustProject(projectMeta, {
      tracks: stateAfterDrag.tracks,
      clips: stateAfterDrag.clips,
      gaps: stateAfterDrag.gaps,
      transitions: stateAfterDrag.transitions,
      markers: stateAfterDrag.markers,
      mainVideoTrackId: stateAfterDrag.mainVideoTrackId,
    });

    expect(rustPayload.main_video_track_id).toBe("track-main-v1");
    expect(rustPayload.tracks).toHaveLength(2);

    // 5. Open in a brand new project session
    useTimelineStore.setState({
      tracks: [],
      clips: [],
      gaps: [],
      transitions: [],
      markers: [],
      mainVideoTrackId: null,
      epoch: 0,
    });

    const normalized = validateAndMigrateProjectPayload(rustPayload);
    expect(normalized.mainVideoTrackId).toBe("track-main-v1");

    useTimelineStore.getState().hydrateFromProject({
      tracks: normalized.tracks,
      clips: normalized.clips,
      transitions: normalized.transitions,
      gaps: normalized.gaps,
      markers: normalized.markers,
      mainVideoTrackId: normalized.mainVideoTrackId,
    });

    const hydratedState = useTimelineStore.getState();

    // Verify tracks and mainVideoTrackId in new session
    expect(hydratedState.mainVideoTrackId).toBe("track-main-v1");
    expect(hydratedState.tracks).toHaveLength(2);
    expect(hydratedState.tracks[0].id).toBe(bRollTrack.id);
    expect(hydratedState.tracks[1].id).toBe("track-main-v1");

    // Verify visual roles after reload
    const reloadedBRollSpec = getTrackVisualSpec(
      hydratedState.tracks[0],
      hydratedState.tracks,
      hydratedState.mainVideoTrackId,
    );
    const reloadedARollSpec = getTrackVisualSpec(
      hydratedState.tracks[1],
      hydratedState.tracks,
      hydratedState.mainVideoTrackId,
    );

    expect(reloadedBRollSpec.role).toBe("b-roll");
    expect(reloadedBRollSpec.label).toBe("B-Roll");
    expect(reloadedBRollSpec.height).toBe(60);

    expect(reloadedARollSpec.role).toBe("a-roll");
    expect(reloadedARollSpec.label).toBe("A-Roll (Main)");
    expect(reloadedARollSpec.height).toBe(80);

    // Verify preview compositor order in new session
    const reloadedCompositorClips = [
      {
        ...leftClip,
        trackIndex: 1,
        role: "video" as const,
        zIndex: 0,
        evaluationPriority: 0,
      } as unknown as CompositorClip,
      {
        ...rightClip,
        trackIndex: 0,
        role: "video" as const,
        zIndex: 0,
        evaluationPriority: 0,
      } as unknown as CompositorClip,
    ];
    const reloadedSorted = [...reloadedCompositorClips].sort(
      compareCompositorClips,
    );
    expect(reloadedSorted[0].id).toBe(leftClip.id);
    expect(reloadedSorted[1].id).toBe(rightClip.id);
  });

  it("correctly infers bottommost video track as A-Roll when mainVideoTrackId is absent in legacy projects", () => {
    const bRollTrack: Track = {
      id: "track-overlay-v2",
      type: "video",
      name: "Video 2",
      muted: false,
      locked: false,
      visible: true,
      height: 60,
    };
    const aRollTrack: Track = {
      id: "track-main-v1",
      type: "video",
      name: "Video 1",
      muted: false,
      locked: false,
      visible: true,
      height: 80,
    };

    const bRollClip = makeClip({
      id: "clip-overlay",
      trackId: "track-overlay-v2",
      mediaId: "asset-2",
      startTime: 6,
      duration: 4,
      trimIn: 0,
      trimOut: 4,
    });
    const aRollClip = makeClip({
      id: "clip-main",
      trackId: "track-main-v1",
      mediaId: "asset-1",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
    });

    // Hydrate legacy project where mainVideoTrackId is null/undefined
    useTimelineStore.getState().hydrateFromProject({
      tracks: [bRollTrack, aRollTrack],
      clips: [bRollClip, aRollClip],
      mainVideoTrackId: null,
    });

    const state = useTimelineStore.getState();
    expect(state.mainVideoTrackId).toBe("track-main-v1");
    expect(state.tracks[0].id).toBe("track-overlay-v2");
    expect(state.tracks[1].id).toBe("track-main-v1");

    expect(
      getTrackVisualSpec(state.tracks[0], state.tracks, state.mainVideoTrackId)
        .role,
    ).toBe("b-roll");
    expect(
      getTrackVisualSpec(state.tracks[1], state.tracks, state.mainVideoTrackId)
        .role,
    ).toBe("a-roll");
  });
});
