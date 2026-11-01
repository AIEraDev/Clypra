import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "../timelineStore";
import { useProjectStore } from "../projectStore";
import { useSettingsStore } from "../settingsStore";
import type { Project, Track, Clip } from "@/types";

const mockReadOpfs = vi.fn();
const mockWriteOpfs = vi.fn();
const mockClearOpfs = vi.fn();
const mockDiff = vi.fn();
const mockSerialize = vi.fn(async (state: any) => ({
  type: "SERIALIZED",
  id: "test",
  json: JSON.stringify(state),
  serializeMs: 1,
}));

vi.mock("@/core/runtime/CrashRecoveryService", () => ({
  saveSnapshot: vi.fn(async () => {}),
  clearSnapshot: vi.fn(async () => {}),
  hasSnapshot: vi.fn(async () => false),
  getSnapshot: vi.fn(async () => null),
}));

vi.mock("@/core/workers/projectWorkerClient", () => ({
  getProjectWorkerClient: () => ({
    readOpfs: mockReadOpfs,
    writeOpfs: mockWriteOpfs,
    clearOpfs: mockClearOpfs,
    diff: mockDiff,
    serialize: mockSerialize,
  }),
}));

vi.mock("@/core/platform", () => ({
  platform: {
    saveProject: vi.fn(async () => ({
      verified: true,
      path: "/tmp/project.json",
      bytesWritten: 100,
      checksum: "abc",
    })),
    loadProject: vi.fn(async () => "{}"),
    isTauri: () => false,
  },
}));

vi.mock("@/core/runtime/ProjectSession", () => ({
  disposeActiveSession: vi.fn(),
  createProjectSession: vi.fn(),
}));

vi.mock("@/core/runtime/ProjectStateReset", () => ({
  resetAllProjectState: vi.fn(),
}));

describe("Crash Recovery & Project Hydration Clip Deduplication (BUG-CRD-001)", () => {
  const sampleProject: Project = {
    id: "proj-crd-test",
    name: "Crash Recovery Dedup Test",
    createdAt: 1000,
    updatedAt: 1000,
    aspectRatio: "16:9" as any,
    canvasWidth: 1920,
    canvasHeight: 1080,
    frameRate: 30,
    duration: 60,
    timelineSchemaVersion: 1,
    audioModelVersion: 1,
  };

  const textTrack: Track = {
    id: "track-text-1",
    type: "text",
    name: "Text",
    muted: false,
    locked: false,
    visible: true,
    height: 48,
  };

  const textClip1: Clip = {
    id: "clip-text-1",
    trackId: "track-text-1",
    startTime: 0,
    duration: 10,
    trimIn: 0,
    trimOut: 10,
    speed: 1,
    volume: 1,
    muted: false,
    name: "Text",
    kind: "text",
  } as unknown as Clip;

  const textClip2: Clip = {
    id: "clip-text-2",
    trackId: "track-text-1",
    startTime: 20,
    duration: 5,
    trimIn: 0,
    trimOut: 5,
    speed: 1,
    volume: 1,
    muted: false,
    name: "T",
    kind: "text",
  } as unknown as Clip;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadOpfs.mockReset();
    mockWriteOpfs.mockReset();
    mockClearOpfs.mockReset();
    mockDiff.mockReset();

    useSettingsStore.setState({ autoSave: true });
    useProjectStore.setState({
      project: sampleProject,
      mediaAssets: [],
      isDirty: false,
    });
  });

  it("hydrateFromProject filters out duplicate tracks and duplicate clips with identical IDs", () => {
    // Mirror the exact user bug report: 8 identical text tracks and 8 identical text clips
    const duplicatedTracks: Track[] = Array.from({ length: 8 }, () => ({ ...textTrack }));
    const duplicatedClips: Clip[] = [
      ...Array.from({ length: 8 }, () => ({ ...textClip1 })),
      ...Array.from({ length: 8 }, () => ({ ...textClip2 })),
    ];

    useTimelineStore.getState().hydrateFromProject({
      tracks: duplicatedTracks,
      clips: duplicatedClips,
      transitions: [],
      markers: [],
    });

    const state = useTimelineStore.getState();

    // Verify only 1 text track exists (not 8)
    const textTracks = state.tracks.filter((t) => t.id === "track-text-1");
    expect(textTracks).toHaveLength(1);

    // Verify each unique clip exists exactly once (not 8 times)
    const c1 = state.clips.filter((c) => c.id === "clip-text-1");
    expect(c1).toHaveLength(1);
    const c2 = state.clips.filter((c) => c.id === "clip-text-2");
    expect(c2).toHaveLength(1);
    expect(state.clips).toHaveLength(2);
  });

  it("hydrateFromProject filters out duplicate transitions and markers", () => {
    const transition = { id: "tr-1", type: "crossfade", duration: 1 } as any;
    const marker = { id: "mk-1", time: 5, label: "Point A", color: "#f00" } as any;

    useTimelineStore.getState().hydrateFromProject({
      tracks: [textTrack],
      clips: [textClip1],
      transitions: [transition, { ...transition }, { ...transition }],
      markers: [marker, { ...marker }],
    });

    const state = useTimelineStore.getState();
    expect(state.transitions).toHaveLength(1);
    expect(state.markers).toHaveLength(1);
  });

  it("loadProject skips OPFS patch replay when skipOpfsPatches: true and clears the stale patch file", async () => {
    // Simulate stale OPFS patches that would append an extra clip if replayed
    const patches = [
      {
        op: "add",
        path: "/clips/-",
        value: {
          id: "clip-stale-dup",
          trackId: "track-text-1",
          startTime: 30,
          duration: 5,
          name: "Stale Duplicate",
          kind: "text",
        },
      },
    ];
    mockReadOpfs.mockResolvedValueOnce(JSON.stringify(patches));
    mockClearOpfs.mockResolvedValue(undefined);

    await useProjectStore.getState().loadProject(sampleProject, {
      tracks: [textTrack],
      clips: [textClip1],
      skipOpfsPatches: true,
    });

    // OPFS read must NOT have been called to replay patches
    expect(mockReadOpfs).not.toHaveBeenCalled();

    // Stale OPFS file must be cleared immediately
    expect(mockClearOpfs).toHaveBeenCalledWith(`${sampleProject.id}.patches.json`);

    // Only the original snapshot clips should be hydrated
    const state = useTimelineStore.getState();
    expect(state.clips.some((c) => c.id === "clip-stale-dup")).toBe(false);
    expect(state.clips.some((c) => c.id === "clip-text-1")).toBe(true);
  });

  it("loadProject replays delta patches and clears OPFS file for normal project open", async () => {
    const extraClip: Clip = {
      id: "clip-normal-delta",
      trackId: "track-text-1",
      startTime: 35,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      speed: 1,
      volume: 1,
      muted: false,
      name: "Delta Clip",
      kind: "text",
    } as unknown as Clip;

    const patches = [
      {
        op: "add",
        path: "/clips/-",
        value: extraClip,
      },
    ];
    mockReadOpfs.mockResolvedValueOnce(JSON.stringify(patches));
    mockClearOpfs.mockResolvedValue(undefined);

    await useProjectStore.getState().loadProject(sampleProject, {
      tracks: [textTrack],
      clips: [textClip1],
      skipOpfsPatches: false,
    });

    // OPFS read should have been called
    expect(mockReadOpfs).toHaveBeenCalledWith(`${sampleProject.id}.patches.json`);

    // Delta clip should have been added
    const state = useTimelineStore.getState();
    expect(state.clips.some((c) => c.id === "clip-normal-delta")).toBe(true);

    // Stale patches file must be cleared after hydration
    expect(mockClearOpfs).toHaveBeenCalledWith(`${sampleProject.id}.patches.json`);
  });

  it("scheduleAutoSave replaces delta patches instead of appending duplicate cumulative copies", async () => {
    vi.useFakeTimers();
    try {
      // 1. Establish baseline persisted snapshot via saveCurrentProject
      await useProjectStore.getState().saveCurrentProject();

      const patchOps = [
        { op: "add", path: "/tracks/-", value: textTrack },
        { op: "add", path: "/clips/-", value: textClip1 },
      ];
      mockDiff.mockResolvedValue({
        type: "PATCH_READY",
        patch: patchOps,
        diffMs: 1,
      });

      // 2. Trigger autoSave first time
      useProjectStore.getState().scheduleAutoSave();
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockWriteOpfs).toHaveBeenCalledTimes(1);
      expect(mockWriteOpfs).toHaveBeenLastCalledWith(
        `${sampleProject.id}.patches.json`,
        JSON.stringify(patchOps),
      );

      // 3. Trigger autoSave second time with identical diff (cumulative from baseline)
      useProjectStore.getState().scheduleAutoSave();
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockWriteOpfs).toHaveBeenCalledTimes(2);
      // The second write must NOT have duplicated patchOps into 4 elements
      const writtenJson = mockWriteOpfs.mock.calls[1][1];
      const parsedWritten = JSON.parse(writtenJson);
      expect(parsedWritten).toHaveLength(2);
      expect(parsedWritten).toEqual(patchOps);
    } finally {
      vi.useRealTimers();
    }
  });
});
