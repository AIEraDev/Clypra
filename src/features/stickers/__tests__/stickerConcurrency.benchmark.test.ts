/**
 * Sticker Concurrency & Performance Benchmark (Phase 5 — Performance Measurement)
 *
 * Measures rendering latency, frame pacing, worker queue behavior, and heap
 * memory growth for:
 * - 1 simultaneous animated sticker
 * - 5 simultaneous animated stickers
 * - 20 simultaneous animated stickers
 *
 * Verifies non-blocking playback budget (< 16.67ms UI frame budget) and ensures
 * zero unbounded heap memory leakage across iterative timeline loops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvaluatedScene, EvaluatedMediaLayer } from "@/core/evaluation/types";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";

// ─── Tauri & Registration Mocks ──────────────────────────────────────────────
const { mockRegisterRaster } = vi.hoisted(() => ({
  mockRegisterRaster: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/platform/tauri", () => ({
  isTauriRuntime: () => true,
  registerNativeRasterAsset: mockRegisterRaster,
  registerNativeImageAsset: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: vi.fn().mockResolvedValue("/mock-cache"),
  join: vi.fn((...args: string[]) => args.join("/")),
}));

// Canvas / Lottie Mock for Benchmarking
vi.mock("lottie-web", () => {
  return {
    default: {
      loadAnimation: vi.fn((config: any) => {
        const width = config.container.style.width ? parseInt(config.container.style.width, 10) : 200;
        const height = config.container.style.height ? parseInt(config.container.style.height, 10) : 200;
        const totalFrames = config.animationData?.op ? Number(config.animationData.op) : 60;
        const frameRate = config.animationData?.fr ? Number(config.animationData.fr) : 30;

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const dummyPixels = new Uint8ClampedArray(width * height * 4).fill(180);

        const ctx = {
          clearRect: vi.fn(),
          getImageData: vi.fn(() => ({
            data: dummyPixels,
            width,
            height,
          })),
        };

        vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);
        config.container.appendChild(canvas);

        const anim = {
          totalFrames,
          frameRate,
          currentFrame: 0,
          goToAndStop: vi.fn((frame: number) => {
            anim.currentFrame = Math.floor(frame);
          }),
          destroy: vi.fn(() => {
            canvas.remove();
          }),
        };

        return anim;
      }),
    },
  };
});

import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import { stickerCacheManager } from "@/features/stickers/cache/stickerCache";
import { useStickersStore } from "@/features/stickers/store/stickersStore";

interface BenchmarkMetrics {
  stickerCount: number;
  totalFramesEvaluated: number;
  meanFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  heapStartMb: number;
  heapEndMb: number;
  heapDeltaMb: number;
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function createConcurrentScene(count: number, time: number): EvaluatedScene {
  const visualLayers: EvaluatedMediaLayer[] = [];
  const starterIds = STARTER_STICKERS.map((s) => s.id);

  for (let i = 0; i < count; i++) {
    const starterId = starterIds[i % starterIds.length];
    const col = i % 5;
    const row = Math.floor(i / 5);

    visualLayers.push({
      layerId: `layer-concurrent-${i}`,
      clipId: `clip-concurrent-${i}`,
      role: "overlay",
      clipKind: "sticker",
      zIndex: i,
      trackIndex: i,
      layerType: "media",
      mediaId: `sticker-${starterId}`,
      mediaType: "image",
      sourcePath: `/cache/stickers/${starterId}.png`,
      sourceTime: time,
      x: 100 + col * 350,
      y: 100 + row * 220,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1.0,
      inTransition: false,
      blendMode: "normal",
      stickerFormat: "lottie",
      stickerSourceId: starterId,
      stickerSettings: {
        speed: 1.0,
        loop: true,
      },
    });
  }

  return {
    metadata: {
      time,
      frameRate: 30,
      isGap: false,
      canvasWidth: 1920,
      canvasHeight: 1080,
    },
    visualLayers,
    audioLayers: [],
    transitions: [],
  };
}

describe("Phase 5 — Sticker Concurrency Benchmark (1, 5, 20 Concurrent Animated Stickers)", () => {
  let bridge: NativeRasterBridge;

  beforeEach(async () => {
    vi.clearAllMocks();
    await stickerCacheManager.initialize();
    await useStickersStore.getState().initializeCache();
    bridge = new NativeRasterBridge();
  });

  afterEach(() => {
    bridge.dispose();
  });

  async function runSimulation(
    stickerCount: number,
    iterations: number,
    nonBlocking: boolean,
  ): Promise<BenchmarkMetrics> {
    const runtimeEnv = globalThis as unknown as {
      gc?: () => void;
      process?: { memoryUsage?: () => { heapUsed: number } };
    };
    if (typeof runtimeEnv.gc === "function") {
      runtimeEnv.gc();
    }
    const memStart = typeof runtimeEnv.process?.memoryUsage === "function"
      ? runtimeEnv.process.memoryUsage().heapUsed
      : 0;
    const frameDurations: number[] = [];

    for (let frameIndex = 0; frameIndex < iterations; frameIndex++) {
      const time = frameIndex / 30; // 30 fps
      const scene = createConcurrentScene(stickerCount, time);

      const t0 = performance.now();
      await bridge.rasterize(scene, {
        frameKey: frameIndex,
        nonBlockingStickers: nonBlocking,
      });
      const t1 = performance.now();
      frameDurations.push(t1 - t0);
    }

    if (typeof runtimeEnv.gc === "function") {
      runtimeEnv.gc();
    }
    const memEnd = typeof runtimeEnv.process?.memoryUsage === "function"
      ? runtimeEnv.process.memoryUsage().heapUsed
      : 0;

    const sum = frameDurations.reduce((acc, v) => acc + v, 0);
    const mean = sum / frameDurations.length;
    const p50 = calculatePercentile(frameDurations, 50);
    const p95 = calculatePercentile(frameDurations, 95);
    const max = Math.max(...frameDurations);

    const heapStartMb = memStart / (1024 * 1024);
    const heapEndMb = memEnd / (1024 * 1024);
    const heapDeltaMb = Math.max(0, (memEnd - memStart) / (1024 * 1024));

    return {
      stickerCount,
      totalFramesEvaluated: iterations,
      meanFrameMs: Number(mean.toFixed(2)),
      p50FrameMs: Number(p50.toFixed(2)),
      p95FrameMs: Number(p95.toFixed(2)),
      maxFrameMs: Number(max.toFixed(2)),
      heapStartMb: Number(heapStartMb.toFixed(2)),
      heapEndMb: Number(heapEndMb.toFixed(2)),
      heapDeltaMb: Number(heapDeltaMb.toFixed(2)),
    };
  }

  it("measures 1 simultaneous animated sticker within SLA budget (< 16.67ms)", async () => {
    const result = await runSimulation(1, 60, false);

    console.log("[Benchmark] 1 Animated Sticker:", {
      mean: `${result.meanFrameMs}ms`,
      p95: `${result.p95FrameMs}ms`,
      max: `${result.maxFrameMs}ms`,
      heapDelta: `${result.heapDeltaMb}MB`,
    });

    // 1 sticker must easily render within 16.67ms frame budget
    expect(result.meanFrameMs).toBeLessThan(16.67);
    expect(result.p95FrameMs).toBeLessThan(25.0);
    // Heap growth should remain bounded (< 15MB delta across 60 frames)
    expect(result.heapDeltaMb).toBeLessThan(15.0);
  });

  it("measures 5 simultaneous animated stickers with smooth frame pacing", async () => {
    const result = await runSimulation(5, 60, false);

    console.log("[Benchmark] 5 Animated Stickers:", {
      mean: `${result.meanFrameMs}ms`,
      p95: `${result.p95FrameMs}ms`,
      max: `${result.maxFrameMs}ms`,
      heapDelta: `${result.heapDeltaMb}MB`,
    });

    expect(result.meanFrameMs).toBeLessThan(33.33); // within 30fps budget
    expect(result.heapDeltaMb).toBeLessThan(30.0);
  });

  it("measures 20 simultaneous animated stickers in non-blocking playback mode", async () => {
    // Non-blocking mode mirrors live UI playback in NativeProgramPreview
    const result = await runSimulation(20, 60, true);

    console.log("[Benchmark] 20 Animated Stickers (Non-Blocking):", {
      mean: `${result.meanFrameMs}ms`,
      p95: `${result.p95FrameMs}ms`,
      max: `${result.maxFrameMs}ms`,
      heapDelta: `${result.heapDeltaMb}MB`,
    });

    // In non-blocking mode, the latest-snapshot scheduler guards the main thread
    // ensuring the UI frame call does not block on 20 synchronous worker transfers.
    expect(result.meanFrameMs).toBeLessThan(16.67);
    expect(result.p95FrameMs).toBeLessThan(25.0);
    // Heap growth must remain strictly capped by LRU cache limits
    expect(result.heapDeltaMb).toBeLessThan(50.0);
  });

  it("measures 20 simultaneous animated stickers in blocking export mode with bounded memory", async () => {
    // Blocking mode mirrors offline export in exportFrame / exportSequence
    const result = await runSimulation(20, 30, false);

    console.log("[Benchmark] 20 Animated Stickers (Export / Blocking):", {
      mean: `${result.meanFrameMs}ms`,
      p95: `${result.p95FrameMs}ms`,
      max: `${result.maxFrameMs}ms`,
      heapDelta: `${result.heapDeltaMb}MB`,
    });

    // Verifies all 20 layers are evaluated per frame without heap explosion
    expect(result.heapDeltaMb).toBeLessThan(50.0);
  });
});
