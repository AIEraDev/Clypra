/**
 * Export Output Resolution Tests
 *
 * Verifies that exportVideo, exportSequence, and exportFrame correctly pass
 * arbitrary output dimensions (e.g. 4K, 720p, portrait) to the native
 * compositor WITHOUT requiring a match against the project canvas size.
 *
 * Architecture under test:
 *   - buildNativeFrameRequest receives (outputWidth, outputHeight) independently
 *     from (canvasWidth, canvasHeight) in the project snapshot.
 *   - to_video_project_request() on the Rust side applies
 *       scale_x = outputW / canvasW,  scale_y = outputH / canvasH
 *     to every layer before the GPU compositor renders natively at output size.
 *   - FrameRequest::validate() enforces: non-zero, ≤ 8192 — no equality constraint.
 *
 * Before the fix all three callers contained a dimension-equality guard that
 * short-circuited to null / threw before buildNativeFrameRequest was ever
 * called.  These tests prove that guard is gone in every entry point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "@/types";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────
// vi.hoisted() ensures these run before any module is evaluated.

const {
  mockIsTauriRuntime,
  mockRenderNativeFrame,
  mockBuildNativeFrameRequest,
  mockEvaluateScene,
} = vi.hoisted(() => ({
  mockIsTauriRuntime: vi.fn(() => true),
  mockRenderNativeFrame: vi.fn(),
  mockBuildNativeFrameRequest: vi.fn(),
  mockEvaluateScene: vi.fn(),
}));

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => {
  class MockChannel {
    onmessage: ((msg: unknown) => void) | null = null;
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
    convertFileSrc: vi.fn((p: string) => p),
  };
});

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => mockIsTauriRuntime(),
  renderNativeFrame: (...args: unknown[]) => mockRenderNativeFrame(...args),
}));

vi.mock("@/components/editor/preview/nativeVideoPreview", () => ({
  buildNativeFrameRequest: (...args: unknown[]) =>
    mockBuildNativeFrameRequest(...args),
}));

vi.mock("@/core/evaluation/evaluator", () => ({
  evaluateTimelineSceneCached: (...args: unknown[]) =>
    mockEvaluateScene(...args),
  clearEvaluationCache: vi.fn(),
}));

vi.mock("@/core/resources/ResourceCache", () => ({
  getResourceCache: vi.fn(() => ({ clear: vi.fn() })),
}));

vi.mock("@/core/timeline/audioClips", () => ({
  getActiveAudioClips: vi.fn(() => []),
}));

vi.mock("@/core/render/nativeRasterBridge", () => {
  class MockNativeRasterBridge {
    rasterize = vi.fn(async () => []);
    rasterizeSmartOverlays = vi.fn(async () => []);
    dispose = vi.fn();
  }
  return { NativeRasterBridge: MockNativeRasterBridge };
});

vi.mock("../exportPreflight", () => ({
  verifyExportDependencies: vi.fn(async () => ({
    ready: true,
    missingEffects: [],
    missingImageAssets: [],
    missingAudioAssets: [],
  })),
  ExportBlockedError: class extends Error {},
}));

vi.mock("@/core/platform", () => ({
  platform: { isCapacitor: () => false, isTauri: () => true },
}));

vi.mock("@/services/telemetryCollector", () => ({
  telemetryCollector: { recordExportSpan: vi.fn() },
}));

vi.mock("../platform/pathConversion", () => ({
  toNativePath: (p: string) => p,
}));

// ─── Shared fixtures ─────────────────────────────────────────────────────────

/** A project whose canvas is 1920×1080 — the most common canvas size. */
const CANVAS_1080P = { canvasWidth: 1920, canvasHeight: 1080 };

/**
 * A project whose canvas is 1080×1920 — portrait / Reels / Shorts.
 * Used to verify that a portrait canvas can be exported at a portrait 4K
 * output resolution (2160×3840) without being blocked.
 */
const CANVAS_PORTRAIT = { canvasWidth: 1080, canvasHeight: 1920 };

/** A project whose canvas is 1080×1080 — square / Instagram. */
const CANVAS_SQUARE = { canvasWidth: 1080, canvasHeight: 1080 };

function makeProject(canvas = CANVAS_1080P): Project {
  return {
    id: "proj-resolution-test",
    name: "Resolution Test Project",
    canvasWidth: canvas.canvasWidth,
    canvasHeight: canvas.canvasHeight,
    frameRate: 30,
    duration: 10,
    aspectRatio: "16:9",
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Returns a mock EvaluatedScene with configurable canvas metadata. */
function makeScene(canvas = CANVAS_1080P) {
  return {
    metadata: {
      canvasWidth: canvas.canvasWidth,
      canvasHeight: canvas.canvasHeight,
    },
    visualLayers: [],
    transitions: [],
    clips: [],
  };
}

/**
 * The mock native frame request object returned by buildNativeFrameRequest.
 * Its exact shape does not matter for these tests — what matters is that it
 * is truthy so the export loops proceed to renderNativeFrame.
 */
const MOCK_FRAME_REQUEST = { id: "mock-native-frame-request" };

/**
 * Build an RGBA ArrayBuffer of the given pixel dimensions.
 * Each pixel is fully opaque red (255, 0, 0, 255).
 */
function makeRgbaBuffer(w: number, h: number): ArrayBuffer {
  const buf = new Uint8Array(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 255; // R
    buf[i + 3] = 255; // A
  }
  return buf.buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
//  1. exportVideo — output resolution decoupled from canvas
// ─────────────────────────────────────────────────────────────────────────────

describe("exportVideo — output resolution", () => {
  const mockInvoke = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();

    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "start_video_export") return "sess-001";
      if (cmd === "write_export_frames_batch") return;
      if (cmd === "finalize_video_export") return;
      if (cmd === "cancel_video_export") return;
    });

    mockBuildNativeFrameRequest.mockReturnValue(MOCK_FRAME_REQUEST);
    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_1080P));
  });

  /**
   * Core regression: 4K export of a 1080p project.
   * Before the fix this threw "Frame 0 is outside the native compositor contract"
   * because 3840 !== 1920 and 2160 !== 1080.
   */
  it("exports 4K (3840×2160) from a 1080p canvas without throwing", async () => {
    const { exportVideo } = await import("../videoExport");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    const result = await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30, // 1 frame
      outputPath: "/out/4k.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);
    expect(result.totalFrames).toBe(1);
  });

  it("passes the requested output dimensions — not canvas dimensions — to buildNativeFrameRequest", async () => {
    const { exportVideo } = await import("../videoExport");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/4k.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    // The 5th and 6th positional arguments to buildNativeFrameRequest are
    // outputWidth and outputHeight.  They must be the export target dimensions,
    // not the canvas dimensions.
    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(3840);
    expect(outputHeight).toBe(2160);
  });

  it("passes canvas dimensions separately in the project snapshot — not in outputWidth/Height", async () => {
    const { exportVideo } = await import("../videoExport");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/4k.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    // The scene's canvasWidth / canvasHeight (1920×1080) must NOT appear as
    // the outputWidth/Height argument to buildNativeFrameRequest.
    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).not.toBe(CANVAS_1080P.canvasWidth);
    expect(outputHeight).not.toBe(CANVAS_1080P.canvasHeight);
  });

  it("downscales 1080p canvas to 720p export correctly", async () => {
    const { exportVideo } = await import("../videoExport");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(1280, 720));

    const result = await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/720p.mp4",
      width: 1280,
      height: 720,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(1280);
    expect(outputHeight).toBe(720);
  });

  it("exports portrait 4K (2160×3840) from a portrait canvas (1080×1920)", async () => {
    const { exportVideo } = await import("../videoExport");

    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_PORTRAIT));
    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(2160, 3840));

    const result = await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_PORTRAIT),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/portrait-4k.mp4",
      width: 2160,
      height: 3840,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(2160);
    expect(outputHeight).toBe(3840);
  });

  it("exports square 4K (2160×2160) from a square canvas (1080×1080)", async () => {
    const { exportVideo } = await import("../videoExport");

    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_SQUARE));
    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(2160, 2160));

    const result = await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_SQUARE),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/square-4k.mp4",
      width: 2160,
      height: 2160,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(2160);
    expect(outputHeight).toBe(2160);
  });

  /**
   * Same-size export (canvas == output) must continue to work — this is the
   * pre-existing path and must not have been broken by removing the guard.
   * The scale factors in Rust become 1.0 × 1.0, a no-op transform.
   */
  it("same-size export (output == canvas) continues to work", async () => {
    const { exportVideo } = await import("../videoExport");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(1920, 1080));

    const result = await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/1080p-same-size.mp4",
      width: 1920,
      height: 1080,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(1920);
    expect(outputHeight).toBe(1080);
  });

  /**
   * buildNativeFrameRequest may still return null for scene-content reasons
   * (unsupported layer type, missing raster asset, etc.).  The export must
   * still throw the contract error in that case — the null path is not gone,
   * only the pre-emptive dimension guard is.
   */
  it("still throws contract error when buildNativeFrameRequest returns null for scene-content reasons", async () => {
    const { exportVideo } = await import("../videoExport");

    // Simulate a scene with an unsupported layer type that makes
    // buildNativeFrameRequest return null.
    mockBuildNativeFrameRequest.mockReturnValue(null);

    await expect(
      exportVideo({
        clips: [],
        tracks: [],
        assets: [],
        project: makeProject(CANVAS_1080P),
        epoch: 1,
        startTime: 0,
        endTime: 1 / 30,
        outputPath: "/out/unsupported.mp4",
        width: 3840,
        height: 2160,
        frameRate: 30,
      }),
    ).rejects.toThrow("outside the native compositor contract");
  });

  it("calls buildNativeFrameRequest once per frame across a multi-frame export", async () => {
    const { exportVideo } = await import("../videoExport");

    // 9 frames at 30fps = 0.3 seconds
    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 9 / 30,
      outputPath: "/out/multi-frame-4k.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    expect(mockBuildNativeFrameRequest).toHaveBeenCalledTimes(9);

    // Every call must use the output dimensions, not the canvas dimensions.
    for (const call of mockBuildNativeFrameRequest.mock.calls) {
      const [, , , , w, h] = call;
      expect(w).toBe(3840);
      expect(h).toBe(2160);
    }
  });

  it("sends the correct output dimensions to the FFmpeg session, not the canvas dimensions", async () => {
    const { exportVideo } = await import("../videoExport");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    await exportVideo({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      outputPath: "/out/ffmpeg-dims.mp4",
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      "start_video_export",
      expect.objectContaining({
        config: expect.objectContaining({ width: 3840, height: 2160 }),
      }),
    );
  });

  /**
   * The dimension validator (applied before any frame work begins) must still
   * reject dimensions that exceed the 8 K Rust contract limit (7680×4320 is
   * the JS-side cap; the Rust cap is 8192×8192).
   */
  it("still rejects oversized output dimensions before attempting any frame work", async () => {
    const { exportVideo } = await import("../videoExport");

    await expect(
      exportVideo({
        clips: [],
        tracks: [],
        assets: [],
        project: makeProject(CANVAS_1080P),
        epoch: 1,
        startTime: 0,
        endTime: 1 / 30,
        outputPath: "/out/too-big.mp4",
        width: 9000,
        height: 1080,
        frameRate: 30,
      }),
    ).rejects.toThrow("Invalid export dimensions: 9000x1080");

    expect(mockBuildNativeFrameRequest).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  2. exportSequence — output resolution decoupled from canvas
// ─────────────────────────────────────────────────────────────────────────────

describe("exportSequence — output resolution", () => {
  // exportSequence renders to a canvas element; set up a minimal DOM stub.
  const originalCreateElement = globalThis.document?.createElement?.bind(
    globalThis.document,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildNativeFrameRequest.mockReturnValue(MOCK_FRAME_REQUEST);
    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_1080P));

    // Minimal canvas stub: createImageData, putImageData, and toBlob.
    const stubCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: vi.fn(),
      }),
      toBlob: (cb: (b: Blob | null) => void) =>
        cb(new Blob(["frame"], { type: "image/png" })),
    };

    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") return stubCanvas as unknown as HTMLElement;
      return originalCreateElement?.(tag) ?? ({} as HTMLElement);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports 4K (3840×2160) image sequence from a 1080p canvas without throwing", async () => {
    const { exportSequence } = await import("../exportSequence");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    const result = await exportSequence({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);
    expect(result.totalFrames).toBe(1);
  });

  it("passes export output dimensions — not canvas dimensions — to buildNativeFrameRequest", async () => {
    const { exportSequence } = await import("../exportSequence");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    await exportSequence({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      width: 3840,
      height: 2160,
      frameRate: 30,
    });

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(3840);
    expect(outputHeight).toBe(2160);
  });

  it("same-size sequence export (output == canvas) continues to work", async () => {
    const { exportSequence } = await import("../exportSequence");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(1920, 1080));

    const result = await exportSequence({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      width: 1920,
      height: 1080,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);
  });

  it("still throws contract error when buildNativeFrameRequest returns null for scene-content reasons", async () => {
    const { exportSequence } = await import("../exportSequence");

    mockBuildNativeFrameRequest.mockReturnValue(null);

    await expect(
      exportSequence({
        clips: [],
        tracks: [],
        assets: [],
        project: makeProject(CANVAS_1080P),
        epoch: 1,
        startTime: 0,
        endTime: 1 / 30,
        width: 3840,
        height: 2160,
        frameRate: 30,
      }),
    ).rejects.toThrow("outside the native compositor contract");
  });

  it("exports portrait 4K sequence (2160×3840) from a portrait canvas (1080×1920)", async () => {
    const { exportSequence } = await import("../exportSequence");

    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_PORTRAIT));
    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(2160, 3840));

    const result = await exportSequence({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_PORTRAIT),
      epoch: 1,
      startTime: 0,
      endTime: 1 / 30,
      width: 2160,
      height: 3840,
      frameRate: 30,
    });

    expect(result.cancelled).toBe(false);

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(2160);
    expect(outputHeight).toBe(3840);
  });

  it("invokes the onFrame callback with each rendered blob", async () => {
    const { exportSequence } = await import("../exportSequence");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    const onFrame = vi.fn(async (_frameNumber: number, _blob: Blob) => {});

    await exportSequence({
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      startTime: 0,
      endTime: 3 / 30, // 3 frames
      width: 3840,
      height: 2160,
      frameRate: 30,
      onFrame,
    });

    expect(onFrame).toHaveBeenCalledTimes(3);
    for (const [frameNumber, blob] of onFrame.mock.calls) {
      expect(typeof frameNumber).toBe("number");
      expect(blob).toBeInstanceOf(Blob);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  3. exportFrame — output resolution decoupled from canvas
// ─────────────────────────────────────────────────────────────────────────────

describe("exportFrame — output resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildNativeFrameRequest.mockReturnValue(MOCK_FRAME_REQUEST);
    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_1080P));

    // Minimal canvas stub for single-frame blob encoding.
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            createImageData: (w: number, h: number) => ({
              data: new Uint8ClampedArray(w * h * 4),
            }),
            putImageData: vi.fn(),
          }),
          toBlob: (cb: (b: Blob | null) => void) =>
            cb(new Blob(["frame"], { type: "image/png" })),
        } as unknown as HTMLElement;
      }
      return {} as HTMLElement;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports a single 4K frame from a 1080p canvas without throwing", async () => {
    const { exportFrame } = await import("../exportFrame");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    const blob = await exportFrame({
      time: 0,
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      width: 3840,
      height: 2160,
    });

    expect(blob).toBeInstanceOf(Blob);
  });

  it("passes output dimensions — not canvas dimensions — to buildNativeFrameRequest", async () => {
    const { exportFrame } = await import("../exportFrame");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(3840, 2160));

    await exportFrame({
      time: 0,
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      width: 3840,
      height: 2160,
    });

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(3840);
    expect(outputHeight).toBe(2160);
  });

  it("same-size single-frame export (output == canvas) continues to work", async () => {
    const { exportFrame } = await import("../exportFrame");

    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(1920, 1080));

    const blob = await exportFrame({
      time: 1.5,
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      width: 1920,
      height: 1080,
    });

    expect(blob).toBeInstanceOf(Blob);
  });

  it("still throws contract error when buildNativeFrameRequest returns null for scene-content reasons", async () => {
    const { exportFrame } = await import("../exportFrame");

    mockBuildNativeFrameRequest.mockReturnValue(null);

    await expect(
      exportFrame({
        time: 0,
        clips: [],
        tracks: [],
        assets: [],
        project: makeProject(CANVAS_1080P),
        epoch: 1,
        width: 3840,
        height: 2160,
      }),
    ).rejects.toThrow("outside the native compositor contract");
  });

  it("exports a portrait 4K frame (2160×3840) from a portrait canvas (1080×1920)", async () => {
    const { exportFrame } = await import("../exportFrame");

    mockEvaluateScene.mockReturnValue(makeScene(CANVAS_PORTRAIT));
    mockRenderNativeFrame.mockResolvedValue(makeRgbaBuffer(2160, 3840));

    const blob = await exportFrame({
      time: 0,
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_PORTRAIT),
      epoch: 1,
      width: 2160,
      height: 3840,
    });

    expect(blob).toBeInstanceOf(Blob);

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(2160);
    expect(outputHeight).toBe(3840);
  });

  it("defaults to canvas dimensions when no output size is supplied", async () => {
    const { exportFrame } = await import("../exportFrame");

    mockRenderNativeFrame.mockResolvedValue(
      makeRgbaBuffer(CANVAS_1080P.canvasWidth, CANVAS_1080P.canvasHeight),
    );

    await exportFrame({
      time: 0,
      clips: [],
      tracks: [],
      assets: [],
      project: makeProject(CANVAS_1080P),
      epoch: 1,
      // width / height intentionally omitted — should default to canvas size
    });

    const [, , , , outputWidth, outputHeight] =
      mockBuildNativeFrameRequest.mock.calls[0];
    expect(outputWidth).toBe(CANVAS_1080P.canvasWidth);
    expect(outputHeight).toBe(CANVAS_1080P.canvasHeight);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  4. Cross-cutting invariants — all three entry points
// ─────────────────────────────────────────────────────────────────────────────

describe("output resolution — cross-cutting invariants", () => {
  /**
   * Scale-factor table: for every (canvas, output) pair, verify that the
   * arguments passed to buildNativeFrameRequest always match the caller-supplied
   * output dimensions, regardless of the canvas size.  This directly proves the
   * guard is absent in all three callers.
   */
  const resolutionMatrix: Array<{
    label: string;
    canvas: { canvasWidth: number; canvasHeight: number };
    output: { width: number; height: number };
  }> = [
    {
      label: "1080p canvas → 4K",
      canvas: CANVAS_1080P,
      output: { width: 3840, height: 2160 },
    },
    {
      label: "1080p canvas → 720p",
      canvas: CANVAS_1080P,
      output: { width: 1280, height: 720 },
    },
    {
      label: "1080p canvas → 1080p (identity)",
      canvas: CANVAS_1080P,
      output: { width: 1920, height: 1080 },
    },
    {
      label: "portrait canvas → portrait 4K",
      canvas: CANVAS_PORTRAIT,
      output: { width: 2160, height: 3840 },
    },
    {
      label: "square canvas → square 4K",
      canvas: CANVAS_SQUARE,
      output: { width: 2160, height: 2160 },
    },
    {
      label: "1080p canvas → 8K (max allowed)",
      canvas: CANVAS_1080P,
      output: { width: 7680, height: 4320 },
    },
  ];

  describe("exportVideo — resolution matrix", () => {
    const mockInvoke = vi.mocked(invoke);

    beforeEach(() => {
      vi.clearAllMocks();
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "start_video_export") return "sess-matrix";
        if (cmd === "write_export_frames_batch") return;
        if (cmd === "finalize_video_export") return;
        if (cmd === "cancel_video_export") return;
      });
      mockBuildNativeFrameRequest.mockReturnValue(MOCK_FRAME_REQUEST);
    });

    for (const { label, canvas, output } of resolutionMatrix) {
      it(`routes ${label} to compositor at correct output dimensions`, async () => {
        const { exportVideo } = await import("../videoExport");

        mockEvaluateScene.mockReturnValue(makeScene(canvas));
        mockRenderNativeFrame.mockResolvedValue(
          makeRgbaBuffer(output.width, output.height),
        );

        await exportVideo({
          clips: [],
          tracks: [],
          assets: [],
          project: makeProject(canvas),
          epoch: 1,
          startTime: 0,
          endTime: 1 / 30,
          outputPath: `/out/matrix-${output.width}x${output.height}.mp4`,
          width: output.width,
          height: output.height,
          frameRate: 30,
        });

        const [, , , , w, h] = mockBuildNativeFrameRequest.mock.calls[0];
        expect(w).toBe(output.width);
        expect(h).toBe(output.height);
      });
    }
  });
});
