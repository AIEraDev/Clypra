import { describe, it, expect } from "vitest";
import {
  evaluateEffectCompatibility,
  LOCAL_ENGINE_CAPABILITIES,
  resetEngineCapabilities,
  getActiveEngineCapabilities,
  syncEngineCapabilitiesWithGpuStatus,
  isGpuStatusKnown,
} from "../capabilities";
import type { BodyEffectManifest } from "@clypra-studio/types";

describe("evaluateEffectCompatibility", () => {
  const baseCutoutManifest: BodyEffectManifest = {
    id: "subject-cutout",
    name: "Text Behind Subject",
    version: "1.0.0",
    category: "Cutout",
    description: "Places text or graphic layers behind a segmented person",
    requirements: {
      minEngineVersion: "1.0.0",
      captureType: "silhouette_mask",
      maskCategory: "person",
    },
    compositing: {
      primitive: "AlphaCutout",
      layerZOrder: "behind-subject",
      blendMode: "normal",
    },
    parameterSchema: {
      feather: { type: "float", default: 4, min: 0, max: 20 },
    },
    defaultParams: { feather: 4 },
    tags: ["cutout", "behind-subject"],
  };

  it("approves compatible cutout effect", () => {
    const result = evaluateEffectCompatibility(baseCutoutManifest, LOCAL_ENGINE_CAPABILITIES);
    expect(result.compatible).toBe(true);
  });

  it("approves compatible hybrid wings effect", () => {
    const wingsManifest: BodyEffectManifest = {
      ...baseCutoutManifest,
      id: "angel-wings",
      requirements: {
        minEngineVersion: "1.5.0",
        captureType: "hybrid_body",
      },
      compositing: {
        primitive: "SkeletalSpriteAnchor",
        layerZOrder: "behind-subject",
        blendMode: "screen",
      },
    };

    const result = evaluateEffectCompatibility(wingsManifest, LOCAL_ENGINE_CAPABILITIES);
    expect(result.compatible).toBe(true);
  });

  it("rejects effect requiring an unsupported capture provider", () => {
    const futureManifest: BodyEffectManifest = {
      ...baseCutoutManifest,
      requirements: {
        minEngineVersion: "2.0.0",
        captureType: "volumetric_mesh" as any,
      },
    };

    const result = evaluateEffectCompatibility(futureManifest, LOCAL_ENGINE_CAPABILITIES);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Unsupported capture type");
  });

  it("rejects effect requiring an unsupported compositing primitive", () => {
    const futureManifest: BodyEffectManifest = {
      ...baseCutoutManifest,
      compositing: {
        primitive: "RaymarchedFluid3D" as any,
        layerZOrder: "behind-subject",
        blendMode: "normal",
      },
    };

    const result = evaluateEffectCompatibility(futureManifest, LOCAL_ENGINE_CAPABILITIES);
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Unsupported compositing primitive");
  });

  it("rejects effect when adapter maxTextureDimension2D is below effect requirement", () => {
    const highResManifest: BodyEffectManifest = {
      ...baseCutoutManifest,
      requirements: {
        ...baseCutoutManifest.requirements,
        minTextureDimension2D: 8192,
      },
    };

    const result = evaluateEffectCompatibility(highResManifest, {
      ...LOCAL_ENGINE_CAPABILITIES,
      maxTextureDimension2D: 4096,
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("Hardware texture limit (4096px) below required (8192px)");
  });

  it("rejects effect requiring canonical limits when adapter is clamped below baseline", () => {
    const strictManifest: BodyEffectManifest = {
      ...baseCutoutManifest,
      requirements: {
        ...baseCutoutManifest.requirements,
        requiresCanonicalLimits: true,
      },
    };

    const result = evaluateEffectCompatibility(strictManifest, {
      ...LOCAL_ENGINE_CAPABILITIES,
      meetsCanonicalLimits: false,
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("requires canonical GPU baseline limits");
  });

  it("rejects unannotated effect by default when adapter is clamped below baseline (default-safe canonical gating)", () => {
    // baseCutoutManifest has undefined requiresCanonicalLimits - should default to strict/safe canonical requirement
    expect(baseCutoutManifest.requirements.requiresCanonicalLimits).toBeUndefined();

    const result = evaluateEffectCompatibility(baseCutoutManifest, {
      ...LOCAL_ENGINE_CAPABILITIES,
      meetsCanonicalLimits: false,
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("requires canonical GPU baseline limits");
  });

  it("permits effect that explicitly opts out of canonical limits on clamped adapter", () => {
    const relaxedManifest: BodyEffectManifest = {
      ...baseCutoutManifest,
      requirements: {
        ...baseCutoutManifest.requirements,
        requiresCanonicalLimits: false,
      },
    };

    const result = evaluateEffectCompatibility(relaxedManifest, {
      ...LOCAL_ENGINE_CAPABILITIES,
      meetsCanonicalLimits: false,
    });
    expect(result.compatible).toBe(true);
  });

  it("syncs dynamic engine capabilities from NativeGpuRuntimeStatus IPC telemetry", () => {
    resetEngineCapabilities();
    // Default is undefined — hardware not yet known, not optimistically true
    expect(getActiveEngineCapabilities().meetsCanonicalLimits).toBeUndefined();
    expect(getActiveEngineCapabilities().maxTextureDimension2D).toBe(4096);

    // Simulate NativeGpuRuntimeStatus payload received over Tauri IPC from adapter_selector.rs
    const clampedGpuStatus = {
      contractVersion: 2,
      state: "ready" as const,
      available: true,
      adapterName: "Intel UHD 620",
      backend: "vulkan",
      deviceType: "integratedGpu",
      surfaceAvailable: true,
      failureReason: null,
      meetsCanonicalLimits: false,
      maxTextureDimension2D: 2048,
      limitWarnings: [
        "max_texture_dimension_2d clamped from canonical 4096 to 2048",
      ],
    };

    syncEngineCapabilitiesWithGpuStatus(clampedGpuStatus);

    const activeCaps = getActiveEngineCapabilities();
    expect(activeCaps.meetsCanonicalLimits).toBe(false);
    expect(activeCaps.maxTextureDimension2D).toBe(2048);

    // Now evaluate without explicit caps argument: uses dynamic active capabilities
    const defaultEval = evaluateEffectCompatibility(baseCutoutManifest);
    expect(defaultEval.compatible).toBe(false);
    expect(defaultEval.reason).toContain("requires canonical GPU baseline limits");

    // Clean up
    resetEngineCapabilities();
    // After reset, back to unknown — not true
    expect(getActiveEngineCapabilities().meetsCanonicalLimits).toBeUndefined();
  });

  it("does not reject effects during startup window when meetsCanonicalLimits is undefined (hardware not yet probed)", () => {
    // This test documents and verifies the deliberate behavior during the startup async gap:
    // meetsCanonicalLimits === undefined means "not yet known", not "clamped".
    // The rejection check `caps.meetsCanonicalLimits === false` does NOT fire on undefined,
    // so the effect is not incorrectly blocked during the window before IPC resolves.
    // The UI must independently gate the grid on `isGpuStatusKnown()` to close this window.
    const result = evaluateEffectCompatibility(baseCutoutManifest, {
      ...LOCAL_ENGINE_CAPABILITIES,
      meetsCanonicalLimits: undefined,
    });
    // Should pass through — not false-rejected, but also not yet confirmed safe
    expect(result.compatible).toBe(true);
  });

  it("isGpuStatusKnown returns false before sync and true after", () => {
    resetEngineCapabilities();
    expect(isGpuStatusKnown()).toBe(false);

    syncEngineCapabilitiesWithGpuStatus({
      contractVersion: 2,
      state: "ready" as const,
      available: true,
      adapterName: "M2 Pro",
      backend: "metal",
      deviceType: "discreteGpu",
      surfaceAvailable: true,
      failureReason: null,
      meetsCanonicalLimits: true,
      maxTextureDimension2D: 16384,
      limitWarnings: [],
    });
    expect(isGpuStatusKnown()).toBe(true);

    resetEngineCapabilities();
    expect(isGpuStatusKnown()).toBe(false);
  });
});
