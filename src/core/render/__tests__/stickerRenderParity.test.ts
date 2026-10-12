/**
 * Sticker Render Parity Test Suite (Phase 5 — Render Parity)
 *
 * Verifies that Clypra's preview pipeline (NativeAnimatedStickerRenderer /
 * NativeRasterBridge visible playback) and export pipeline (NativeRasterBridge
 * full rasterization) produce 100% byte-for-byte identical pixels for animated
 * Lottie stickers across sampled timestamps.
 *
 * PSNR Threshold:
 * - Minimum acceptable PSNR: 60 dB (effectively lossless).
 * - Target PSNR for deterministic vectors: Infinity dB (MSE = 0, 0 differing pixels).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EvaluatedScene, EvaluatedMediaLayer } from "@/core/evaluation/types";
import { computePixelDiff } from "@/lib/renderEngine/pixelDiff";
import { STARTER_STICKERS } from "@/features/stickers/starterStickers";

// ─── Golden Parity Thresholds (Stated Up Front) ───────────────────────────────
const MIN_PSNR_THRESHOLD_DB = 60.0;
const MAX_MSE_THRESHOLD = 0.00001;

// Canonical 60fps Golden Star Animation data from fixtures/golden-project/sticker_animated_lottie.json
const GOLDEN_FIXTURE_DATA = {
  v: "5.7.4",
  fr: 60,
  ip: 0,
  op: 180,
  w: 500,
  h: 500,
  nm: "Clypra Golden Star",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: "StarShape",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: {
          a: 1,
          k: [
            { t: 0, s: [0] },
            { t: 180, s: [360] },
          ],
        },
        p: { a: 0, k: [250, 250, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      shapes: [],
    },
  ],
};

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

// Deterministic Canvas / Lottie Mock that computes procedural pixel patterns
// directly from the active animation frame, width, height, and layer geometry.
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

        let currentFrame = 0;

        const generateFramePixels = (frame: number): Uint8ClampedArray => {
          const buffer = new Uint8ClampedArray(width * height * 4);
          // Procedurally generate deterministic pixels based on frame, width, height:
          const progress = frame / Math.max(1, totalFrames);
          const rBase = Math.floor(progress * 255);
          const gBase = Math.floor((1 - progress) * 200);
          const bBase = Math.floor(((frame * 7) % 256));

          const cx = width / 2;
          const cy = height / 2;
          const maxRadius = Math.min(width, cy) * 0.45 * (0.8 + 0.2 * Math.sin(progress * Math.PI * 2));

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const idx = (y * width + x) * 4;
              const dx = x - cx;
              const dy = y - cy;
              const dist = Math.sqrt(dx * dx + dy * dy);

              if (dist <= maxRadius) {
                // Foreground sticker shape
                buffer[idx] = (rBase + (x % 32)) & 0xff;
                buffer[idx + 1] = (gBase + (y % 32)) & 0xff;
                buffer[idx + 2] = (bBase + ((x + y) % 32)) & 0xff;
                buffer[idx + 3] = 255;
              } else {
                // Transparent background outside shape
                buffer[idx] = 0;
                buffer[idx + 1] = 0;
                buffer[idx + 2] = 0;
                buffer[idx + 3] = 0;
              }
            }
          }
          return buffer;
        };

        let currentPixels = generateFramePixels(0);

        const ctx = {
          clearRect: vi.fn(),
          getImageData: vi.fn((_sx: number, _sy: number, _sw: number, _sh: number) => ({
            data: currentPixels,
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
            currentFrame = Math.floor(frame);
            anim.currentFrame = currentFrame;
            currentPixels = generateFramePixels(currentFrame);
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

import { NativeAnimatedStickerRenderer } from "@/components/editor/preview/nativeStickerPreview";
import { NativeRasterBridge } from "@/core/render/nativeRasterBridge";
import { stickerCacheManager } from "@/features/stickers/cache/stickerCache";
import { useStickersStore } from "@/features/stickers/store/stickersStore";



function createStickerLayer(
  stickerId: string,
  sourceTime: number,
  overrides: Partial<EvaluatedMediaLayer> = {},
): EvaluatedMediaLayer {
  return {
    layerId: `layer-${stickerId}`,
    clipId: `clip-${stickerId}`,
    role: "overlay",
    clipKind: "sticker",
    zIndex: 2,
    trackIndex: 1,
    layerType: "media",
    mediaId: `sticker-${stickerId}`,
    mediaType: "image",
    sourcePath: `/cache/stickers/${stickerId}.png`,
    sourceTime,
    x: 400,
    y: 300,
    width: 250,
    height: 250,
    rotation: 0,
    opacity: 1.0,
    inTransition: false,
    blendMode: "normal",
    stickerFormat: "lottie",
    stickerSourceId: stickerId,
    stickerSettings: {
      speed: 1.0,
      loop: true,
    },
    ...overrides,
  };
}

function createScene(layers: EvaluatedMediaLayer[], time: number): EvaluatedScene {
  return {
    metadata: {
      time,
      frameRate: 30,
      isGap: false,
      canvasWidth: 1920,
      canvasHeight: 1080,
    },
    visualLayers: layers,
    audioLayers: [],
    transitions: [],
  };
}

describe("Phase 5 — Sticker Render Parity: Golden-Frame Tests (Preview vs Export)", () => {
  let previewRenderer: NativeAnimatedStickerRenderer;
  let exportBridge: NativeRasterBridge;

  beforeEach(async () => {
    vi.clearAllMocks();
    await stickerCacheManager.initialize();
    await useStickersStore.getState().initializeCache();

    // Seed golden project fixture into cache
    (stickerCacheManager as any).cacheIndex.set("golden-fixture", {
      id: "golden-fixture",
      sha256: "sha-golden-fixture",
      localImagePath: "",
      localAnimationPath: "bundled://golden-fixture.json",
      lottieData: GOLDEN_FIXTURE_DATA,
      downloadedAt: Date.now(),
      lastAccessedAt: Date.now(),
      sizeBytes: 2048,
      isStarter: false,
    });

    previewRenderer = new NativeAnimatedStickerRenderer();
    exportBridge = new NativeRasterBridge();
  });

  afterEach(() => {
    exportBridge.dispose();
  });

  // ─── Test 1: Sampling 5 timestamps per animated sticker across candidate set ──
  const candidateStickers = [
    { id: "starter-golden-star", label: "Golden Star (Starter)" },
    { id: "starter-pulsing-heart", label: "Pulsing Heart (Starter)" },
    { id: "starter-fire-burst", label: "Fire Burst (Starter)" },
    { id: "starter-party-popper", label: "Party Popper (Starter)" },
    { id: "golden-fixture", label: "Golden Project Fixture (60fps Golden Star)" },
  ];

  // 5 distinct timestamps spanning start, quarters, midpoint, and loop boundaries
  const sampledTimestamps = [0.0, 0.25, 0.5, 1.0, 1.75];

  for (const sticker of candidateStickers) {
    describe(`Golden-frame parity for ${sticker.label}`, () => {
      for (const timestamp of sampledTimestamps) {
        it(`produces byte-identical pixels and geometry at t = ${timestamp.toFixed(2)}s (PSNR >= ${MIN_PSNR_THRESHOLD_DB} dB)`, async () => {
          const stickerLayer = createStickerLayer(sticker.id, timestamp);
          const scene = createScene([stickerLayer], timestamp);
          const frameKey = Math.round(timestamp * 30);

          // 1. Render through preview pipeline
          const previewRaster = await previewRenderer.render(stickerLayer, "visible-playback");
          expect(previewRaster).not.toBeNull();
          expect(previewRaster?.rgba).toBeDefined();

          // 2. Render through export bridge
          const exportRasters = await exportBridge.rasterize(scene, { frameKey });
          expect(exportRasters.length).toBe(1);
          const exportRaster = exportRasters[0];

          // 3. Asset and geometry parity checks
          expect(exportRaster.assetId).toBe(previewRaster?.assetId);
          expect(exportRaster.width).toBe(previewRaster?.width);
          expect(exportRaster.height).toBe(previewRaster?.height);
          expect(exportRaster.x).toBe(previewRaster?.x);
          expect(exportRaster.y).toBe(previewRaster?.y);
          expect(exportRaster.rotation).toBe(previewRaster?.rotation);
          expect(exportRaster.opacity).toBe(previewRaster?.opacity);
          expect(exportRaster.zIndex).toBe(previewRaster?.zIndex);
          expect(exportRaster.blendMode).toBe(previewRaster?.blendMode);
          expect(exportRaster.isText).toBe(false);

          // 4. Retrieve pixel buffers
          const previewBytes = previewRaster!.rgba as Uint8ClampedArray;
          // The export bridge registers the asset via registerNativeRasterAsset
          expect(mockRegisterRaster).toHaveBeenCalled();
          const registeredCall = mockRegisterRaster.mock.calls.find(
            (call) => call[0].assetId === exportRaster.assetId,
          );
          expect(registeredCall).toBeDefined();
          const exportBytes = registeredCall![0].rgba as Uint8ClampedArray;

          // 5. Quantitative pixel diff & PSNR calculation
          const diff = computePixelDiff(
            previewBytes,
            exportBytes,
            exportRaster.width,
            exportRaster.height,
          );

          // Verification against stated threshold
          expect(diff.isIdentical).toBe(true);
          expect(diff.differingPixels).toBe(0);
          expect(diff.differingPercentage).toBe(0);
          expect(diff.meanSquaredError).toBeLessThanOrEqual(MAX_MSE_THRESHOLD);
          expect(diff.psnr).toBeGreaterThanOrEqual(MIN_PSNR_THRESHOLD_DB);
        });
      }
    });
  }

  // ─── Test 2: Drift Sensitivity Guard ─────────────────────────────────────────
  it("detects deliberate pixel divergences and correctly fails threshold assertions", () => {
    const width = 100;
    const height = 100;
    const bufA = new Uint8ClampedArray(width * height * 4).fill(255);
    const bufB = new Uint8ClampedArray(width * height * 4).fill(255);

    // Invert a 10x10 patch in bufB
    for (let y = 10; y < 20; y++) {
      for (let x = 10; x < 20; x++) {
        const idx = (y * width + x) * 4;
        bufB[idx] = 0; // Invert red channel
      }
    }

    const diff = computePixelDiff(bufA, bufB, width, height);
    expect(diff.isIdentical).toBe(false);
    expect(diff.differingPixels).toBe(100);
    expect(diff.psnr).toBeLessThan(MIN_PSNR_THRESHOLD_DB);
  });

  // ─── Test 3: Playback Speed Modifier Parity (0.5x, 2.0x) ─────────────────────
  it.each([0.5, 2.0])(
    "maintains exact pixel and frame parity under speed = %sx",
    async (speed) => {
      const timestamp = 0.8;
      const stickerLayer = createStickerLayer("starter-golden-star", timestamp, {
        stickerSettings: { speed, loop: true },
      });
      const scene = createScene([stickerLayer], timestamp);
      const frameKey = Math.round(timestamp * 30);

      const previewRaster = await previewRenderer.render(stickerLayer, "visible-playback");
      const exportRasters = await exportBridge.rasterize(scene, { frameKey });

      expect(exportRasters.length).toBe(1);
      expect(exportRasters[0].assetId).toBe(previewRaster?.assetId);

      const previewBytes = previewRaster!.rgba as Uint8ClampedArray;
      const registeredCall = mockRegisterRaster.mock.calls.find(
        (call) => call[0].assetId === exportRasters[0].assetId,
      );
      const exportBytes = registeredCall![0].rgba as Uint8ClampedArray;

      const diff = computePixelDiff(
        previewBytes,
        exportBytes,
        exportRasters[0].width,
        exportRasters[0].height,
      );

      expect(diff.isIdentical).toBe(true);
      expect(diff.psnr).toBeGreaterThanOrEqual(MIN_PSNR_THRESHOLD_DB);
    },
  );

  // ─── Test 4: Non-looping Final-Frame Clamp Parity ────────────────────────────
  it("clamps non-looping stickers at final frame identically in preview and export", async () => {
    // 10 seconds exceeds typical 2s duration (60 frames), so non-looping sticker must clamp
    const timestamp = 10.0;
    const stickerLayer = createStickerLayer("starter-pulsing-heart", timestamp, {
      stickerSettings: { speed: 1.0, loop: false },
    });
    const scene = createScene([stickerLayer], timestamp);
    const frameKey = Math.round(timestamp * 30);

    const previewRaster = await previewRenderer.render(stickerLayer, "visible-playback");
    const exportRasters = await exportBridge.rasterize(scene, { frameKey });

    expect(exportRasters[0].assetId).toBe(previewRaster?.assetId);
    expect(exportRasters[0].assetId).toContain(":44:"); // Clamped to frame 44 (totalFrames 45 - 1)

    const diff = computePixelDiff(
      previewRaster!.rgba as Uint8ClampedArray,
      mockRegisterRaster.mock.calls[0][0].rgba as Uint8ClampedArray,
      exportRasters[0].width,
      exportRasters[0].height,
    );

    expect(diff.isIdentical).toBe(true);
    expect(diff.psnr).toBeGreaterThanOrEqual(MIN_PSNR_THRESHOLD_DB);
  });

  // ─── Test 5: Variable Canvas Dimensions & Aspect Ratio Parity ────────────────
  it.each([
    [100, 100],
    [250, 250],
    [400, 400],
  ])(
    "maintains exact pixel parity at %sx%s sticker dimensions",
    async (width, height) => {
      const stickerLayer = createStickerLayer("starter-fire-burst", 0.4, {
        width,
        height,
      });
      const scene = createScene([stickerLayer], 0.4);

      const previewRaster = await previewRenderer.render(stickerLayer, "visible-playback");
      const exportRasters = await exportBridge.rasterize(scene, { frameKey: 12 });

      expect(exportRasters[0].width).toBe(width);
      expect(exportRasters[0].height).toBe(height);
      expect(previewRaster?.width).toBe(width);
      expect(previewRaster?.height).toBe(height);

      const diff = computePixelDiff(
        previewRaster!.rgba as Uint8ClampedArray,
        mockRegisterRaster.mock.calls[0][0].rgba as Uint8ClampedArray,
        width,
        height,
      );

      expect(diff.isIdentical).toBe(true);
      expect(diff.psnr).toBeGreaterThanOrEqual(MIN_PSNR_THRESHOLD_DB);
    },
  );
});
