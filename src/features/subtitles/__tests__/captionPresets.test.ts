import { describe, it, expect } from "vitest";
import { CAPTION_STYLE_PRESETS, getCaptionPresetById } from "../captionPresets";
import { getUnifiedCaptionTemplates, textEffectToCaptionTemplate } from "../captionStyles";
import type { TemplateDefinition } from "@/features/text-templates/types";

describe("Caption Style Presets & Batch Formatting System", () => {
  it("defines 4 built-in caption style presets", () => {
    expect(CAPTION_STYLE_PRESETS).toHaveLength(4);
  });

  it("retrieves Yellow Bold caption preset correctly", () => {
    const yellow = getCaptionPresetById("yellow-bold");
    expect(yellow).toBeDefined();
    expect(yellow?.fillColor).toBe("#FFE600");
    expect(yellow?.strokeColor).toBe("#000000");
    expect(yellow?.bold).toBe(true);
  });

  it("retrieves High-Contrast Box preset with background color", () => {
    const box = getCaptionPresetById("black-box");
    expect(box).toBeDefined();
    expect(box?.backgroundColor).toBeDefined();
    expect(box?.fillColor).toBe("#FFFFFF");
  });
});

describe("getUnifiedCaptionTemplates (Strictly Fetched-Only Policy)", () => {
  it("returns an empty array when no templates have been fetched from the cloud API", () => {
    const emptyResult = getUnifiedCaptionTemplates([]);
    expect(emptyResult).toEqual([]);
    expect(emptyResult).toHaveLength(0);
  });

  it("returns an empty array when called with undefined / default argument", () => {
    const defaultResult = getUnifiedCaptionTemplates();
    expect(defaultResult).toEqual([]);
    expect(defaultResult).toHaveLength(0);
  });

  it("returns only cloud-fetched templates without injecting built-in presets", () => {
    const mockCloudTemplates: TemplateDefinition[] = [
      {
        id: "custom-cloud-caption-1",
        category: "caption",
        name: "My Custom Brand Caption",
        canvasWidth: 1920,
        canvasHeight: 1080,
        duration: 4,
        layers: [],
      },
    ];

    const result = getUnifiedCaptionTemplates(mockCloudTemplates);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("custom-cloud-caption-1");
    expect(result[0].name).toBe("My Custom Brand Caption");

    // Ensure built-in presets are NOT present
    const builtinIds = ["classic-yellow", "punchy-bold", "karaoke-pill", "cyber-glow"];
    for (const bId of builtinIds) {
      expect(result.some((t) => t.id === bId)).toBe(false);
    }
  });
});

describe("textEffectToCaptionTemplate", () => {
  it("converts a full TextEffect into a first-class TemplateDefinition with pill background and stroke", () => {
    const rawEffect = {
      id: "clean-black-bar-subtitle",
      name: "Clean Black Bar Subtitle",
      category: "caption",
      description: "A clean, high-legibility uppercase subtitle with a semi-transparent dark backing bar.",
      thumbnail: "https://example.com/media/caption.png",
      fontFamily: "Outfit",
      fontWeight: 500,
      fontSize: 24,
      fillColor: "#FFFFFF",
      strokeEnabled: true,
      strokeColor: "#000000",
      strokeWidth: 2,
      shadowEnabled: true,
      shadowColor: "rgba(0,0,0,0.8)",
      shadowBlur: 8,
      shadowOffsetY: 4,
      panelEnabled: true,
      panelColor: "rgb(0, 0, 0)",
      panelRadius: 6,
      panelPaddingX: 16,
      scene: {
        version: 1,
        effectName: "Clean Black Bar Subtitle",
        canvas: { width: 800, height: 200, background: "transparent" },
      },
      revisionId: "rev-12345",
      contentHash: "hash-abcdef",
    };

    const template = textEffectToCaptionTemplate(rawEffect);

    expect(template.id).toBe("clean-black-bar-subtitle");
    expect(template.name).toBe("Clean Black Bar Subtitle");
    expect(template.category).toBe("caption");
    expect(template.thumbnail).toBe("https://example.com/media/caption.png");
    expect(template.isCloud).toBe(true);
    expect(template.isTextEffect).toBe(true);

    // stylePreview check
    expect(template.stylePreview).toBeDefined();
    expect(template.stylePreview.hasPill).toBe(true);
    expect(template.stylePreview.bgColor).toBe("rgb(0, 0, 0)");
    expect(template.stylePreview.bgBorderRadius).toBe(6);
    expect(template.stylePreview.textColor).toBe("#FFFFFF");
    expect(template.stylePreview.strokeColor).toBe("#000000");

    // patch check
    expect(template.patch).toBeDefined();
    expect(template.patch.styleId).toBe("clean-black-bar-subtitle");
    expect(template.patch.styleRevisionId).toBe("rev-12345");
    expect(template.patch.styleContentHash).toBe("hash-abcdef");
    expect(template.patch.styleSnapshot).toEqual(rawEffect.scene);
    expect(template.patch.background).toEqual({
      color: "rgb(0, 0, 0)",
      padding: 16,
      borderRadius: 6,
    });
    expect(template.patch.stroke).toEqual({
      color: "#000000",
      width: 2,
    });
    expect(template.patch.shadow).toEqual({
      color: "rgba(0,0,0,0.8)",
      blur: 8,
      offsetX: 0,
      offsetY: 4,
    });
    expect(template.patch.color).toBe("#FFFFFF");
    expect(template.patch.fontFamily).toBe("Outfit");
  });

  it("handles effect summary with missing scene gracefully", () => {
    const summary = {
      id: "minimal-caption",
      name: "Minimal Caption",
      category: "caption",
      description: "Quick summary",
      thumbnail: "https://example.com/thumb.png",
      fontFamily: "Inter",
      fontWeight: 600,
    };

    const template = textEffectToCaptionTemplate(summary);

    expect(template.id).toBe("minimal-caption");
    expect(template.stylePreview.hasPill).toBe(false);
    expect(template.stylePreview.textColor).toBe("#FFFFFF");
    expect(template.patch.fontFamily).toBe("Inter");
    expect(template.patch.background).toBeUndefined();
  });
});

