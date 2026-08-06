import { describe, it, expect } from "vitest";
import { scaleEffectStackByIntensity } from "../filterStack";
import {
  expandMpgStackEffects,
  mapRendererToV2NodeType,
  isV2SupportedEffectStack,
  buildManifestFromClip,
  type MpgStackNode,
} from "../manifestAdapter";

describe("Multi-Pass Graphics (MPG) Pipeline & V2 Adapter", () => {
  // ─── 1. EFFECT STACK INTENSITY SCALING ───────────────────────────────────
  describe("scaleEffectStackByIntensity", () => {
    it("should scale scalable parameter keys linearly by filter intensity", () => {
      const stack: MpgStackNode[] = [
        {
          type: "Brightness",
          params: { brightness: 0.8, contrast: 0.5, hueRotate: 90 },
        },
      ];

      const scaled50 = scaleEffectStackByIntensity(stack, 0.5);
      expect(scaled50.length).toBe(1);
      expect(scaled50[0].params?.brightness).toBe(0.4);
      expect(scaled50[0].params?.contrast).toBe(0.25);
      expect(scaled50[0].params?.hueRotate).toBe(45);
    });

    it("should clamp intensity values below 0 to 0 and above 1 to 1", () => {
      const stack: MpgStackNode[] = [{ type: "Sepia", params: { sepia: 1.0 } }];

      const scaledNeg = scaleEffectStackByIntensity(stack, -0.5);
      expect(scaledNeg[0].params?.sepia).toBe(0);

      const scaledOver = scaleEffectStackByIntensity(stack, 2.5);
      expect(scaledOver[0].params?.sepia).toBe(1.0);
    });
  });

  // ─── 2. MPG STACK EXPANSION & NODE MAPPING ───────────────────────────────
  describe("expandMpgStackEffects & mapRendererToV2NodeType", () => {
    it("should expand nested 'mpg_stack' presets into individual flat V2 nodes", () => {
      const effects = [
        {
          id: "fx-1",
          type: "mpg_stack",
          params: {
            effectStack: [
              { type: "gaussian_blur", params: { blur: 5 } },
              { type: "contrast", params: { contrast: 1.2 } },
            ],
          },
        },
      ];

      const expanded = expandMpgStackEffects(effects);
      expect(expanded.length).toBe(2);
      expect(expanded[0].id).toBe("fx-1-stack-0");
      expect(expanded[0].type).toBe("gaussian_blur");
      expect(expanded[1].type).toBe("contrast");
    });

    it("should map alias names to standard V2 node types correctly", () => {
      expect(mapRendererToV2NodeType("gaussian_blur")).toBe("GaussianBlur");
      expect(mapRendererToV2NodeType("sepia")).toBe("Sepia");
      expect(mapRendererToV2NodeType("huerotate")).toBe("HueRotate");
      expect(mapRendererToV2NodeType("invalid_type")).toBeNull();
    });

    it("should correctly identify if effect stack is V2 supported", () => {
      const validEffects = [{ id: "1", type: "sepia" }];
      const invalidEffects = [{ id: "2", type: "unsupported_shader_node" }];

      expect(isV2SupportedEffectStack(validEffects)).toBe(true);
      expect(isV2SupportedEffectStack(invalidEffects)).toBe(false);
    });
  });

  // ─── 3. MANIFEST BUILDER ──────────────────────────────────────────────────
  describe("buildManifestFromClip", () => {
    it("should construct a valid ProjectManifestV2 from timeline clip and effects", () => {
      const clip = {
        id: "clip-1",
        assetId: "asset-1",
        timelineStartMs: 0,
        timelineEndMs: 5000,
      };

      const effects = [{ id: "fx-sepia", type: "sepia", params: { sepia: 0.8 } }];

      const manifest = buildManifestFromClip("proj-mpg", "MPG Test Project", clip, effects, {
        width: 1920,
        height: 1080,
        assetUri: "/media/video.mp4",
      });

      expect(manifest.id).toBe("proj-mpg");
      expect(manifest.width).toBe(1920);
      expect(manifest.height).toBe(1080);
      expect(manifest.tracks.length).toBe(1);
      expect(manifest.tracks[0].effectStack.length).toBe(1);
      expect(manifest.tracks[0].effectStack[0].type).toBe("Sepia");
    });
  });
});
