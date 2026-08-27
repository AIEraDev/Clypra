import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../projectStore";
import { useTimelineStore } from "../timelineStore";
import type { Clip, MediaAsset, Project, Track } from "@/types";

const mockFileExists = vi.fn(async (path: string) => true);
const mockOpenFileDialog = vi.fn(async (_opts?: any) => null as any);
const mockGetMediaMetadata = vi.fn(async (path: string) => ({
  duration: 10,
  width: 1920,
  height: 1080,
  fps: 30,
  size: 5000,
}));
const mockExtractPosterFrame = vi.fn(async (path: string) => `poster-${path}`);

vi.mock("@/core/platform", () => ({
  platform: {
    fileExists: (path: string) => mockFileExists(path),
    openFileDialog: (opts: any) => mockOpenFileDialog(opts),
    getMediaMetadata: (path: string) => mockGetMediaMetadata(path),
    extractPosterFrame: (path: string) => mockExtractPosterFrame(path),
    convertFileSrc: (path: string) => `asset://${path}`,
    saveProject: vi.fn(async () => ({ verified: true })),
    loadProject: vi.fn(async () => "{}"),
    isTauri: () => false,
  },
}));

vi.mock("@/core/runtime/CrashRecoveryService", () => ({
  saveSnapshot: vi.fn(async () => {}),
  clearSnapshot: vi.fn(async () => {}),
  hasSnapshot: vi.fn(async () => false),
  getSnapshot: vi.fn(async () => null),
}));

describe("Media Relinking & Missing Detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockProject: Project = {
      id: "proj-relink-test",
      name: "Relink Test Project",
      createdAt: 1000,
      updatedAt: 1000,
      aspectRatio: "16:9" as any,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 20,
      timelineSchemaVersion: 1,
      audioModelVersion: 1,
    };

    const mockTracks: Track[] = [
      { id: "track-1", type: "video", name: "Video 1", locked: false, muted: false, solo: false, visible: true, height: 60 },
    ];

    useProjectStore.setState({
      project: mockProject,
      mediaAssets: [
        {
          id: "asset-1",
          name: "clip_a.mp4",
          path: "/Volumes/OldSSD/Footage/clip_a.mp4",
          type: "video",
          duration: 15,
          width: 1920,
          height: 1080,
          size: 1000,
          isMissing: false,
        },
        {
          id: "asset-2",
          name: "clip_b.mp4",
          path: "/Volumes/OldSSD/Footage/clip_b.mp4",
          type: "video",
          duration: 20,
          width: 1920,
          height: 1080,
          size: 2000,
          isMissing: false,
        },
      ],
      isDirty: false,
    });

    useTimelineStore.setState({
      tracks: mockTracks,
      clips: [
        {
          id: "clip-1",
          trackId: "track-1",
          mediaId: "asset-1",
          startTime: 0,
          duration: 12,
          trimIn: 0,
          trimOut: 12,
          kind: "video",
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        },
      ],
    });
  });

  it("checkMissingMedia identifies missing files and sets isMissing: true", async () => {
    // Simulate /Volumes/OldSSD is disconnected
    mockFileExists.mockImplementation(async (path: string) => {
      if (path.includes("clip_a.mp4")) return false;
      if (path.includes("clip_b.mp4")) return true;
      return false;
    });

    const missingIds = await useProjectStore.getState().checkMissingMedia();

    expect(missingIds).toEqual(["asset-1"]);
    const assets = useProjectStore.getState().mediaAssets;
    expect(assets[0].isMissing).toBe(true);
    expect(assets[1].isMissing).toBe(false);
  });

  it("relinkMediaAsset updates target asset metadata and clears isMissing", async () => {
    // Target asset was missing
    useProjectStore.setState((s) => ({
      mediaAssets: s.mediaAssets.map((a) => (a.id === "asset-1" ? { ...a, isMissing: true } : a)),
    }));

    mockGetMediaMetadata.mockResolvedValueOnce({
      duration: 18,
      width: 3840,
      height: 2160,
      fps: 30,
      size: 9000,
    });

    const result = await useProjectStore.getState().relinkMediaAsset(
      "asset-1",
      "/Users/dev/Videos/NewFolder/clip_a_renamed.mp4",
    );

    expect(result.success).toBe(true);
    const updated = useProjectStore.getState().mediaAssets.find((a) => a.id === "asset-1");
    expect(updated?.path).toBe("/Users/dev/Videos/NewFolder/clip_a_renamed.mp4");
    expect(updated?.name).toBe("clip_a_renamed.mp4");
    expect(updated?.duration).toBe(18);
    expect(updated?.width).toBe(3840);
    expect(updated?.height).toBe(2160);
    expect(updated?.isMissing).toBe(false);
  });

  it("relinkMediaAsset clamps timeline clips if new media duration is shorter than clip trimOut", async () => {
    // Clip-1 currently has trimOut: 12, duration: 12
    // New media file is only 8 seconds long
    mockGetMediaMetadata.mockResolvedValueOnce({
      duration: 8,
      width: 1920,
      height: 1080,
      fps: 30,
      size: 3000,
    });

    await useProjectStore.getState().relinkMediaAsset(
      "asset-1",
      "/Users/dev/Videos/clip_short.mp4",
    );

    const timelineClips = useTimelineStore.getState().clips;
    const clip1 = timelineClips.find((c) => c.id === "clip-1");
    expect(clip1?.trimOut).toBe(8);
    expect(clip1?.duration).toBe(8);
  });

  it("relinkMediaAsset automatically checks and relinks missing sibling files in the same directory", async () => {
    // Both asset-1 and asset-2 are missing
    useProjectStore.setState((s) => ({
      mediaAssets: s.mediaAssets.map((a) => ({ ...a, isMissing: true })),
    }));

    // Sibling file clip_b.mp4 exists in the new directory
    mockFileExists.mockImplementation(async (path: string) => {
      if (path === "/Users/dev/Videos/NewFolder/clip_b.mp4") return true;
      return true;
    });

    const result = await useProjectStore.getState().relinkMediaAsset(
      "asset-1",
      "/Users/dev/Videos/NewFolder/clip_a.mp4",
    );

    expect(result.success).toBe(true);
    expect(result.relinkedOtherCount).toBe(1);

    const asset2 = useProjectStore.getState().mediaAssets.find((a) => a.id === "asset-2");
    expect(asset2?.path).toBe("/Users/dev/Videos/NewFolder/clip_b.mp4");
    expect(asset2?.isMissing).toBe(false);
  });

  it("promptRelinkMedia invokes file picker and relinks selected file", async () => {
    mockOpenFileDialog.mockResolvedValueOnce([
      { path: "/Users/dev/Desktop/clip_a_relocated.mp4", name: "clip_a_relocated.mp4", size: 1234 },
    ]);

    const success = await useProjectStore.getState().promptRelinkMedia("asset-1");

    expect(mockOpenFileDialog).toHaveBeenCalledTimes(1);
    expect(success).toBe(true);

    const asset1 = useProjectStore.getState().mediaAssets.find((a) => a.id === "asset-1");
    expect(asset1?.path).toBe("/Users/dev/Desktop/clip_a_relocated.mp4");
    expect(asset1?.isMissing).toBe(false);
  });
});
