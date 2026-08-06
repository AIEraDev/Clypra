import { beforeAll, afterAll, describe, test, expect, vi } from "vitest";
import { renderTextEffect, renderTextEffectToDataURL, renderTextEffectAsync } from "../renderer";
import { TextEffectDefinition } from "../types/types";
import { _buildConfig } from "@clypra-studio/engine";
const SolarisInkDefinition: TextEffectDefinition = {
  id: "solaris-ink",
  name: "Solaris Ink",
  category: "metallic",
  description: "Solaris Ink text effect",
  tags: ["solar", "ink"],
  font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
  fills: [{ type: "solid", color: "#FFA751" }],
  strokes: [{ color: "#FFA751", width: 2, position: "outside", opacity: 1 }],
  shadows: [],
  glows: [],
};

const BiolumeTrenchDefinition: TextEffectDefinition = {
  id: "biolume-trench",
  name: "Biolume Trench",
  category: "gradient",
  description: "Biolume Trench text effect",
  tags: ["biolume", "trench"],
  font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
  fills: [{ type: "solid", color: "#FFE259" }],
  strokes: [{ color: "#FFA751", width: 2, position: "outside", opacity: 1 }],
  shadows: [],
  glows: [],
};

const BitDecayDefinition: TextEffectDefinition = {
  id: "bit-decay",
  name: "Bit Decay",
  category: "retro",
  description: "Bit Decay text effect",
  tags: ["bit", "decay"],
  font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
  fills: [{ type: "solid", color: "#FFE259" }],
  strokes: [{ color: "#FFA751", width: 2, position: "outside", opacity: 1 }],
  shadows: [],
};

const NeonCrimsonDefinition: TextEffectDefinition = {
  id: "neon-crimson",
  name: "NeonCrimson",
  category: "neon",
  description: "Neon Crimson text effect",
  tags: ["neon", "crimson"],
  font: { family: "Inter", weight: 700, style: "normal", letterSpacing: 0, lineHeight: 1.2 },
  fills: [],
  strokes: [{ color: "#FFA751", width: 2, position: "outside", opacity: 1 }],
  shadows: [],
  glows: [],
};

const moltenGold3d: TextEffectDefinition = {
  id: "molten-gold-3d",
  name: "Molten Gold 3D",
  category: "metallic",
  description: "3D golden metallic text style",
  tags: ["gold", "metal", "3d"],
  font: {
    family: "Outfit",
    weight: 800,
    style: "normal",
    letterSpacing: 2,
    lineHeight: 1.2,
  },
  fills: [
    {
      type: "linear",
      gradient: {
        angle: 90,
        stops: [
          { color: "#FFE259", offset: 0 },
          { color: "#FFA751", offset: 100 },
        ],
      },
    },
  ],
  strokes: [{ color: "#FFA751", width: 2, position: "outside", opacity: 1 }],
  shadows: [{ type: "drop", color: "rgba(0,0,0,0.5)", blur: 4, offsetX: 2, offsetY: 2, opacity: 1 }],
  bevel: {
    depth: 8,
    highlightColor: "#FFFFFF",
    shadowColor: "#000000",
  },
};

const glitchCorrupt: TextEffectDefinition = {
  id: "glitch-corrupt",
  name: "Glitch Corrupt",
  category: "glitch",
  description: "High-intensity glitch effect",
  tags: ["glitch", "sci-fi"],
  font: {
    family: "Courier New",
    weight: 700,
    style: "normal",
    letterSpacing: 0,
    lineHeight: 1.2,
  },
  fills: [{ type: "solid", color: "#FFFFFF" }],
  strokes: [],
  shadows: [],
};

const mockEffects = [moltenGold3d, glitchCorrupt];

describe("text effect config builder", () => {
  test("uses runtime layout values instead of raw flat definition layout keys", () => {
    const effect = {
      ...NeonCrimsonDefinition,
      fontSize: 100,
      canvasWidth: 800,
      canvasHeight: 200,
      strokeWidth: 20,
      customRenderer: "InkBrushEngine",
      inkColor: "#FF174D",
    } as TextEffectDefinition & Record<string, unknown>;

    const config = _buildConfig(effect, "NEON", 75, 600, 200);

    expect(config.fontSize).toBe(75);
    expect(config.canvasWidth).toBe(600);
    expect(config.canvasHeight).toBe(200);
    expect(config.strokeWidth).toBe(1.5);
    expect(config.customRenderer).toBe("InkBrushEngine");
    expect(config.inkColor).toBe("#FF174D");
  });
});

// Mock canvas rendering context 2D
const mockCtx = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  drawImage: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  bezierCurveTo: vi.fn(),
  arc: vi.fn(),
  closePath: vi.fn(),
  strokeRect: vi.fn(),
  createImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(800 * 400 * 4),
  })),
  createLinearGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  createConicGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  getImageData: vi.fn(() => ({
    data: new Uint8ClampedArray(800 * 400 * 4),
  })),
  putImageData: vi.fn(),
  measureText: vi.fn(() => ({ width: 120 })),
  imageSmoothingEnabled: true,
  font: "",
  textBaseline: "",
  textAlign: "",
  letterSpacing: "",
  shadowColor: "",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  strokeStyle: "",
  lineWidth: 0,
  lineJoin: "",
  fillStyle: "",
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
};

beforeAll(() => {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      complete = true;
      onload = () => {};
    },
  );

  HTMLCanvasElement.prototype.getContext = vi.fn((type) => {
    if (type === "2d") return mockCtx as any;
    return null;
  });

  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,mockedDataURL");

  const mockFonts = {
    check: vi.fn(() => true),
    load: vi.fn(() => Promise.resolve()),
    ready: Promise.resolve(),
  };
  if (typeof document !== "undefined") {
    // @ts-ignore
    document.fonts = mockFonts;
  } else {
    // @ts-ignore
    global.document = { fonts: mockFonts };
  }
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("Clypra Text Effects Engine & Presets", () => {
  test("All mock effect definitions have unique IDs", () => {
    const ids = mockEffects.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(2);
    expect(uniqueIds.size).toBe(2);
  });

  test("All mock effect definitions compile with correct category mappings", () => {
    mockEffects.forEach((effect) => {
      expect(effect.id).toBeDefined();
      expect(effect.name).toBeDefined();
      expect(effect.category).toBeDefined();
      expect(Array.isArray(effect.tags)).toBe(true);
      expect(effect.font).toBeDefined();
      expect(Array.isArray(effect.fills)).toBe(true);
      expect(Array.isArray(effect.strokes)).toBe(true);
      expect(Array.isArray(effect.shadows)).toBe(true);
    });
  });

  test("renderTextEffect executes without throwing for all mock presets", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 400;

    mockEffects.forEach((effect) => {
      expect(() => {
        renderTextEffect(canvas, "Clypra Test", effect, 48);
      }).not.toThrow();
    });
  });

  test("renderTextEffectToDataURL generates a valid base64 PNG data URL", () => {
    const dataURL = renderTextEffectToDataURL("Export Preview", moltenGold3d, 48, 800, 400);
    expect(dataURL).toBeDefined();
    expect(typeof dataURL).toBe("string");
    expect(dataURL.startsWith("data:image/png;base64,")).toBe(true);
  });

  describe("Solaris Ink Engine", () => {
    test("SolarisInkDefinition has correct shape and id", () => {
      expect(SolarisInkDefinition.id).toBe("solaris-ink");
      expect(SolarisInkDefinition.name).toBe("Solaris Ink");
      expect(Array.isArray(SolarisInkDefinition.fills)).toBe(true);
      expect(Array.isArray(SolarisInkDefinition.strokes)).toBe(true);
      expect(Array.isArray(SolarisInkDefinition.glows)).toBe(true);
    });

    test("Solaris Ink renderTextEffect executes without throwing", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      expect(() => {
        renderTextEffect(canvas, "CLYPRA", SolarisInkDefinition, 85);
      }).not.toThrow();
    });

    test("Solaris Ink renderer calls clearRect and fillText", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.clearRect.mockClear();
      mockCtx.fillText.mockClear();
      mockCtx.strokeText.mockClear();

      renderTextEffect(canvas, "CLYPRA", SolarisInkDefinition, 85);

      // The engine must clear its canvas at the start of drawFrame
      expect(mockCtx.clearRect).toHaveBeenCalled();
      // With a solid fill, fillText must be called at least once
      expect(mockCtx.fillText).toHaveBeenCalled();
    });

    test("Solaris Ink renderer calls strokeText when stroke is enabled", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.strokeText.mockClear();

      // SolarisInkDefinition has a stroke defined
      renderTextEffect(canvas, "CLYPRA", SolarisInkDefinition, 85);

      expect(mockCtx.strokeText).toHaveBeenCalled();
    });

    test("Solaris Ink renderTextEffectToDataURL returns valid PNG data URL", () => {
      const dataURL = renderTextEffectToDataURL("CLYPRA", SolarisInkDefinition, 85, 800, 400);
      expect(dataURL).toBeDefined();
      expect(typeof dataURL).toBe("string");
      expect(dataURL.startsWith("data:image/png;base64,")).toBe(true);
    });
  });

  describe("Biolume Trench Engine", () => {
    test("BiolumeTrenchDefinition has correct shape and id", () => {
      expect(BiolumeTrenchDefinition.id).toBe("biolume-trench");
      expect(BiolumeTrenchDefinition.name).toBe("Biolume Trench");
      expect(Array.isArray(BiolumeTrenchDefinition.fills)).toBe(true);
      expect(Array.isArray(BiolumeTrenchDefinition.strokes)).toBe(true);
      expect(Array.isArray(BiolumeTrenchDefinition.glows)).toBe(true);
    });

    test("Biolume Trench renderTextEffect executes without throwing", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      expect(() => {
        renderTextEffect(canvas, "CLYPRA", BiolumeTrenchDefinition, 85);
      }).not.toThrow();
    });

    test("Biolume Trench renderer calls clearRect and fillText", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.clearRect.mockClear();
      mockCtx.fillText.mockClear();
      mockCtx.strokeText.mockClear();

      renderTextEffect(canvas, "CLYPRA", BiolumeTrenchDefinition, 85);

      // The engine must clear its canvas at the start of drawFrame
      expect(mockCtx.clearRect).toHaveBeenCalled();
      // With a linear fill, fillText must be called at least once
      expect(mockCtx.fillText).toHaveBeenCalled();
    });

    test("Biolume Trench renderer calls strokeText when stroke is enabled", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.strokeText.mockClear();

      // BiolumeTrenchDefinition has a stroke defined
      renderTextEffect(canvas, "CLYPRA", BiolumeTrenchDefinition, 85);

      expect(mockCtx.strokeText).toHaveBeenCalled();
    });

    test("Biolume Trench renderTextEffectToDataURL returns valid PNG data URL", () => {
      const dataURL = renderTextEffectToDataURL("CLYPRA", BiolumeTrenchDefinition, 85, 800, 400);
      expect(dataURL).toBeDefined();
      expect(typeof dataURL).toBe("string");
      expect(dataURL.startsWith("data:image/png;base64,")).toBe(true);
    });
  });

  describe("Bit Decay Engine", () => {
    test("BitDecayDefinition has correct shape and id", () => {
      expect(BitDecayDefinition.id).toBe("bit-decay");
      expect(BitDecayDefinition.name).toBe("Bit Decay");
      expect(Array.isArray(BitDecayDefinition.fills)).toBe(true);
      expect(Array.isArray(BitDecayDefinition.strokes)).toBe(true);
    });

    test("Bit Decay renderTextEffect executes without throwing", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      expect(() => {
        renderTextEffect(canvas, "CLYPRA", BitDecayDefinition, 85);
      }).not.toThrow();
    });

    test("Bit Decay renderer calls clearRect and fillText", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.clearRect.mockClear();
      mockCtx.fillText.mockClear();
      mockCtx.strokeText.mockClear();

      renderTextEffect(canvas, "CLYPRA", BitDecayDefinition, 85);

      // The engine must clear its canvas at the start of drawFrame
      expect(mockCtx.clearRect).toHaveBeenCalled();
      // With a solid fill, fillText must be called at least once
      expect(mockCtx.fillText).toHaveBeenCalled();
    });

    test("Bit Decay renderer calls strokeText when stroke is enabled", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.strokeText.mockClear();

      // BitDecayDefinition has a stroke defined
      renderTextEffect(canvas, "CLYPRA", BitDecayDefinition, 85);

      expect(mockCtx.strokeText).toHaveBeenCalled();
    });

    test("Bit Decay renderTextEffectToDataURL returns valid PNG data URL", () => {
      const dataURL = renderTextEffectToDataURL("CLYPRA", BitDecayDefinition, 85, 800, 400);
      expect(dataURL).toBeDefined();
      expect(typeof dataURL).toBe("string");
      expect(dataURL.startsWith("data:image/png;base64,")).toBe(true);
    });
  });

  describe("Neon Crimson Engine", () => {
    test("NeonCrimsonDefinition has correct shape and id", () => {
      expect(NeonCrimsonDefinition.id).toBe("neon-crimson");
      expect(NeonCrimsonDefinition.name).toBe("NeonCrimson");
      expect(Array.isArray(NeonCrimsonDefinition.strokes)).toBe(true);
      expect(Array.isArray(NeonCrimsonDefinition.glows)).toBe(true);
    });

    test("Neon Crimson renderTextEffect executes without throwing", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      expect(() => {
        renderTextEffect(canvas, "CLYPRA", NeonCrimsonDefinition, 85);
      }).not.toThrow();
    });

    test("Neon Crimson renderer calls clearRect", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.clearRect.mockClear();

      renderTextEffect(canvas, "CLYPRA", NeonCrimsonDefinition, 85);

      // The engine must clear its canvas at the start of drawFrame
      expect(mockCtx.clearRect).toHaveBeenCalled();
    });

    test("Neon Crimson renderer calls strokeText when stroke is enabled", () => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 400;

      mockCtx.strokeText.mockClear();

      // NeonCrimsonDefinition has a stroke defined
      renderTextEffect(canvas, "CLYPRA", NeonCrimsonDefinition, 85);

      expect(mockCtx.strokeText).toHaveBeenCalled();
    });

    test("Neon Crimson renderTextEffectToDataURL returns valid PNG data URL", () => {
      const dataURL = renderTextEffectToDataURL("CLYPRA", NeonCrimsonDefinition, 85, 800, 400);
      expect(dataURL).toBeDefined();
      expect(typeof dataURL).toBe("string");
      expect(dataURL.startsWith("data:image/png;base64,")).toBe(true);
    });
  });

  describe("renderTextEffectAsync", () => {
    test("should load fonts and render without throwing", async () => {
      const canvas = document.createElement("canvas");
      await expect(renderTextEffectAsync(canvas, "CLYPRA", SolarisInkDefinition, 48)).resolves.not.toThrow();
    });
  });
});
