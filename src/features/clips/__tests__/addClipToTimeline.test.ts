import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DiskFullError,
  DownloadAbortedError,
  HashMismatchError,
  type ClipItem,
} from "../types";

const mockPlatform = vi.hoisted(() => ({
  getMediaMetadata: vi.fn(),
}));

const mockPlaybackClock = vi.hoisted(() => ({
  currentTime: 12.5,
}));

vi.mock("@/core/platform", () => ({
  platform: mockPlatform,
}));

vi.mock("@/hooks/usePlaybackClock", () => ({
  getPlaybackClock: () => mockPlaybackClock,
}));

vi.mock("@/i18n", () => ({
  i18n: { t: (key: string) => key },
}));

import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { getClipAudioProperties } from "@/types/audio";
import { useClipDownloadStore } from "../store/clipDownloadStore";
import {
  addClipToTimeline,
  REACTION_CLIP_DEFAULT_GAIN_DB,
} from "../actions/addClipToTimeline";

function makeClip(id = "clip-1"): ClipItem {
  return {
    id,
    title: "Shocked Face",
    category: "shocked",
    tags: ["wow"],
    durationSec: 3.5,
    width: 1280,
    height: 720,
    posterUrl: "https://cdn.example.com/shocked.webp",
    previewUrl: "https://cdn.example.com/shocked-preview.mp4",
    fileUrl: "https://cdn.example.com/shocked.mp4",
    sha256: "c".repeat(64),
    bytes: 4096,
    hasAudio: true,
    hasAlpha: false,
    license: {
      spdx: "CC0-1.0",
      author: "Creator",
      sourceUrl: "https://example.com",
      releaseOnFile: true,
    },
  };
}

describe("addClipToTimeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPlaybackClock.currentTime = 12.5;
    mockPlatform.getMediaMetadata.mockResolvedValue({
      duration: 3.5,
      width: 1280,
      height: 720,
      fps: 30,
      hasAudio: true,
      codec: "h264",
    });

    useHistoryStore.getState().clear();
    useTimelineStore.setState({
      tracks: [
        {
          id: "main-v1",
          type: "video",
          name: "Video 1",
          muted: false,
          locked: false,
          visible: true,
          height: 64,
        },
      ],
      clips: [],
      mainVideoTrackId: "main-v1",
      epoch: 1,
    });
    useProjectStore.setState({
      project: {
        id: "proj-1",
        name: "Test Project",
        canvasWidth: 1920,
        canvasHeight: 1080,
      } as any,
      mediaAssets: [],
      showToast: vi.fn(),
    } as any);
    useClipDownloadStore.setState({ downloads: {} });
  });

  it("downloads, imports asset, places PiP clip on new overlay track in one undo step, and undo removes both", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockResolvedValue(
      "/cache/clips/shocked.mp4",
    );

    const res = await addClipToTimeline(makeClip());
    expect(res.success).toBe(true);
    expect(res.trackId).toBeTruthy();
    expect(res.clipId).toBeTruthy();

    // Asset imported
    const assets = useProjectStore.getState().mediaAssets;
    expect(assets).toHaveLength(1);
    expect(assets[0].path).toBe("/cache/clips/shocked.mp4");
    expect(assets[0].type).toBe("video");

    // New track + clip created
    const timeline = useTimelineStore.getState();
    expect(timeline.tracks).toHaveLength(2);
    expect(timeline.clips).toHaveLength(1);

    const placed = timeline.clips[0];
    expect(placed.trackId).toBe(res.trackId);
    expect(placed.startTime).toBe(12.5);
    expect(placed.volume).toBeUndefined();
    expect(getClipAudioProperties(placed).gainDb).toBeCloseTo(
      REACTION_CLIP_DEFAULT_GAIN_DB,
      1,
    );
    // 1920*0.4 = 768 width, 768/(16/9) = 432 height; bottom-right with 5% margin (96, 54)
    expect(placed.width).toBe(768);
    expect(placed.height).toBe(432);
    expect(placed.x).toBe(1920 - 768 - 96);
    expect(placed.y).toBe(1080 - 432 - 54);

    // Exactly ONE undo step removes both track and clip
    expect(useHistoryStore.getState().state.canUndo).toBe(true);
    useHistoryStore.getState().undo();

    const afterUndo = useTimelineStore.getState();
    expect(afterUndo.tracks).toHaveLength(1);
    expect(afterUndo.clips).toHaveLength(0);
    expect(useHistoryStore.getState().state.canUndo).toBe(false);
  });

  it("leaves timeline and project untouched on HashMismatchError", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockRejectedValue(
      new HashMismatchError("clip-1"),
    );

    const res = await addClipToTimeline(makeClip());
    expect(res.success).toBe(false);
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(useProjectStore.getState().mediaAssets).toHaveLength(0);
    expect(useProjectStore.getState().showToast).toHaveBeenCalledWith(
      "clips.error.hashMismatch",
      "error",
    );
  });

  it("leaves timeline untouched on DiskFullError", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockRejectedValue(
      new DiskFullError("clip-1"),
    );

    const res = await addClipToTimeline(makeClip());
    expect(res.success).toBe(false);
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(useProjectStore.getState().showToast).toHaveBeenCalledWith(
      "clips.error.diskFull",
      "error",
    );
  });

  it("aborts cleanly when timeline epoch changes mid-download", async () => {
    const cancelSpy = vi.spyOn(
      useClipDownloadStore.getState(),
      "cancelDownload",
    );
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockImplementation(
      async () => {
        // Simulate project/timeline mutation mid-download
        useTimelineStore.setState({ epoch: 99 });
        return "/cache/clips/shocked.mp4";
      },
    );

    const res = await addClipToTimeline(makeClip());
    expect(res.success).toBe(false);
    expect(res.cancelled).toBe(true);
    expect(cancelSpy).toHaveBeenCalledWith("clip-1");
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
    expect(useTimelineStore.getState().clips).toHaveLength(0);
    expect(useProjectStore.getState().mediaAssets).toHaveLength(0);
  });

  it("handles user cancellation silently without toast error", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockRejectedValue(
      new DownloadAbortedError("clip-1"),
    );

    const res = await addClipToTimeline(makeClip());
    expect(res.success).toBe(false);
    expect(res.cancelled).toBe(true);
    expect(useProjectStore.getState().showToast).not.toHaveBeenCalled();
  });

  it("rolls back transaction if media probe fails", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockResolvedValue(
      "/cache/clips/corrupt.mp4",
    );
    mockPlatform.getMediaMetadata.mockRejectedValue(new Error("Probe failed"));

    const res = await addClipToTimeline(makeClip());
    expect(res.success).toBe(false);
    expect(useTimelineStore.getState().tracks).toHaveLength(1);
    expect(useTimelineStore.getState().clips).toHaveLength(0);
  });
});
