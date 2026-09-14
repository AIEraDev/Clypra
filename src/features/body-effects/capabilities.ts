/**
 * Local Client Capability Evaluator
 *
 * Validates remote effect manifests against local desktop engine capabilities,
 * preventing old installs from loading incompatible shaders or missing models.
 */

import type {
  BodyEffectManifest,
  BodyEffectRequirements,
  BodyEffectCompositing,
} from "@clypra-studio/types";
import type { NativeGpuRuntimeStatus } from "@/lib/platform/nativeCore";
// Single source of truth for GPU limits — same file build.rs reads for Rust codegen.
// The @gpu-limits alias is defined in vite.config.ts and tsconfig.json paths.
// Avoids a separately-recalled constant; automatically tracks any future change to
// gpu-limits.json without needing a second edit here.
import GPU_LIMITS from "@gpu-limits";

export interface EngineCapabilities {
  readonly engineVersion: string;
  readonly availableProviders: ReadonlySet<string>;
  readonly supportedPrimitives: ReadonlySet<string>;
  readonly maxTextureDimension2D?: number;
  readonly meetsCanonicalLimits?: boolean;
}

export interface EffectCompatibilityInput {
  readonly requirements: BodyEffectRequirements;
  readonly compositing: BodyEffectCompositing;
}

export const LOCAL_ENGINE_CAPABILITIES: EngineCapabilities = {
  engineVersion: "1.5.0",
  // Read from the canonical limits file rather than a hardcoded constant.
  maxTextureDimension2D: GPU_LIMITS.maxTextureDimension2D,
  // Intentionally undefined until real hardware data arrives.
  // evaluateEffectCompatibility treats undefined as "not yet known" and
  // will gate on meetsCanonicalLimits === false only once real data lands.
  // During startup, the UI shows a pending state rather than false-approving effects.
  meetsCanonicalLimits: undefined,
  availableProviders: new Set([
    "silhouette_mask",
    "mask:person",
    "skeletal_pose",
    "pose:blazepose33",
    "hybrid_body",
  ]),
  supportedPrimitives: new Set([
    "PassThrough",
    "AlphaCutout",
    "body_cutout",
    "subject_cutout",
    "MaskedGlow",
    "body_glow",
    "body_segmentation_glow",
    "MaskedStroke",
    "body_outline",
    "MaskedDualBlur",
    "body_particles",
    "SkeletalSpriteAnchor",
  ]),
};

let activeCapabilities: EngineCapabilities = { ...LOCAL_ENGINE_CAPABILITIES };

export function getActiveEngineCapabilities(): EngineCapabilities {
  return activeCapabilities;
}

/**
 * Returns true only when real hardware data has been received via IPC.
 * Callers that need to distinguish "not yet checked" from "confirmed OK"
 * should gate on this rather than reading meetsCanonicalLimits directly.
 */
export function isGpuStatusKnown(): boolean {
  return activeCapabilities.meetsCanonicalLimits !== undefined;
}

export function syncEngineCapabilitiesWithGpuStatus(
  status: NativeGpuRuntimeStatus,
): EngineCapabilities {
  activeCapabilities = {
    ...activeCapabilities,
    meetsCanonicalLimits:
      status.meetsCanonicalLimits ?? activeCapabilities.meetsCanonicalLimits,
    maxTextureDimension2D:
      typeof status.maxTextureDimension2D === "number"
        ? status.maxTextureDimension2D
        : activeCapabilities.maxTextureDimension2D,
  };
  return activeCapabilities;
}

export function resetEngineCapabilities(): void {
  activeCapabilities = { ...LOCAL_ENGINE_CAPABILITIES };
}

export function evaluateEffectCompatibility(
  manifest: EffectCompatibilityInput | BodyEffectManifest,
  caps: EngineCapabilities = getActiveEngineCapabilities(),
): { compatible: boolean; reason?: string } {
  // Check capture type requirement
  if (!caps.availableProviders.has(manifest.requirements.captureType)) {
    return {
      compatible: false,
      reason: `Unsupported capture type: ${manifest.requirements.captureType}`,
    };
  }

  // Check primitive requirement
  if (!caps.supportedPrimitives.has(manifest.compositing.primitive)) {
    return {
      compatible: false,
      reason: `Unsupported compositing primitive: ${manifest.compositing.primitive}`,
    };
  }

  // Check minimum 2D texture dimension requirement against adapter capabilities
  if (
    typeof manifest.requirements.minTextureDimension2D === "number" &&
    typeof caps.maxTextureDimension2D === "number" &&
    caps.maxTextureDimension2D < manifest.requirements.minTextureDimension2D
  ) {
    return {
      compatible: false,
      reason: `Hardware texture limit (${caps.maxTextureDimension2D}px) below required (${manifest.requirements.minTextureDimension2D}px)`,
    };
  }

  // Check strict canonical baseline limits requirement.
  // DEFAULT POLICY: effects default to requiring canonical limits unless explicitly opting out with `requiresCanonicalLimits: false`.
  // NOTE: if meetsCanonicalLimits is undefined (hardware not yet probed), this check is skipped.
  // The UI must gate rendering behind gpuStatusKnown to prevent a false-safe window.
  const strictlyRequiresCanonical =
    manifest.requirements.requiresCanonicalLimits !== false;
  if (strictlyRequiresCanonical && caps.meetsCanonicalLimits === false) {
    return {
      compatible: false,
      reason: `Effect requires canonical GPU baseline limits (adapter clamped below baseline)`,
    };
  }

  return { compatible: true };
}
