import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { exportVideo, type VideoExportConfig } from "../videoExport";
import type { Project } from "@/types";

// ─── Mocks ──────────────────────────────────────────────────────────────

const { mockPlatform, mockIsTauriRuntime, mockRenderNativeFrame } = vi.hoisted(() => ({
  mockPlatform: {
    isCapacitor: vi.fn(() => false),
    isTauri: vi.fn(() => true),
  },
  mockIsTauriRuntime: vi.fn(() => true),
  mockRenderNativeFrame: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel {
    onmessage: ((msg: any) => void) | null = null;
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
    convertFileSrc: vi.fn((p) => p),
  };
});

const mockInvoke = vi.mocked(invoke);

vi.mock("@/core/platform", () => ({
  platform: {
    isCapacitor: () => mockPlatform.isCapacitor(),
    isTauri: () => mockPlatform.isTauri(),
  },
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
  renderNativeFrame: (...args: any[]) => mockRenderNativeFrame(...args),
}));

vi.mock("../exportPreflight", () => ({
  verifyExportDependencies: vi.fn(async () => ({
    ready: true,
    missingEffects: [],
    missingImageAssets: [],
    missingAudioAssets: [],
  })),
  ExportBlockedError: class extends Error {},
}));

vi.mock("@/core/evaluation/evaluator", () => ({
  evaluateTimelineSceneCached: vi.fn(() => ({
    metadata: {
      canvasWidth: 1920,
      canvasHeight: 1080,
    },
    clips: [],
  })),
  clearEvaluationCache: vi.fn(),
}));

vi.mock("@/core/resources/ResourceCache", () => ({
  getResourceCache: vi.fn(() => ({
    clear: vi.fn(),
  })),
}));

vi.mock("@/core/timeline/audioClips", () => ({
  getActiveAudioClips: vi.fn(() => []),
}));

vi.mock("@/components/editor/preview/nativeVideoPreview", () => ({
  buildNativeFrameRequest: vi.fn(() => ({ id: "mock-native-frame-request" })),
}));

vi.mock("@/core/render/nativeRasterBridge", () => {
  class MockNativeRasterBridge {
    rasterize = vi.fn(async () => []);
    rasterizeSmartOverlays = vi.fn(async () => []);
    dispose = vi.fn();
  }
  return {
    NativeRasterBridge: MockNativeRasterBridge,
  };
});

vi.mock("@/services/telemetryCollector", () => ({
  telemetryCollector: {
    recordExportSpan: vi.fn(),
  },
}));

vi.mock("../platform/pathConversion", () => ({
  toNativePath: (p: string) => p,
}));

// ─── Test Fixtures ──────────────────────────────────────────────────────

const testProject: Project = {
  id: "test-proj-video-export",
  name: "Video Export Test",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  aspectRatio: "16:9",
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameRate: 30,
  duration: 1.0,
};

function createValidConfig(overrides?: Partial<VideoExportConfig>): VideoExportConfig {
  return {
    clips: [],
    tracks: [],
    transitions: [],
    assets: [],
    project: testProject,
    epoch: 1,
    startTime: 0,
    endTime: 0.1, // 3 frames at 30 fps
    outputPath: "/output/test_movie.mp4",
    width: 1920,
    height: 1080,
    frameRate: 30,
    ...overrides,
  };
}

describe("videoExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.isCapacitor.mockReturnValue(false);
    mockIsTauriRuntime.mockReturnValue(true);

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_video_export") {
        return "session-test-456";
      }
      if (cmd === "write_export_frames_batch") {
        return;
      }
      if (cmd === "finalize_video_export") {
        return;
      }
      if (cmd === "cancel_video_export") {
        return;
      }
      return null;
    });

    // Dummy frame buffer: 1920 * 1080 * 4 bytes
    mockRenderNativeFrame.mockImplementation(async () => {
      return new Uint8Array(1920 * 1080 * 4).buffer;
    });
  });

  it("throws if executed in Capacitor runtime", async () => {
    mockPlatform.isCapacitor.mockReturnValue(true);
    await expect(exportVideo(createValidConfig())).rejects.toThrow(
      "Native video export is not available in the Capacitor runtime"
    );
  });

  it("throws if executed outside Tauri runtime", async () => {
    mockIsTauriRuntime.mockReturnValue(false);
    await expect(exportVideo(createValidConfig())).rejects.toThrow(
      "Native video export requires the desktop runtime"
    );
  });

  it("rejects when duration is 0 (totalFrames === 0)", async () => {
    await expect(
      exportVideo(createValidConfig({ startTime: 1.0, endTime: 1.0 }))
    ).rejects.toThrow("No frames to export");
  });

  it("rejects invalid dimensions (zero or oversized)", async () => {
    await expect(
      exportVideo(createValidConfig({ width: 0 }))
    ).rejects.toThrow("Invalid export dimensions: 0x1080");

    await expect(
      exportVideo(createValidConfig({ height: 0 }))
    ).rejects.toThrow("Invalid export dimensions: 1920x0");

    await expect(
      exportVideo(createValidConfig({ width: 9000, height: 1080 }))
    ).rejects.toThrow("Invalid export dimensions: 9000x1080");
  });

  it("rejects invalid frame rates (<= 0, NaN, > 240)", async () => {
    await expect(
      exportVideo(createValidConfig({ frameRate: 0 }))
    ).rejects.toThrow("Invalid export frame rate: 0");

    await expect(
      exportVideo(createValidConfig({ frameRate: -30 }))
    ).rejects.toThrow("Invalid export frame rate: -30");

    await expect(
      exportVideo(createValidConfig({ frameRate: 300 }))
    ).rejects.toThrow("Invalid export frame rate: 300");
  });

  it("completes happy path: starts session, writes batches, and finalizes", async () => {
    const config = createValidConfig({
      startTime: 0,
      endTime: 0.1, // 3 frames
    });

    const result = await exportVideo(config);

    expect(result.cancelled).toBe(false);
    expect(result.outputPath).toBe("/output/test_movie.mp4");
    expect(result.totalFrames).toBe(3);

    // Verify session started
    expect(mockInvoke).toHaveBeenCalledWith(
      "start_video_export",
      expect.objectContaining({
        config: expect.objectContaining({
          outputPath: "/output/test_movie.mp4",
          width: 1920,
          height: 1080,
          totalFrames: 3,
          frameRate: 30,
        }),
      })
    );

    // Verify batch write
    expect(mockInvoke).toHaveBeenCalledWith(
      "write_export_frames_batch",
      expect.any(Uint8Array),
      expect.objectContaining({
        headers: {
          "session-id": "session-test-456",
          "frame-count": "3",
        },
      })
    );

    // Verify finalize
    expect(mockInvoke).toHaveBeenCalledWith("finalize_video_export", {
      sessionId: "session-test-456",
    });
  });

  it("handles cancellation via AbortSignal", async () => {
    const abortController = new AbortController();
    abortController.abort(); // Pre-aborted

    const config = createValidConfig({
      signal: abortController.signal,
    });

    const result = await exportVideo(config);
    expect(result.cancelled).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("cancel_video_export", {
      sessionId: "session-test-456",
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("finalize_video_export", expect.anything());
  });

  it("handles cancellation via onSessionReady performCancel callback", async () => {
    let cancelHandler: (() => Promise<void>) | null = null;

    const config = createValidConfig({
      startTime: 0,
      endTime: 0.5, // 15 frames
      onSessionReady: (cancelFn) => {
        cancelHandler = cancelFn;
      },
    });

    mockRenderNativeFrame.mockImplementation(async () => {
      // Trigger cancel on second frame
      if (cancelHandler) {
        await cancelHandler();
      }
      return new Uint8Array(1920 * 1080 * 4).buffer;
    });

    const result = await exportVideo(config);
    expect(result.cancelled).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("cancel_video_export", {
      sessionId: "session-test-456",
    });
  });

  it("properly cleans up and rethrows error if frame rendering fails", async () => {
    mockRenderNativeFrame.mockRejectedValueOnce(new Error("GPU device lost during rendering"));

    const config = createValidConfig();

    await expect(exportVideo(config)).rejects.toThrow("GPU device lost during rendering");

    // Verify cancel was invoked on unexpected failure
    expect(mockInvoke).toHaveBeenCalledWith("cancel_video_export", {
      sessionId: "session-test-456",
    });
    expect(mockInvoke).not.toHaveBeenCalledWith("finalize_video_export", expect.anything());
  });
});
