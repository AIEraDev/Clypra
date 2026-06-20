import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluatedScene, EvaluatedTextLayer } from "@/core/evaluation/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

const { evaluateSceneSpy } = vi.hoisted(() => ({
  evaluateSceneSpy: vi.fn(),
}));

let mockCanvasAlpha = 255;

vi.mock("@clypra/engine", async () => {
  const actual = await vi.importActual<typeof import("@clypra/engine")>("@clypra/engine");
  return {
    ...actual,
    evaluateScene: evaluateSceneSpy,
  };
});

class MockOffscreenCanvas {
  width: number;
  height: number;
  private ctx: any;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctx = {
      fillStyle: "",
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: true,
      setTransform: vi.fn(),
      scale: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      getImageData: vi.fn(() => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let i = 3; i < data.length; i += 4) data[i] = mockCanvasAlpha;
        return { data, width, height };
      }),
    };
  }

  getContext(type: string) {
    return type === "2d" ? this.ctx : null;
  }
}

globalThis.OffscreenCanvas = MockOffscreenCanvas as any;

describe("rasterizeScene styled text effects", () => {
  beforeEach(() => {
    evaluateSceneSpy.mockReset();
    mockCanvasAlpha = 255;
    useEffectsStore.setState({
      definitions: {
        "hatch-drift": {
          id: "hatch-drift",
          name: "Hatch Drift",
          category: "grunge",
          description: "",
          tags: [],
          font: {
            family: "Bebas Neue",
            weight: 600,
            style: "normal",
            letterSpacing: 5,
            lineHeight: 1.3,
          },
          fills: [
            {
              type: "pattern",
              color: "#000000",
              patternType: "stripes",
              perCharFillEnabled: false,
            },
          ],
          strokes: [
            {
              color: "#FFFFFF",
              width: 10,
              position: "center",
              opacity: 100,
              lineJoin: "miter",
              blur: 0,
              type: "double" as any,
              fadeRange: 100 as any,
            },
          ],
          shadows: [],
        } as any,
      },
      prefetchingIds: new Set(),
    });
  });

  it("preserves Studio-authored pattern fills instead of replacing them with editor defaults", async () => {
    const { rasterizeScene } = await import("../rasterizer");
    const layer: EvaluatedTextLayer = {
      layerId: "layer-1",
      clipId: "clip-1",
      role: "primary",
      zIndex: 0,
      layerType: "text",
      x: 960,
      y: 540,
      width: 700,
      height: 180,
      rotation: 0,
      opacity: 1,
      inTransition: false,
      blendMode: "normal",
      text: "CLYPRA",
      fontFamily: "Inter",
      fontSize: 96,
      color: "#ffffff",
      fontWeight: "normal",
      fontStyle: "normal",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      styleId: "hatch-drift",
    };
    const scene: EvaluatedScene = {
      visualLayers: [layer],
      audioLayers: [],
      transitions: [],
      metadata: {
        time: 0,
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        isGap: false,
      },
    };

    await rasterizeScene(scene, { width: 1920, height: 1080 });

    expect(evaluateSceneSpy).toHaveBeenCalledTimes(1);
    const doc = evaluateSceneSpy.mock.calls[0][0];
    const fillLayer = doc.effectLayers.find((effectLayer: any) => effectLayer.type === "fill");
    const strokeLayer = doc.effectLayers.find((effectLayer: any) => effectLayer.type === "stroke");

    expect(doc.text.fontFamily).toBe("Bebas Neue");
    expect(fillLayer.params.fillType).toBe("pattern");
    expect(fillLayer.params.patternType).toBe("stripes");
    expect(strokeLayer.params.strokeType).toBe("double");
  });

  it("derives render offscreen bounds from content bounds plus effect bleed", async () => {
    const { rasterizeScene } = await import("../rasterizer");
    const layer: EvaluatedTextLayer = {
      layerId: "layer-bleed",
      clipId: "clip-bleed",
      role: "text",
      zIndex: 0,
      layerType: "text",
      x: 100,
      y: 100,
      width: 220,
      height: 80,
      rotation: 0,
      opacity: 1,
      inTransition: false,
      blendMode: "normal",
      text: "CLYPRA",
      fontFamily: "Bebas Neue",
      fontSize: 96,
      color: "#ffffff",
      fontWeight: 600,
      fontStyle: "normal",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 5,
      styleId: "hatch-drift",
    };
    const scene: EvaluatedScene = {
      visualLayers: [layer],
      audioLayers: [],
      transitions: [],
      metadata: {
        time: 0,
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        isGap: false,
      },
    };

    await rasterizeScene(scene, { width: 1920, height: 1080 });

    const doc = evaluateSceneSpy.mock.calls[0][0];
    expect(layer.width).toBe(220);
    expect(layer.height).toBe(80);
    expect(doc.canvas.width).toBeGreaterThan(layer.width);
    expect(doc.canvas.height).toBeGreaterThan(layer.height);
  });

  it("falls back to plain text when a styled effect renders no visible pixels", async () => {
    const { rasterizeScene } = await import("../rasterizer");
    mockCanvasAlpha = 0;
    const layer: EvaluatedTextLayer = {
      layerId: "layer-1",
      clipId: "clip-1",
      role: "primary",
      zIndex: 0,
      layerType: "text",
      x: 960,
      y: 540,
      width: 700,
      height: 180,
      rotation: 0,
      opacity: 1,
      inTransition: false,
      blendMode: "normal",
      text: "CLYPRA",
      fontFamily: "Inter",
      fontSize: 96,
      color: "#ffffff",
      fontWeight: "normal",
      fontStyle: "normal",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      styleId: "hatch-drift",
    };
    const scene: EvaluatedScene = {
      visualLayers: [layer],
      audioLayers: [],
      transitions: [],
      metadata: {
        time: 0,
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        isGap: false,
      },
    };

    await rasterizeScene(scene, { width: 1920, height: 1080 });

    expect(evaluateSceneSpy).toHaveBeenCalledTimes(2);
    const styledDoc = evaluateSceneSpy.mock.calls[0][0];
    const fallbackDoc = evaluateSceneSpy.mock.calls[1][0];

    expect(styledDoc.text.fontFamily).toBe("Bebas Neue");
    expect(fallbackDoc.text.fontFamily).toBe("Inter");
  });

  it("applies template customization overrides including per-layer colors, font sizes, weights and texts", async () => {
    const { useTemplateStore } = await import("@/features/text-templates/templateStore");
    const { TemplateRenderer } = await import("@clypra/engine");
    
    // Spy on updateLayer and mock drawFrame / getContentBounds to avoid canvas rendering dependencies
    const updateLayerSpy = vi.spyOn(TemplateRenderer.prototype, "updateLayer");
    const drawFrameSpy = vi.spyOn(TemplateRenderer.prototype, "drawFrame").mockImplementation(() => {});
    const getContentBoundsSpy = vi.spyOn(TemplateRenderer.prototype, "getContentBounds").mockReturnValue({ x: 0, y: 0, width: 100, height: 100 });


    const mockTemplate = {
      id: "test-template",
      label: "Test Template",
      category: "lower-third" as any,
      duration: 5,
      canvasWidth: 1920,
      canvasHeight: 1080,
      thumbnail: "",
      preview: "",
      layers: [
        {
          kind: "text",
          id: "primary-text",
          content: "Default Title",
          role: "primary",
          fontFamily: "Arial",
          fontSize: 60,
          fontWeight: 700,
          color: "#ffffff",
          x: 100, y: 100, width: 400, height: 100,
          animation: { in: "fade", out: "fade", inDuration: 0.5, outDuration: 0.5, hold: "full" }
        },
        {
          kind: "shape",
          id: "bg-shape",
          shape: "rect",
          fill: "#ff0000",
          x: 100, y: 100, width: 400, height: 100,
          animation: { in: "fade", out: "fade", inDuration: 0.5, outDuration: 0.5, hold: "full" }
        }
      ]
    };

    useTemplateStore.setState({
      templates: [
        {
          id: "test-template",
          label: "Test Template",
          category: "lower-third",
          templateData: mockTemplate
        } as any
      ]
    });

    const { rasterizeScene } = await import("../rasterizer");
    const layer: EvaluatedTextLayer = {
      layerId: "layer-1",
      clipId: "clip-1",
      role: "primary",
      zIndex: 0,
      layerType: "text",
      x: 960,
      y: 540,
      width: 700,
      height: 180,
      rotation: 0,
      opacity: 1,
      inTransition: false,
      blendMode: "normal",
      text: "CLYPRA",
      fontFamily: "Arial",
      fontSize: 96,
      color: "#ffffff",
      fontWeight: "normal",
      fontStyle: "normal",
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.2,
      letterSpacing: 0,
      templateId: "test-template",
      customization: {
        primaryText: "Custom Title",
        primaryColor: "#00ff00",
        layerColors: {
          "bg-shape": "#0000ff"
        },
        layerFontSizes: {
          "primary-text": 72
        },
        layerFontWeights: {
          "primary-text": 900
        }
      }
    };

    const scene: EvaluatedScene = {
      visualLayers: [layer],
      audioLayers: [],
      transitions: [],
      metadata: {
        time: 0,
        canvasWidth: 1920,
        canvasHeight: 1080,
        frameRate: 30,
        isGap: false,
      },
    };

    await rasterizeScene(scene, { width: 1920, height: 1080 });

    expect(updateLayerSpy).toHaveBeenCalled();
    expect(updateLayerSpy).toHaveBeenCalledWith("primary-text", {
      content: "Custom Title",
      color: "#00ff00",
      fontSize: 72,
      fontWeight: 900
    });
    expect(updateLayerSpy).toHaveBeenCalledWith("bg-shape", {
      fill: "#0000ff"
    });

    updateLayerSpy.mockRestore();
    drawFrameSpy.mockRestore();
    getContentBoundsSpy.mockRestore();
  });
});
