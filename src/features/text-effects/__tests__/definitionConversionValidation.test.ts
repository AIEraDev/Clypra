import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { convertConfigToDefinition, convertRawConfigToDefinition, getNativeEffectDimensions } from "../lib/definitionConversion";

describe("Text Effect Definition Conversion Invariants", () => {
  it("converts flat preset configs into structured effect definitions with font defaults", () => {
    const rawPreset = {
      id: "effect-neon",
      name: "Neon Glow",
      category: "Glow",
      config: {
        fontFamily: "Roboto",
        fillType: "solid",
        fillColor: "#00FFFF",
        strokeEnabled: true,
        strokeColor: "#000000",
        strokeWidth: 4,
      },
    };

    const def = convertConfigToDefinition(rawPreset);

    expect(def.id).toBe("effect-neon");
    expect(def.font.family).toBe("Roboto");
    expect(def.fills[0].color).toBe("#00FFFF");
    expect(def.strokes[0].width).toBe(4);
  });

  it("handles raw configs missing font and fills structure by running conversion", () => {
    const rawConfig = {
      id: "raw-1",
      fontFamily: "Inter",
      fillType: "solid",
      fillColor: "#FF00FF",
    };

    const def = convertRawConfigToDefinition(rawConfig);

    expect(def.font).toBeDefined();
    expect(def.font.family).toBe("Inter");
    expect(def.fills).toBeDefined();
    expect(def.fills[0].color).toBe("#FF00FF");
  });

  it("extracts native effect dimensions correctly when provided", () => {
    const effectDef: any = {
      id: "def-1",
      canvasWidth: 1920,
      canvasHeight: 1080,
      fontSize: 72,
    };

    const nativeDims = getNativeEffectDimensions(effectDef);

    expect(nativeDims).toEqual({
      width: 1920,
      height: 1080,
      fontSize: 72,
    });
  });

  it("returns null for native dimensions if any required dimension is missing or invalid", () => {
    expect(getNativeEffectDimensions(undefined)).toBeNull();
    expect(getNativeEffectDimensions({ id: "1" } as any)).toBeNull();
    expect(getNativeEffectDimensions({ canvasWidth: 1920, canvasHeight: 1080 } as any)).toBeNull();
  });

  it("generative property test: convertConfigToDefinition never throws on arbitrary preset inputs", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string(),
          name: fc.string(),
          config: fc.record(
            {
              fontFamily: fc.option(fc.string(), { nil: undefined }),
              fillColor: fc.option(fc.string(), { nil: undefined }),
              strokeEnabled: fc.boolean(),
              shadowEnabled: fc.boolean(),
            },
            { requiredKeys: [] }
          ),
        }),
        (preset) => {
          const result = convertConfigToDefinition(preset);
          expect(result.id).toBe(preset.id);
          expect(result.font).toBeDefined();
          expect(Array.isArray(result.fills)).toBe(true);
        }
      )
    );
  });
});
