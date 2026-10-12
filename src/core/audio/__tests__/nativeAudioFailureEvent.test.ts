import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { toast } from "@/lib/toast";
import { PlaybackClock } from "@/core/playback/PlaybackClock";
import { NativeAudioPreviewController } from "../nativeAudioPreviewController";
import type { NativeAudioPreviewSource } from "../nativeAudioPreviewController";

let registeredListener: ((event: { payload: any }) => void) | null = null;
let syncTimelineCalled = false;
let listenerRegisteredBeforeSync = false;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, handler: (event: any) => void) => {
    if (eventName === "clypra://native-audio-clip-failed") {
      registeredListener = handler;
      if (!syncTimelineCalled) {
        listenerRegisteredBeforeSync = true;
      }
    }
    return () => {
      registeredListener = null;
    };
  }),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
  configureNativePlayback: vi.fn().mockResolvedValue(undefined),
  getNativeAudioStatus: vi.fn().mockResolvedValue(null),
  getNativeAudioDiagnostics: vi.fn().mockResolvedValue(null),
  nativePauseFromAudio: vi.fn().mockResolvedValue(undefined),
  nativePlayFromAudio: vi.fn().mockResolvedValue(undefined),
  nativeSeekFromAudio: vi.fn().mockResolvedValue(undefined),
  nativeTickFromAudio: vi.fn().mockResolvedValue(undefined),
  pauseNativeAudio: vi.fn().mockResolvedValue(undefined),
  seekNativeAudio: vi.fn().mockResolvedValue(undefined),
  setNativeAudioOutput: vi.fn().mockResolvedValue(undefined),
  setNativeAudioSpeed: vi.fn().mockResolvedValue(undefined),
  stopNativeAudio: vi.fn().mockResolvedValue(undefined),
  updateNativeAudioClipParameters: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../nativeAudioTimeline", () => ({
  buildNativeAudioTimeline: vi.fn().mockReturnValue({ clips: [] }),
  syncNativeAudioTimeline: vi.fn(async () => {
    syncTimelineCalled = true;
    return {
      snapshot: { clips: [] },
      installedCount: 0,
    };
  }),
}));

describe("Native Audio Failure Event & Deduplication Path (P0 Gate AUD-05)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredListener = null;
    syncTimelineCalled = false;
    listenerRegisteredBeforeSync = false;
    vi.spyOn(toast, "warning").mockImplementation(() => "" as any);
    vi.spyOn(toast, "error").mockImplementation(() => "" as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the failure event listener before timeline synchronization and handles cap exceeded events", async () => {
    const clock = new PlaybackClock();
    const source: NativeAudioPreviewSource = {
      projectRevision: "rev-1",
      frameRate: 30,
      duration: 10,
      audioTrackCount: 1,
      clips: [],
      tracks: [],
      assets: [],
    };

    const controller = new NativeAudioPreviewController({ clock, source });
    await controller.initialize();

    // Verify listener registration happened BEFORE syncNativeAudioTimeline ran
    expect(listenerRegisteredBeforeSync).toBe(true);
    expect(registeredListener).toBeDefined();

    // 1. First event emission with cap exceeded
    registeredListener!({
      payload: {
        clipId: "clip-large-1",
        path: "/media/giant-podcast.wav",
        error: "PCM size 268435456 bytes exceeds 256 MiB limit",
        isCapExceeded: true,
      },
    });

    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("audio.clip_exceeds_memory_limit");

    // 2. Second event emission with SAME clipId (deduplicated against toast spam)
    registeredListener!({
      payload: {
        clipId: "clip-large-1",
        path: "/media/giant-podcast.wav",
        error: "PCM size 268435456 bytes exceeds 256 MiB limit",
        isCapExceeded: true,
      },
    });

    // Count must remain 1
    expect(toast.warning).toHaveBeenCalledTimes(1);

    // 3. Different clipId triggers a new warning toast
    registeredListener!({
      payload: {
        clipId: "clip-large-2",
        path: "/media/another-huge-track.wav",
        error: "PCM size 300000000 bytes exceeds 256 MiB limit",
        isCapExceeded: true,
      },
    });

    expect(toast.warning).toHaveBeenCalledTimes(2);

    // 4. Decode failure (isCapExceeded = false) triggers error toast with interpolation
    registeredListener!({
      payload: {
        clipId: "clip-corrupted",
        path: "/media/corrupted.wav",
        error: "Invalid WAV header",
        isCapExceeded: false,
      },
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("audio.clip_decode_failed", {
      interpolation: { error: "Invalid WAV header" },
    });

    controller.dispose();
  });
});
