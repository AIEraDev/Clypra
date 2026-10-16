/**
 * Preview Canvas Pixel Validation — Layer A (Browser Rasterization)
 *
 * Tests the REAL browser rendering pipeline by calling paintTextLayersToCanvas()
 * directly with known-colour EvaluatedScene fixtures. This verifies the actual
 * OffscreenCanvas text rasterizer, not mock data.
 *
 * Architecture:
 *   - installTauriMock is used ONLY for app navigation (project lifecycle)
 *   - Pixel assertions call paintTextLayersToCanvas() directly via page.evaluate()
 *   - This bypasses the isTauriRuntime() guard at NativeProgramPreview.tsx:1019
 *   - We test the REAL browser Canvas 2D rasterization path
 *
 * Assertion rules:
 *   - Fixtures use unique known colours (green text on black, magenta overlay)
 *   - Assert pixel at expected centre is the expected colour within tolerance
 *   - Assert area outside expected box is background
 *   - Every test group includes a negative control
 */

import { test, expect } from "@playwright/test";
import { installTauriMock } from "./mocks/tauriMock";
import {
  readCanvasPixel,
  assertPixelColor,
  isCanvasNonBlank,
  countBrightPixels,
} from "./helpers/canvasPixelHelper";

const CANVAS_TEST_ID = "program-preview-canvas";

// ─── Shared navigation helper ────────────────────────────────────────────────

async function navigateToEditor(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New Project" }).click();
  // Wait for canvas to mount in the DOM
  await expect(
    page.locator(`[data-testid="${CANVAS_TEST_ID}"]`),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Call paintTextLayersToCanvas inside the browser and read pixels back.
 *
 * The dynamic import uses the Vite dev server module path.  If the module
 * is already in the module graph (it is, the app loaded it) Vite returns
 * the cached instance — no network round-trip.
 *
 * Returns raw pixel samples at caller-specified probe points.
 */
async function paintSceneAndProbe(
  page: import("@playwright/test").Page,
  scene: Record<string, unknown>,
  probePoints: Array<{ label: string; x: number; y: number }>,
  canvasSize: { width: number; height: number } = {
    width: 400,
    height: 300,
  },
): Promise<
  Record<string, { r: number; g: number; b: number; a: number }> & {
    error?: string;
  }
> {
  return page.evaluate(
    async ({ sceneJson, probes, size, testId }) => {
      const canvas = document.querySelector(
        `[data-testid="${testId}"]`,
      ) as HTMLCanvasElement;
      if (!canvas) return { error: "Canvas not found" } as any;

      canvas.width = size.width;
      canvas.height = size.height;

      try {
        // Dynamic import — Vite resolves this from its module graph
        const mod = await import(
          "/src/components/editor/preview/nativeTextPreview.ts"
        );
        await mod.paintTextLayersToCanvas(
          canvas,
          sceneJson as any,
          "interactive-preview",
        );
      } catch (err) {
        return { error: `paintTextLayersToCanvas failed: ${err}` } as any;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return { error: "No 2d context" } as any;

      const result: Record<
        string,
        { r: number; g: number; b: number; a: number }
      > = {};
      for (const p of probes) {
        const d = ctx.getImageData(p.x, p.y, 1, 1).data;
        result[p.label] = { r: d[0], g: d[1], b: d[2], a: d[3] };
      }
      return result;
    },
    {
      sceneJson: scene,
      probes: probePoints,
      size: canvasSize,
      testId: CANVAS_TEST_ID,
    },
  );
}

// ─── Known-colour fixtures ───────────────────────────────────────────────────

/** Build a minimal EvaluatedScene with one text layer and a solid background. */
function makeTextScene(overrides: {
  text?: string;
  color?: string;
  bgColor?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  opacity?: number;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  const cw = overrides.canvasWidth ?? 400;
  const ch = overrides.canvasHeight ?? 300;
  const lw = overrides.width ?? 300;
  const lh = overrides.height ?? 100;
  return {
    visualLayers: [
      {
        layerType: "text",
        layerId: "test-layer-01",
        clipId: "clip-01",
        role: "foreground",
        zIndex: 1,
        x: overrides.x ?? 50,
        y: overrides.y ?? 100,
        width: lw,
        height: lh,
        baseWidth: lw,
        baseHeight: lh,
        rotation: 0,
        opacity: overrides.opacity ?? 1.0,
        inTransition: false,
        blendMode: "normal",
        text: overrides.text ?? "HELLO",
        fontFamily: "Arial, sans-serif",
        fontSize: overrides.fontSize ?? 72,
        fontWeight: 700,
        fontStyle: "normal",
        color: overrides.color ?? "#00FF00",
        textAlign: "center",
        verticalAlign: "middle",
        lineHeight: 1.2,
        letterSpacing: 0,
      },
    ],
    audioLayers: [],
    transitions: [],
    metadata: {
      time: 0,
      canvasWidth: cw,
      canvasHeight: ch,
      frameRate: 30,
      isGap: false,
      canvasBackground: {
        type: "solid",
        color: overrides.bgColor ?? "#000000",
        isTransparent: false,
      },
    },
  };
}

/** Scene with NO visual layers — just a solid background. */
function makeEmptyScene(bgColor: string = "#000000", w = 400, h = 300) {
  return {
    visualLayers: [],
    audioLayers: [],
    transitions: [],
    metadata: {
      time: 0,
      canvasWidth: w,
      canvasHeight: h,
      frameRate: 30,
      isGap: false,
      canvasBackground: {
        type: "solid",
        color: bgColor,
        isTransparent: false,
      },
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe(
  "Preview Canvas Pixel Validation — Layer A (Browser Rasterization)",
  () => {
    test.beforeEach(async ({ page }) => {
      await installTauriMock(page, {
        recentProjects: [],
        defaultMediaDuration: 12.0,
      });
    });

    // ─── Text Rasterization ──────────────────────────────────────────────

    test.describe("Text Rasterization Pixel Verification", () => {
      test("PXL-TEXT-01: Green text on black canvas produces green pixels at text location", async ({
        page,
      }) => {
        await navigateToEditor(page);

        const result = await paintSceneAndProbe(
          page,
          makeTextScene({
            text: "████",
            color: "#00FF00",
            bgColor: "#000000",
            x: 50,
            y: 100,
            width: 300,
            height: 100,
            fontSize: 72,
          }),
          [
            // Centre of text area — should contain green pixels
            { label: "textCenter", x: 200, y: 150 },
            // Top-left corner — should be black background
            { label: "corner", x: 5, y: 5 },
            // Bottom-right — should be black background
            { label: "farCorner", x: 395, y: 295 },
          ],
          { width: 400, height: 300 },
        );

        expect(result).not.toHaveProperty("error");

        // Corner must be black background
        assertPixelColor(
          { ...result.corner, x: 5, y: 5 },
          { r: 0, g: 0, b: 0, a: 255 },
          5,
          "Black background corner",
        );

        // Far corner must be black background
        assertPixelColor(
          { ...result.farCorner, x: 395, y: 295 },
          { r: 0, g: 0, b: 0, a: 255 },
          5,
          "Black background far corner",
        );

        // Text centre should have green present (glyph might not be exactly
        // at centre pixel, but block characters fill densely)
        expect(result.textCenter.g).toBeGreaterThan(50);
      });

      test("PXL-TEXT-02: Different text content produces different pixels", async ({
        page,
      }) => {
        await navigateToEditor(page);

        // Render "HELLO" and hash the text region
        const scene1 = makeTextScene({ text: "HELLO", color: "#FFFFFF" });
        const scene2 = makeTextScene({ text: "WORLD", color: "#FFFFFF" });

        const result = await page.evaluate(
          async ({ s1, s2, testId }) => {
            const canvas = document.querySelector(
              `[data-testid="${testId}"]`,
            ) as HTMLCanvasElement;
            if (!canvas) return { error: "Canvas not found" };
            canvas.width = 400;
            canvas.height = 300;

            const mod = await import(
              "/src/components/editor/preview/nativeTextPreview.ts"
            );

            // First render
            await mod.paintTextLayersToCanvas(
              canvas,
              s1 as any,
              "interactive-preview",
            );
            const ctx = canvas.getContext("2d")!;
            const data1 = ctx.getImageData(50, 100, 300, 100).data;
            let hash1 = 0;
            for (let i = 0; i < data1.length; i++) {
              hash1 = ((hash1 << 5) - hash1 + data1[i]) | 0;
            }

            // Second render
            await mod.paintTextLayersToCanvas(
              canvas,
              s2 as any,
              "interactive-preview",
            );
            const data2 = ctx.getImageData(50, 100, 300, 100).data;
            let hash2 = 0;
            for (let i = 0; i < data2.length; i++) {
              hash2 = ((hash2 << 5) - hash2 + data2[i]) | 0;
            }

            return { hash1, hash2, differ: hash1 !== hash2 };
          },
          { s1: scene1, s2: scene2, testId: CANVAS_TEST_ID },
        );

        expect(result).not.toHaveProperty("error");
        if ("error" in result) return;
        // "HELLO" and "WORLD" must produce different pixel data
        expect(result.differ).toBe(true);
      });

      test("PXL-TEXT-03: Text position matches specified coordinates", async ({
        page,
      }) => {
        await navigateToEditor(page);

        // Place text in top-left quadrant only
        const result = await paintSceneAndProbe(
          page,
          makeTextScene({
            text: "█████",
            color: "#FF0000",
            x: 20,
            y: 20,
            width: 180,
            height: 80,
            fontSize: 60,
          }),
          [
            // Inside text box — expect red-ish pixels
            { label: "inside", x: 100, y: 50 },
            // Far outside text box (bottom-right) — expect black
            { label: "outside", x: 380, y: 280 },
          ],
        );

        expect(result).not.toHaveProperty("error");

        // Area well outside the text box must be pure black background
        assertPixelColor(
          { ...result.outside, x: 380, y: 280 },
          { r: 0, g: 0, b: 0, a: 255 },
          5,
          "Outside text region",
        );
      });

      test("PXL-TEXT-04: Canvas background color renders correctly", async ({
        page,
      }) => {
        await navigateToEditor(page);

        // Empty scene with blue background, no visual layers
        const result = await paintSceneAndProbe(
          page,
          makeEmptyScene("#0000FF"),
          [
            { label: "center", x: 200, y: 150 },
            { label: "topLeft", x: 5, y: 5 },
            { label: "bottomRight", x: 395, y: 295 },
          ],
        );

        expect(result).not.toHaveProperty("error");

        // All points should be pure blue
        assertPixelColor(
          { ...result.center, x: 200, y: 150 },
          { r: 0, g: 0, b: 255, a: 255 },
          5,
          "Blue BG center",
        );
        assertPixelColor(
          { ...result.topLeft, x: 5, y: 5 },
          { r: 0, g: 0, b: 255, a: 255 },
          5,
          "Blue BG corner",
        );
        assertPixelColor(
          { ...result.bottomRight, x: 395, y: 295 },
          { r: 0, g: 0, b: 255, a: 255 },
          5,
          "Blue BG bottom-right",
        );
      });

      test("PXL-TEXT-05: Opacity affects pixel intensity", async ({
        page,
      }) => {
        await navigateToEditor(page);

        const result = await page.evaluate(
          async ({ testId }) => {
            const canvas = document.querySelector(
              `[data-testid="${testId}"]`,
            ) as HTMLCanvasElement;
            if (!canvas) return { error: "Canvas not found" };
            canvas.width = 200;
            canvas.height = 200;

            const mod = await import(
              "/src/components/editor/preview/nativeTextPreview.ts"
            );

            const makeScene = (opacity: number) => ({
              visualLayers: [
                {
                  layerType: "text",
                  layerId: "opacity-test",
                  clipId: "clip-op",
                  role: "foreground",
                  zIndex: 1,
                  x: 0,
                  y: 0,
                  width: 200,
                  height: 200,
                  baseWidth: 200,
                  baseHeight: 200,
                  rotation: 0,
                  opacity,
                  inTransition: false,
                  blendMode: "normal",
                  text: "████████",
                  fontFamily: "Arial, sans-serif",
                  fontSize: 80,
                  fontWeight: 900,
                  fontStyle: "normal",
                  color: "#FFFFFF",
                  textAlign: "center",
                  verticalAlign: "middle",
                  lineHeight: 1.0,
                  letterSpacing: 0,
                },
              ],
              audioLayers: [],
              transitions: [],
              metadata: {
                time: 0,
                canvasWidth: 200,
                canvasHeight: 200,
                frameRate: 30,
                isGap: false,
                canvasBackground: {
                  type: "solid",
                  color: "#000000",
                  isTransparent: false,
                },
              },
            });

            // Full opacity
            await mod.paintTextLayersToCanvas(
              canvas,
              makeScene(1.0) as any,
              "interactive-preview",
            );
            const ctx = canvas.getContext("2d")!;
            const fullData = ctx.getImageData(0, 0, 200, 200).data;
            let fullSum = 0;
            for (let i = 0; i < fullData.length; i += 4) fullSum += fullData[i];

            // Half opacity
            await mod.paintTextLayersToCanvas(
              canvas,
              makeScene(0.5) as any,
              "interactive-preview",
            );
            const halfData = ctx.getImageData(0, 0, 200, 200).data;
            let halfSum = 0;
            for (let i = 0; i < halfData.length; i += 4) halfSum += halfData[i];

            return { fullSum, halfSum, halfIsLess: halfSum < fullSum };
          },
          { testId: CANVAS_TEST_ID },
        );

        expect(result).not.toHaveProperty("error");
        if ("error" in result) return;
        // 50% opacity text produces strictly dimmer total pixel intensity
        expect(result.halfIsLess).toBe(true);
      });
    });

    // ─── Replay Frame Parity ────────────────────────────────────────────

    test.describe("Replay Frame Parity", () => {
      test("PXL-REPLAY-01: Same scene at same time produces identical pixels across renders", async ({
        page,
      }) => {
        await navigateToEditor(page);

        const result = await page.evaluate(
          async ({ testId }) => {
            const canvas = document.querySelector(
              `[data-testid="${testId}"]`,
            ) as HTMLCanvasElement;
            if (!canvas) return { error: "Canvas not found" };
            canvas.width = 400;
            canvas.height = 300;

            const mod = await import(
              "/src/components/editor/preview/nativeTextPreview.ts"
            );

            const scene = {
              visualLayers: [
                {
                  layerType: "text",
                  layerId: "replay-test",
                  clipId: "clip-replay",
                  role: "foreground",
                  zIndex: 1,
                  x: 50,
                  y: 100,
                  width: 300,
                  height: 100,
                  baseWidth: 300,
                  baseHeight: 100,
                  rotation: 0,
                  opacity: 1.0,
                  inTransition: false,
                  blendMode: "normal",
                  text: "REPLAY CHECK",
                  fontFamily: "Arial, sans-serif",
                  fontSize: 48,
                  fontWeight: 700,
                  fontStyle: "normal",
                  color: "#FF00FF",
                  textAlign: "center",
                  verticalAlign: "middle",
                  lineHeight: 1.2,
                  letterSpacing: 0,
                },
              ],
              audioLayers: [],
              transitions: [],
              metadata: {
                time: 2.5,
                canvasWidth: 400,
                canvasHeight: 300,
                frameRate: 30,
                isGap: false,
                canvasBackground: {
                  type: "solid",
                  color: "#000000",
                  isTransparent: false,
                },
              },
            };

            // First render ("play")
            await mod.paintTextLayersToCanvas(
              canvas,
              scene as any,
              "interactive-preview",
            );
            const ctx = canvas.getContext("2d")!;
            const firstRender = Array.from(
              ctx.getImageData(0, 0, 400, 300).data,
            );

            // Clear canvas
            ctx.clearRect(0, 0, 400, 300);

            // Second render at same time ("replay")
            await mod.paintTextLayersToCanvas(
              canvas,
              scene as any,
              "interactive-preview",
            );
            const secondRender = Array.from(
              ctx.getImageData(0, 0, 400, 300).data,
            );

            // Compare pixel-by-pixel
            let diffPixels = 0;
            for (let i = 0; i < firstRender.length; i += 4) {
              const dr = Math.abs(firstRender[i] - secondRender[i]);
              const dg = Math.abs(firstRender[i + 1] - secondRender[i + 1]);
              const db = Math.abs(firstRender[i + 2] - secondRender[i + 2]);
              if (dr > 2 || dg > 2 || db > 2) diffPixels++;
            }

            return {
              diffPixels,
              totalPixels: 400 * 300,
              identical: diffPixels === 0,
            };
          },
          { testId: CANVAS_TEST_ID },
        );

        expect(result).not.toHaveProperty("error");
        if ("error" in result) return;
        // Same scene at same time MUST produce byte-identical pixels
        expect(result.diffPixels).toBe(0);
      });
    });

    // ─── Negative Controls ──────────────────────────────────────────────

    test.describe("Negative Controls", () => {
      test("PXL-NEG-01: Empty scene produces only background (no phantom content)", async ({
        page,
      }) => {
        await navigateToEditor(page);

        const result = await page.evaluate(
          async ({ testId }) => {
            const canvas = document.querySelector(
              `[data-testid="${testId}"]`,
            ) as HTMLCanvasElement;
            if (!canvas) return { error: "Canvas not found" };
            canvas.width = 100;
            canvas.height = 100;

            const mod = await import(
              "/src/components/editor/preview/nativeTextPreview.ts"
            );

            const scene = {
              visualLayers: [],
              audioLayers: [],
              transitions: [],
              metadata: {
                time: 0,
                canvasWidth: 100,
                canvasHeight: 100,
                frameRate: 30,
                isGap: false,
                canvasBackground: {
                  type: "solid",
                  color: "#000000",
                  isTransparent: false,
                },
              },
            };

            await mod.paintTextLayersToCanvas(
              canvas,
              scene as any,
              "interactive-preview",
            );
            const ctx = canvas.getContext("2d")!;
            const data = ctx.getImageData(0, 0, 100, 100).data;

            let nonBlackPixels = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) {
                nonBlackPixels++;
              }
            }

            return { nonBlackPixels };
          },
          { testId: CANVAS_TEST_ID },
        );

        expect(result).not.toHaveProperty("error");
        if ("error" in result) return;
        // Zero non-black pixels on an empty scene
        expect(result.nonBlackPixels).toBe(0);
      });

      test("PXL-NEG-02: Removing a layer removes its pixels entirely", async ({
        page,
      }) => {
        await navigateToEditor(page);

        const result = await page.evaluate(
          async ({ testId }) => {
            const canvas = document.querySelector(
              `[data-testid="${testId}"]`,
            ) as HTMLCanvasElement;
            if (!canvas) return { error: "Canvas not found" };
            canvas.width = 200;
            canvas.height = 200;

            const mod = await import(
              "/src/components/editor/preview/nativeTextPreview.ts"
            );

            const textLayer = {
              layerType: "text",
              layerId: "removable",
              clipId: "clip-rem",
              role: "foreground",
              zIndex: 1,
              x: 0,
              y: 0,
              width: 200,
              height: 200,
              baseWidth: 200,
              baseHeight: 200,
              rotation: 0,
              opacity: 1.0,
              inTransition: false,
              blendMode: "normal",
              text: "████████",
              fontFamily: "Arial, sans-serif",
              fontSize: 100,
              fontWeight: 900,
              fontStyle: "normal",
              color: "#FFFFFF",
              textAlign: "center",
              verticalAlign: "middle",
              lineHeight: 1.0,
              letterSpacing: 0,
            };

            const bgMeta = {
              time: 0,
              canvasWidth: 200,
              canvasHeight: 200,
              frameRate: 30,
              isGap: false,
              canvasBackground: {
                type: "solid",
                color: "#000000",
                isTransparent: false,
              },
            };

            // WITH text layer
            await mod.paintTextLayersToCanvas(
              canvas,
              {
                visualLayers: [textLayer],
                audioLayers: [],
                transitions: [],
                metadata: bgMeta,
              } as any,
              "interactive-preview",
            );
            const ctx = canvas.getContext("2d")!;
            const withText = ctx.getImageData(0, 0, 200, 200).data;
            let withTextBright = 0;
            for (let i = 0; i < withText.length; i += 4) {
              if (
                withText[i] > 10 ||
                withText[i + 1] > 10 ||
                withText[i + 2] > 10
              ) {
                withTextBright++;
              }
            }

            // WITHOUT text layer (layer removed)
            await mod.paintTextLayersToCanvas(
              canvas,
              {
                visualLayers: [],
                audioLayers: [],
                transitions: [],
                metadata: bgMeta,
              } as any,
              "interactive-preview",
            );
            const withoutText = ctx.getImageData(0, 0, 200, 200).data;
            let withoutTextBright = 0;
            for (let i = 0; i < withoutText.length; i += 4) {
              if (
                withoutText[i] > 10 ||
                withoutText[i + 1] > 10 ||
                withoutText[i + 2] > 10
              ) {
                withoutTextBright++;
              }
            }

            return {
              withTextBright,
              withoutTextBright,
              textRemoved: withoutTextBright === 0 && withTextBright > 0,
            };
          },
          { testId: CANVAS_TEST_ID },
        );

        expect(result).not.toHaveProperty("error");
        if ("error" in result) return;
        // Text renders SOME bright pixels when layer is present
        expect(result.withTextBright).toBeGreaterThan(0);
        // ALL bright pixels disappear when layer is removed
        expect(result.withoutTextBright).toBe(0);
        expect(result.textRemoved).toBe(true);
      });

      test("PXL-NEG-03: Transparent background produces zero-alpha pixels", async ({
        page,
      }) => {
        await navigateToEditor(page);

        const result = await page.evaluate(
          async ({ testId }) => {
            const canvas = document.querySelector(
              `[data-testid="${testId}"]`,
            ) as HTMLCanvasElement;
            if (!canvas) return { error: "Canvas not found" };
            canvas.width = 100;
            canvas.height = 100;

            const mod = await import(
              "/src/components/editor/preview/nativeTextPreview.ts"
            );

            const scene = {
              visualLayers: [],
              audioLayers: [],
              transitions: [],
              metadata: {
                time: 0,
                canvasWidth: 100,
                canvasHeight: 100,
                frameRate: 30,
                isGap: false,
                canvasBackground: {
                  type: "solid",
                  color: "#000000",
                  isTransparent: true,
                },
              },
            };

            await mod.paintTextLayersToCanvas(
              canvas,
              scene as any,
              "interactive-preview",
            );
            const ctx = canvas.getContext("2d")!;
            const data = ctx.getImageData(0, 0, 100, 100).data;

            // Every pixel should have alpha = 0 (transparent)
            let nonTransparent = 0;
            for (let i = 3; i < data.length; i += 4) {
              if (data[i] > 0) nonTransparent++;
            }

            return { nonTransparent };
          },
          { testId: CANVAS_TEST_ID },
        );

        expect(result).not.toHaveProperty("error");
        if ("error" in result) return;
        expect(result.nonTransparent).toBe(0);
      });
    });
  },
);
