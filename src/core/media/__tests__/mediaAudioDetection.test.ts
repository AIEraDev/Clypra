import { describe, expect, it } from "vitest";
import type { Clip, MediaAsset } from "@/types";
import { assetHasAudio, clipHasAudio } from "../mediaAudioDetection";

describe("assetHasAudio", () => {
  it("returns false for null or undefined assets", () => {
    expect(assetHasAudio(null)).toBe(false);
    expect(assetHasAudio(undefined)).toBe(false);
  });

  it("returns true for standalone audio assets", () => {
    const audioAsset: MediaAsset = {
      id: "a-1",
      name: "voice.mp3",
      path: "/audio/voice.mp3",
      type: "audio",
      duration: 10,
      size: 1024,
    };
    expect(assetHasAudio(audioAsset)).toBe(true);
  });

  it("returns false for image assets", () => {
    const imageAsset: MediaAsset = {
      id: "i-1",
      name: "cover.png",
      path: "/images/cover.png",
      type: "image",
      duration: 5,
      size: 2048,
    };
    expect(assetHasAudio(imageAsset)).toBe(false);
  });

  it("returns true for video assets with an audio stream in streams", () => {
    const videoWithAudio: MediaAsset = {
      id: "v-1",
      name: "talking_head.mp4",
      path: "/video/talking_head.mp4",
      type: "video",
      duration: 30,
      size: 10240,
      streams: [
        { index: 0, type: "video", codec: "h264" },
        {
          index: 1,
          type: "audio",
          codec: "aac",
          channels: 2,
          sampleRate: 48000,
        },
      ],
    };
    expect(assetHasAudio(videoWithAudio)).toBe(true);
  });

  it("returns false for video assets explicitly probed with NO audio stream", () => {
    const videoWithoutAudio: MediaAsset = {
      id: "v-2",
      name: "silent_animation.mp4",
      path: "/video/silent_animation.mp4",
      type: "video",
      duration: 15,
      size: 5120,
      streams: [{ index: 0, type: "video", codec: "hevc" }],
    };
    expect(assetHasAudio(videoWithoutAudio)).toBe(false);
  });

  it("returns false for video assets with empty streams array", () => {
    const videoEmptyStreams: MediaAsset = {
      id: "v-3",
      name: "empty.mp4",
      path: "/video/empty.mp4",
      type: "video",
      duration: 15,
      size: 5120,
      streams: [],
    };
    expect(assetHasAudio(videoEmptyStreams)).toBe(false);
  });

  it("returns false for unprobed video assets (wait for probe to complete)", () => {
    const unprobedVideo: MediaAsset = {
      id: "v-4",
      name: "unprobed.mp4",
      path: "/video/unprobed.mp4",
      type: "video",
      duration: 20,
      size: 8192,
      // streams is undefined - probe not complete yet
    };
    // Changed behavior: return false until probe completes
    // This prevents race condition where audio is claimed before verification
    expect(assetHasAudio(unprobedVideo)).toBe(false);
  });
});

describe("Bug Fix — Audio Race Condition (2025-01-26)", () => {
  /**
   * Root cause: Two race conditions caused "no sound on first play"
   * 1. Stream metadata race: asset.streams === undefined before probe
   * 2. Path hydration race: asset.path === "" before DB lookup
   *
   * Evidence from session trace:
   * - First call: count=0 (path empty, filtered out)
   * - Second call: count=1 (57ms later, path populated)
   *
   * Fix: Require BOTH asset.streams AND asset.path before claiming audio exists
   */

  it("returns false for video with streams but empty path (path hydration race)", () => {
    const videoStreamsProbedButPathEmpty: MediaAsset = {
      id: "v-race-1",
      name: "20260927_103036.mp4",
      path: "", // ← Path not yet hydrated from database
      type: "video",
      duration: 1.828,
      size: 8388608,
      streams: [
        { index: 0, type: "video", codec: "h264" },
        {
          index: 1,
          type: "audio",
          codec: "aac",
          channels: 2,
          sampleRate: 44100,
        },
      ],
    };
    // Must return false — path needed for Rust decode
    expect(assetHasAudio(videoStreamsProbedButPathEmpty)).toBe(false);
  });

  it("returns false for video with path but no streams (stream metadata race)", () => {
    const videoPathHydratedButNotProbed: MediaAsset = {
      id: "v-race-2",
      name: "screen_recording.mp4",
      path: "/Users/AIEraDev/Movies/screen_recording.mp4",
      type: "video",
      duration: 5.0,
      size: 2097152,
      // streams: undefined ← Probe not complete yet
    };
    // Must return false — streams needed to verify audio exists
    expect(assetHasAudio(videoPathHydratedButNotProbed)).toBe(false);
  });

  it("returns true only when BOTH streams and path are available", () => {
    const videoFullyReady: MediaAsset = {
      id: "v-ready",
      name: "talking_head.mp4",
      path: "/Users/AIEraDev/Movies/talking_head.mp4",
      type: "video",
      duration: 10.5,
      size: 5242880,
      streams: [
        { index: 0, type: "video", codec: "h264" },
        {
          index: 1,
          type: "audio",
          codec: "aac",
          channels: 2,
          sampleRate: 48000,
        },
      ],
    };
    // Both conditions met — safe to claim audio exists
    expect(assetHasAudio(videoFullyReady)).toBe(true);
  });

  it("returns false for video with empty path even if streams indicate audio", () => {
    // Simulates the exact scenario from session trace
    const videoAtImportTime: MediaAsset = {
      id: "asset-123",
      name: "20260927_103036.mp4",
      path: "", // ← Empty at import, populated 57ms later
      type: "video",
      duration: 1.828,
      size: 8388608,
      streams: [
        { index: 0, type: "video", codec: "h264" },
        {
          index: 1,
          type: "audio",
          codec: "aac",
          channels: 2,
          sampleRate: 44100,
        },
      ],
    };

    // At T+0ms: User presses play, path still empty
    expect(assetHasAudio(videoAtImportTime)).toBe(false);

    // At T+57ms: Path populated (simulated)
    videoAtImportTime.path = "/Users/AIEraDev/Movies/20260927_103036.mp4";
    expect(assetHasAudio(videoAtImportTime)).toBe(true);
  });

  it("standalone audio assets still work (regression check)", () => {
    const audioAsset: MediaAsset = {
      id: "a-1",
      name: "music.mp3",
      path: "/audio/music.mp3",
      type: "audio",
      duration: 180,
      size: 4194304,
    };
    // Audio type doesn't require streams check
    expect(assetHasAudio(audioAsset)).toBe(true);
  });

  it("video without audio stream returns false even with path", () => {
    const silentVideo: MediaAsset = {
      id: "v-silent",
      name: "animation.mp4",
      path: "/video/animation.mp4",
      type: "video",
      duration: 5.0,
      size: 1048576,
      streams: [
        { index: 0, type: "video", codec: "h264" },
        // No audio stream
      ],
    };
    // Correctly identified as silent
    expect(assetHasAudio(silentVideo)).toBe(false);
  });
});

describe("clipHasAudio", () => {
  const baseClip: Clip = {
    id: "clip-1",
    trackId: "track-v1",
    mediaId: "asset-1",
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
  };

  it("returns false for non-audio clip kinds (text, sticker, image)", () => {
    expect(clipHasAudio({ ...baseClip, kind: "text" }, null)).toBe(false);
    expect(clipHasAudio({ ...baseClip, kind: "text-template" }, null)).toBe(
      false,
    );
    expect(clipHasAudio({ ...baseClip, kind: "sticker" }, null)).toBe(false);
    expect(clipHasAudio({ ...baseClip, kind: "image" }, null)).toBe(false);
  });

  it("returns true for audio clips", () => {
    expect(clipHasAudio({ ...baseClip, kind: "audio" }, null)).toBe(true);
  });

  it("returns true for video clips backed by an asset with audio", () => {
    const assetWithAudio: MediaAsset = {
      id: "asset-1",
      name: "clip.mp4",
      path: "/clip.mp4",
      type: "video",
      duration: 10,
      size: 1024,
      streams: [
        { index: 0, type: "video", codec: "h264" },
        { index: 1, type: "audio", codec: "aac" },
      ],
    };
    expect(clipHasAudio({ ...baseClip, kind: "video" }, assetWithAudio)).toBe(
      true,
    );
  });

  it("returns false for video clips backed by a silent video asset", () => {
    const silentAsset: MediaAsset = {
      id: "asset-2",
      name: "silent.mp4",
      path: "/silent.mp4",
      type: "video",
      duration: 10,
      size: 1024,
      streams: [{ index: 0, type: "video", codec: "h264" }],
    };
    expect(clipHasAudio({ ...baseClip, kind: "video" }, silentAsset)).toBe(
      false,
    );
  });

  it("returns false for video clips whose audio was already detached", () => {
    const assetWithAudio: MediaAsset = {
      id: "asset-1",
      name: "clip.mp4",
      path: "/clip.mp4",
      type: "video",
      duration: 10,
      size: 1024,
      streams: [{ index: 0, type: "audio", codec: "aac" }],
    };
    const detachedVideoClip: Clip = {
      ...baseClip,
      kind: "video",
      detachedFromClipId: "audio-companion-1",
    };
    expect(clipHasAudio(detachedVideoClip, assetWithAudio)).toBe(false);
  });

  it("returns true if clip has explicit audioPath", () => {
    const clipWithDirectAudio: Clip = {
      ...baseClip,
      kind: "video",
      audioPath: "/audio/direct.wav",
    };
    expect(clipHasAudio(clipWithDirectAudio, null)).toBe(true);
  });
});
