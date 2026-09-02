import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  createAudioPlaybackAdapter,
  NativeAudioPlaybackAdapter,
  WebAudioPlaybackAdapter,
  type AudioPlaybackSource,
} from "../AudioPlaybackAdapter";

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: vi.fn(() => false),
  getNativeAudioDiagnostics: vi.fn().mockResolvedValue({
    status: {
      callbackCount: 120,
      renderedFrames: 2400,
      nonSilentFrames: 2000,
      mixerLockMisses: 0,
      callbackTimeUs: 50,
      callbackMaxTimeUs: 120,
      callbackOverBudgetCount: 0,
      lastError: null,
    },
  }),
  configureNativePlayback: vi.fn().mockResolvedValue(undefined),
  stopNativeAudio: vi.fn().mockResolvedValue(undefined),
  pauseNativeAudio: vi.fn().mockResolvedValue(undefined),
  seekNativeAudio: vi.fn().mockResolvedValue(undefined),
  setNativeAudioOutput: vi.fn().mockResolvedValue(undefined),
  getNativeAudioStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../audioRuntime", () => ({
  getSharedAudioEngine: vi.fn(() => ({
    syncPlayback: vi.fn(),
    stopAllVoices: vi.fn(),
    bufferPool: { getStats: () => ({ usedBytes: 1024 * 1024 }) },
    takeTelemetrySnapshot: vi.fn(() => ({
      activeVoiceCount: 2,
      windowDurationMs: 5000,
      syncCalls: 100,
      playingSyncCalls: 100,
      syncTimeUs: 50,
      syncMaxTimeUs: 100,
      bufferHits: 10,
      bufferMisses: 0,
      bufferHitRatio: 1,
      stageTimings: { mixerUs: 50, bufferWaitUs: 0, totalTimeUs: 50 },
    })),
  })),
  resumeSharedAudioEngine: vi.fn().mockResolvedValue(undefined),
  stopSharedAudioEngine: vi.fn(),
}));

describe("AudioPlaybackAdapter", () => {
  const mockSource: AudioPlaybackSource = {
    projectRevision: "p1:1",
    frameRate: 30,
    duration: 10,
    audioTrackCount: 2,
    clips: [],
    tracks: [],
    assets: [],
  };

  test("factory creates WebAudioPlaybackAdapter in non-Tauri environment", () => {
    const adapter = createAudioPlaybackAdapter({ forceKind: "web-audio" });
    expect(adapter).toBeInstanceOf(WebAudioPlaybackAdapter);
    expect(adapter.kind).toBe("web-audio");
  });

  test("factory creates NativeAudioPlaybackAdapter when forced or in Tauri", () => {
    const adapter = createAudioPlaybackAdapter({ forceKind: "native" });
    expect(adapter).toBeInstanceOf(NativeAudioPlaybackAdapter);
    expect(adapter.kind).toBe("native");
  });

  describe("WebAudioPlaybackAdapter", () => {
    test("lifecycle and diagnostics", async () => {
      const adapter = new WebAudioPlaybackAdapter();
      expect(adapter.isActive).toBe(false);

      await adapter.initialize(mockSource);
      expect(adapter.isActive).toBe(true);

      adapter.setOutput(80, false);
      const diag = await adapter.getDiagnostics();
      expect(diag).toEqual({
        kind: "web-audio",
        activeVoices: 2,
        bufferPoolUsageBytes: 1024 * 1024,
        lastError: null,
      });

      await adapter.resume();
      adapter.stop();
      await adapter.dispose();
      expect(adapter.isActive).toBe(false);
    });
  });

  describe("NativeAudioPlaybackAdapter", () => {
    test("lifecycle and initialization", async () => {
      const adapter = new NativeAudioPlaybackAdapter();
      expect(adapter.isActive).toBe(false);

      adapter.updateSource(mockSource);
      adapter.setOutput(100, true);

      await adapter.dispose();
      expect(adapter.isActive).toBe(false);
    });
  });
});
