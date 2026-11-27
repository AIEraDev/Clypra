/**
 * Audio integration tests for the Clips tab reaction-clip placement.
 *
 * Key design to test:
 * - `addClipToTimeline` does NOT seed fabricated `asset.streams`.
 *   It calls `addMediaAsset()` without streams, which triggers an eager background
 *   probe via `probeMediaStreams` (Tauri-only). Until that probe resolves and
 *   `updateMediaAsset` is called, `assetHasAudio()` returns `false` (by design,
 *   the race-condition guard). After the probe resolves with real stream data,
 *   the clip is included in the native audio mixer's next poll.
 *
 * - The canonical gain path is `clip.audio.gainDb = -6` →
 *   `getClipAudioProperties` → `evaluateEffectiveAudioState.staticGain ≈ 0.5012`
 *   → `ExportAudioClipConfig.volume` → Rust mixer.
 *   The legacy `clip.volume` field is intentionally NOT set on the placed clip
 *   to avoid two sources of truth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getActiveAudioClips } from "@/core/timeline/audioClips";
import { getClipAudioProperties } from "@/types/audio";
import { useTimelineStore } from "@/store/timelineStore";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { useClipDownloadStore } from "../store/clipDownloadStore";
import {
  addClipToTimeline,
  REACTION_CLIP_DEFAULT_VOLUME,
  REACTION_CLIP_DEFAULT_GAIN_DB,
} from "../actions/addClipToTimeline";
import type { ClipItem } from "../types";

const mockPlatform = vi.hoisted(() => ({
  getMediaMetadata: vi.fn(),
}));

const mockPlaybackClock = vi.hoisted(() => ({
  currentTime: 2.0,
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

/** Real stream data as probeMediaStreams would return it from FFmpeg. */
const REAL_AUDIO_STREAMS = [
  { index: 0, type: "video" as const, codec: "h264", width: 1280, height: 720 },
  { index: 1, type: "audio" as const, codec: "aac", sampleRate: 44100, channels: 2 },
];

/** Real stream data for the base 1440p asset (already probed via MediaTab). */
const BASE_ASSET_STREAMS = [
  { index: 0, type: "video" as const, codec: "h264", width: 2560, height: 1440 },
  { index: 1, type: "audio" as const, codec: "aac", sampleRate: 48000, channels: 2 },
];

function makeAudioReactionClip(): ClipItem {
  return {
    id: "clip-audio-1",
    title: "Applause With Audio",
    category: "applause",
    tags: ["clap"],
    durationSec: 4.0,
    width: 1280,
    height: 720,
    posterUrl: "https://cdn.example.com/applause.webp",
    previewUrl: "https://cdn.example.com/applause-preview.mp4",
    fileUrl: "https://cdn.example.com/applause.mp4",
    sha256: "d".repeat(64),
    bytes: 8192,
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

describe("Reaction clip video-with-audio handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPlatform.getMediaMetadata.mockResolvedValue({
      duration: 4.0,
      width: 1280,
      height: 720,
      fps: 30,
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
      clips: [
        {
          id: "base-clip",
          name: "Base 1440p",
          trackId: "main-v1",
          mediaId: "base-asset",
          startTime: 0,
          duration: 15,
          trimIn: 0,
          trimOut: 15,
          x: 0,
          y: 0,
          width: 2560,
          height: 1440,
          opacity: 1,
          rotation: 0,
          volume: 1.0,
          kind: "video",
        },
      ],
      mainVideoTrackId: "main-v1",
      epoch: 1,
    });
    useProjectStore.setState({
      project: {
        id: "proj-1",
        name: "Audio Test",
        canvasWidth: 2560,
        canvasHeight: 1440,
      } as any,
      mediaAssets: [
        {
          id: "base-asset",
          name: "Base 1440p",
          path: "/media/base.mp4",
          type: "video",
          duration: 15,
          width: 2560,
          height: 1440,
          size: 100000,
          // The base asset was imported via MediaTab and is fully probed.
          streams: BASE_ASSET_STREAMS,
        },
      ],
      showToast: vi.fn(),
    } as any);
    useClipDownloadStore.setState({ downloads: {} });
  });

  it("excludes the overlay clip from the audio mix until the background stream probe completes", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockResolvedValue(
      "/cache/clips/applause.mp4",
    );

    const res = await addClipToTimeline(makeAudioReactionClip());
    expect(res.success).toBe(true);

    const { clips, tracks } = useTimelineStore.getState();
    const { mediaAssets } = useProjectStore.getState();

    // Before the background probe resolves, asset.streams is undefined.
    // assetHasAudio() returns false (by design — race-condition guard).
    // Only the base clip (which has streams) appears in the mix.
    const overlayAsset = mediaAssets.find((a) => a.path === "/cache/clips/applause.mp4");
    expect(overlayAsset?.streams).toBeUndefined();

    const activeAudioBeforeProbe = getActiveAudioClips(clips, tracks, mediaAssets, 0, 15);
    expect(activeAudioBeforeProbe).toHaveLength(1);
    expect(activeAudioBeforeProbe[0]?.clipId).toBe("base-clip");
  });

  it("includes overlay reaction clip audio at ~-6 dB after the background stream probe resolves", async () => {
    vi.spyOn(useClipDownloadStore.getState(), "startDownload").mockResolvedValue(
      "/cache/clips/applause.mp4",
    );

    const res = await addClipToTimeline(makeAudioReactionClip());
    expect(res.success).toBe(true);

    // Simulate the background probeMediaStreams completing with real FFmpeg data.
    // In production, addMediaAsset fires this automatically on the Tauri runtime.
    const { mediaAssets } = useProjectStore.getState();
    const overlayAsset = mediaAssets.find((a) => a.path === "/cache/clips/applause.mp4");
    expect(overlayAsset).toBeDefined();
    useProjectStore.getState().updateMediaAsset(overlayAsset!.id, {
      streams: REAL_AUDIO_STREAMS,
    });

    const { clips, tracks } = useTimelineStore.getState();
    const { mediaAssets: assetsAfterProbe } = useProjectStore.getState();

    // After probe: both clips appear in the mix.
    const activeAudio = getActiveAudioClips(clips, tracks, assetsAfterProbe, 0, 15);
    expect(activeAudio).toHaveLength(2);

    const overlayAudio = activeAudio.find((a) => a.clipId === res.clipId);
    expect(overlayAudio).toBeDefined();
    expect(overlayAudio?.path).toBe("/cache/clips/applause.mp4");
    expect(overlayAudio?.startTime).toBe(2.0);
    expect(overlayAudio?.duration).toBe(4.0);
    // getActiveAudioClips derives volume from clip.audio.gainDb via
    // evaluateEffectiveAudioState.staticGain = dbToLinearGain(-6) ≈ 0.5012
    expect(overlayAudio?.volume).toBeCloseTo(REACTION_CLIP_DEFAULT_VOLUME, 4);

    const placedClip = clips.find((c) => c.id === res.clipId)!;
    const props = getClipAudioProperties(placedClip);
    // Canonical gain is stored as gainDb; volume field is NOT set on the clip
    // to prevent two sources of truth.
    expect(props.gainDb).toBeCloseTo(REACTION_CLIP_DEFAULT_GAIN_DB, 1);
    expect(props.muted).toBe(false);
  });
});
