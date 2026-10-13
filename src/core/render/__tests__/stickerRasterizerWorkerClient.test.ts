/**
 * StickerRasterizerWorkerClient — unit tests
 *
 * Tests the worker-backed sticker rasterizer client:
 * - Worker instantiation & offscreen canvas message protocol
 * - Main thread fallback when Worker is unavailable
 * - In-flight promise deduplication
 * - Fast-path GPU frame residency
 * - Telemetry reporting for render & cache hit
 * - Error handling and dispose lifecycle
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StickerRasterizerWorkerClient } from "../stickerRasterizerWorkerClient";
import type { EvaluatedMediaLayer } from "@/core/evaluation/types";
import { telemetryCollector } from "@/services/telemetryCollector";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/path", () => ({
  appCacheDir: vi.fn().mockResolvedValue("/mock-cache"),
  join: vi.fn((...args: string[]) => args.join("/")),
}));

vi.mock("@/features/stickers/store/stickersStore", () => ({
  useStickersStore: {
    getState: () => ({
      getCachedSticker: vi.fn().mockReturnValue({
        localAnimationPath: "stickers/star.json",
        lottieData: {
          v: "5.5.0",
          fr: 30,
          ip: 0,
          op: 60,
          w: 200,
          h: 200,
          layers: [],
        },
      }),
      initializeCache: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/features/stickers/cache/stickerCache", () => ({
  stickerCacheManager: {
    readLottieJson: vi.fn().mockResolvedValue({
      v: "5.5.0",
      fr: 30,
      ip: 0,
      op: 60,
      w: 200,
      h: 200,
      layers: [],
    }),
  },
}));

const mockAnimation = {
  frameRate: 30,
  totalFrames: 60,
  goToAndStop: vi.fn(),
  destroy: vi.fn(),
};

vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: vi.fn((config: any) => {
      const canvas = document.createElement("canvas");
      canvas.width = config.container.style.width ? parseInt(config.container.style.width, 10) : 200;
      canvas.height = config.container.style.height ? parseInt(config.container.style.height, 10) : 200;
      const ctx = {
        getImageData: vi.fn().mockReturnValue({
          data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(128),
        }),
      };
      vi.spyOn(canvas, "getContext").mockReturnValue(ctx as any);
      config.container.appendChild(canvas);
      return mockAnimation;
    }),
  },
}));

function makeStickerLayer(overrides: Partial<EvaluatedMediaLayer> = {}): EvaluatedMediaLayer {
  return {
    layerId: "sticker-layer-test",
    clipId: "clip-st-test",
    role: "overlay",
    clipKind: "sticker",
    zIndex: 2,
    trackIndex: 1,
    layerType: "media",
    mediaId: "sticker-star",
    mediaType: "image",
    sourcePath: "/cache/stickers/star.png",
    sourceTime: 0.5, // 0.5s * 30fps = frame 15
    x: 50,
    y: 50,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    stickerFormat: "lottie",
    stickerSourceId: "star",
    stickerSettings: {
      speed: 1.0,
      loop: true,
    },
    ...overrides,
  };
}

describe("StickerRasterizerWorkerClient — Fallback & Deduplication", () => {
  let client: StickerRasterizerWorkerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new StickerRasterizerWorkerClient();
  });

  afterEach(() => {
    client.dispose();
  });

  it("returns null for non-sticker clips or non-lottie formats", async () => {
    const nonSticker = makeStickerLayer({ clipKind: "video" as any });
    expect(await client.render(nonSticker)).toBeNull();

    const staticSticker = makeStickerLayer({ stickerFormat: "static" });
    expect(await client.render(staticSticker)).toBeNull();
  });

  it("renders a valid lottie frame via fallback and records render telemetry", async () => {
    const recordSpy = vi.spyOn(telemetryCollector, "recordStickerRender");
    const layer = makeStickerLayer();

    const result = await client.render(layer, "visible-playback");
    expect(result).not.toBeNull();
    expect(result?.assetId).toBe("native-sticker:sticker-layer-test:15:200x200");
    expect(result?.width).toBe(200);
    expect(result?.height).toBe(200);
    expect(result?.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(result?.rgba.length).toBe(200 * 200 * 4);
    expect(result?.isText).toBe(false);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "lottie",
        rendererPath: "native-raster",
        phase: "visible-playback",
        operation: "render",
        cacheHit: false,
      }),
    );
  });

  it("deduplicates concurrent render calls for the exact same frame", async () => {
    const layer = makeStickerLayer();
    const p1 = client.render(layer, "visible-playback");
    const p2 = client.render(layer, "visible-playback");

    // Both calls must return the identical Promise reference
    expect(p1).toBe(p2);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(client.inFlightCount).toBe(0);
  });

  it("differentiates render calls for different frames or layers", async () => {
    const layer1 = makeStickerLayer({ sourceTime: 0.1 }); // frame 3
    const layer2 = makeStickerLayer({ sourceTime: 0.8 }); // frame 24

    const p1 = client.render(layer1);
    const p2 = client.render(layer2);

    expect(p1).not.toBe(p2);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.assetId).not.toBe(r2?.assetId);
  });

  it("fast-path returns empty rgba and emits cache-hit telemetry for already registered frame", async () => {
    const hitSpy = vi.spyOn(telemetryCollector, "recordStickerCacheHit");
    const layer = makeStickerLayer();

    // 1st render registers frame
    const r1 = await client.render(layer);
    expect(r1?.rgba.length).toBeGreaterThan(0);

    // 2nd render hits fast-path
    const r2 = await client.render(layer);
    expect(r2).not.toBeNull();
    expect(r2?.assetId).toBe(r1?.assetId);
    expect(r2?.rgba).toEqual([]); // GPU resident payload fast-path
    expect(hitSpy).toHaveBeenCalledTimes(1);
    expect(hitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "lottie",
        phase: "visible-playback",
      }),
    );
  });

  it("dispose() is idempotent and clears cached frames and fallback animations", async () => {
    const layer = makeStickerLayer();
    await client.render(layer);
    expect(client.hasRegisteredFrame("native-sticker:sticker-layer-test:15:200x200")).toBe(true);

    expect(() => {
      client.dispose();
      client.dispose();
    }).not.toThrow();

    expect(client.hasRegisteredFrame("native-sticker:sticker-layer-test:15:200x200")).toBe(false);
  });

  it("evictFrame() removes asset from registeredFrames so next render uploads full pixels", async () => {
    const layer = makeStickerLayer();
    const r1 = await client.render(layer);
    expect(r1?.rgba.length).toBeGreaterThan(0);

    const assetId = "native-sticker:sticker-layer-test:15:200x200";
    expect(client.hasRegisteredFrame(assetId)).toBe(true);

    // Fast path gives []
    const r2 = await client.render(layer);
    expect(r2?.rgba).toEqual([]);

    // Evict frame
    client.evictFrame(assetId);
    expect(client.hasRegisteredFrame(assetId)).toBe(false);

    // After eviction, render re-produces full pixel buffer
    const r3 = await client.render(layer);
    expect(r3?.rgba.length).toBeGreaterThan(0);
  });

  it("forcePixels=true bypasses registeredFrames fast-path to deliver full pixel buffer", async () => {
    const layer = makeStickerLayer();
    await client.render(layer);

    // Calling with forcePixels=true bypasses the [] shortcut
    const forced = await client.render(layer, "interactive-preview", true);
    expect(forced?.rgba.length).toBeGreaterThan(0);
  });
});

describe("StickerRasterizerWorkerClient — Worker Offscreen Protocol", () => {
  let originalWorker: any;
  let originalOffscreenCanvas: any;
  let mockWorkerInstance: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((e: any) => void) | null;
    onerror: ((e: any) => void) | null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    originalWorker = globalThis.Worker;
    originalOffscreenCanvas = globalThis.OffscreenCanvas;

    mockWorkerInstance = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };

    class MockWorker {
      postMessage = mockWorkerInstance.postMessage;
      terminate = mockWorkerInstance.terminate;
      set onmessage(handler: any) {
        mockWorkerInstance.onmessage = handler;
      }
      get onmessage() {
        return mockWorkerInstance.onmessage;
      }
      set onerror(handler: any) {
        mockWorkerInstance.onerror = handler;
      }
      get onerror() {
        return mockWorkerInstance.onerror;
      }
    }

    (globalThis as any).Worker = vi.fn().mockImplementation(function () {
      return new MockWorker();
    });
    (globalThis as any).OffscreenCanvas = class MockOffscreenCanvas {};
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  });

  it("initializes Worker when Worker and OffscreenCanvas are supported", () => {
    const client = new StickerRasterizerWorkerClient();
    expect(globalThis.Worker).toHaveBeenCalled();
    client.dispose();
    expect(mockWorkerInstance.terminate).toHaveBeenCalled();
  });

  it("dispatches RENDER_STICKER_FRAME to worker and resolves on STICKER_FRAME_READY", async () => {
    const recordSpy = vi.spyOn(telemetryCollector, "recordStickerRender");
    const client = new StickerRasterizerWorkerClient();
    const layer = makeStickerLayer();

    const renderPromise = client.render(layer, "visible-playback");

    expect(mockWorkerInstance.postMessage).toHaveBeenCalledTimes(1);
    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
    expect(sentMessage.type).toBe("RENDER_STICKER_FRAME");
    expect(sentMessage.stickerSourceId).toBe("star");
    expect(sentMessage.frame).toBe(15);
    expect(sentMessage.width).toBe(200);
    expect(sentMessage.height).toBe(200);

    // Simulate worker responding with rendered frame
    const mockBuffer = new ArrayBuffer(200 * 200 * 4);
    new Uint8ClampedArray(mockBuffer).fill(200);

    mockWorkerInstance.onmessage!({
      data: {
        type: "STICKER_FRAME_READY",
        id: sentMessage.id,
        buffer: mockBuffer,
        width: 200,
        height: 200,
        workerRasterMs: 3.5,
      },
    } as any);

    const result = await renderPromise;
    expect(result).not.toBeNull();
    expect(result?.assetId).toBe("native-sticker:sticker-layer-test:15:200x200");
    expect(result?.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(result?.rgba.length).toBe(200 * 200 * 4);

    expect(recordSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "lottie",
        rendererPath: "worker-offscreen",
        phase: "visible-playback",
        operation: "render",
        cacheHit: false,
      }),
    );

    client.dispose();
  });

  it("handles STICKER_FRAME_FAILED from worker by gracefully falling back to main-thread rendering", async () => {
    const client = new StickerRasterizerWorkerClient();
    const layer = makeStickerLayer();

    const renderPromise = client.render(layer);

    const sentMessage = mockWorkerInstance.postMessage.mock.calls[0][0];
    mockWorkerInstance.onmessage!({
      data: {
        type: "STICKER_FRAME_FAILED",
        id: sentMessage.id,
        error: "Failed to render frame in worker",
      },
    } as any);

    const result = await renderPromise;
    expect(result).not.toBeNull();
    expect(result?.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(result?.rgba.length).toBe(200 * 200 * 4);
    client.dispose();
  });

  it("falls back to main-thread rendering if postMessage throws", async () => {
    mockWorkerInstance.postMessage.mockImplementationOnce(() => {
      throw new Error("DataCloneError");
    });

    const client = new StickerRasterizerWorkerClient();
    const layer = makeStickerLayer();

    const result = await client.render(layer);
    expect(result).not.toBeNull();
    expect(result?.rgba.length).toBe(200 * 200 * 4);
    client.dispose();
  });

  it("CLY-BUG-004: supports multi-instance stickers with different sizes without thrashing worker", async () => {
    const client = new StickerRasterizerWorkerClient();
    const layerSmall = makeStickerLayer({ width: 100, height: 100 });
    const layerLarge = makeStickerLayer({ width: 300, height: 300 });

    const promiseSmall = client.render(layerSmall);
    const sentMsg1 = mockWorkerInstance.postMessage.mock.calls[0][0];
    mockWorkerInstance.onmessage!({
      data: {
        type: "STICKER_FRAME_READY",
        id: sentMsg1.id,
        stickerSourceId: sentMsg1.stickerSourceId,
        frame: 0,
        width: 100,
        height: 100,
        totalFrames: 60,
        frameRate: 30,
        buffer: new Uint8ClampedArray(100 * 100 * 4).buffer,
        workerRasterMs: 2,
      },
    } as any);
    const resultSmall = await promiseSmall;

    const promiseLarge = client.render(layerLarge);
    const sentMsg2 = mockWorkerInstance.postMessage.mock.calls[1][0];
    mockWorkerInstance.onmessage!({
      data: {
        type: "STICKER_FRAME_READY",
        id: sentMsg2.id,
        stickerSourceId: sentMsg2.stickerSourceId,
        frame: 0,
        width: 300,
        height: 300,
        totalFrames: 60,
        frameRate: 30,
        buffer: new Uint8ClampedArray(300 * 300 * 4).buffer,
        workerRasterMs: 3,
      },
    } as any);
    const resultLarge = await promiseLarge;

    expect(resultSmall?.width).toBe(100);
    expect(resultLarge?.width).toBe(300);
    expect(sentMsg1.width).toBe(100);
    expect(sentMsg2.width).toBe(300);
    client.dispose();
  });
});
