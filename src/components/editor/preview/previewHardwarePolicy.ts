import type { NativeQualityTier } from "@/lib/platform/nativeCore";

/**
 * A conservative preview-only policy for GPU tiers established by production
 * telemetry. It never affects source media or export settings.
 *
 * Intel HD 520 and UHD 630 cannot sustain a reliable 4K HEVC editor preview.
 * The production cohort for UHD 630 still showed sustained drops after the
 * previous 1080p/half reduction, so both legacy generations start at a 720p
 * proxy. Other adapters keep the user's selected quality until measured
 * backpressure asks for more.
 */
export interface PreviewHardwarePolicy {
  capabilityPolicy: "full" | "reduced" | "proxy";
  maxDimension?: number;
  maximumQuality?: NativeQualityTier;
}

const FULL_POLICY: PreviewHardwarePolicy = { capabilityPolicy: "full" };

export interface PreviewPerformanceObservation {
  totalTimeUs: number;
  dropped: boolean;
}

const QUALITY_RANK: Record<NativeQualityTier, number> = {
  full: 3,
  half: 2,
  quarter: 1,
  proxy: 0,
};

/**
 * Detects legacy Intel integrated GPUs (Gen 7 through Gen 11).
 * These architectures (HD Graphics, UHD Graphics, Iris/Iris Pro/Iris Plus)
 * have 24-48 execution units and share DDR3/DDR4 system memory, making real-time
 * 4K or 1440p preview impossible without downscaling.
 * Modern Iris Xe (Gen 12) and discrete/integrated Arc are excluded here.
 */
export function isLegacyIntelIntegratedGpu(
  adapterName: string | null | undefined,
): boolean {
  if (!adapterName || !/intel/i.test(adapterName)) return false;
  const adapter = adapterName.toLowerCase();
  // Iris Xe and Arc are modern architectures with higher execution unit counts.
  if (/(?:iris.*xe|arc)/i.test(adapter)) return false;
  // Match any Intel HD Graphics, UHD Graphics, or older Iris/Iris Pro/Iris Plus
  return /(?:hd graphics|uhd graphics|iris)/i.test(adapter);
}

/**
 * Detects modern Intel integrated graphics (Iris Xe, integrated Arc).
 */
export function isModernIntelIntegratedGpu(
  adapterName: string | null | undefined,
): boolean {
  if (!adapterName || !/intel/i.test(adapterName)) return false;
  const adapter = adapterName.toLowerCase();
  // Exclude discrete Arc GPUs (e.g. Arc A770, A750, A380, B580)
  if (/arc.*(?:a[0-9]{3}|b[0-9]{3})/i.test(adapter)) return false;
  return /(?:iris.*xe|arc)/i.test(adapter);
}

/**
 * Session-scoped backpressure policy for integrated Intel graphics. It moves
 * down one rung only after a sustained bad window, avoiding a quality change
 * for a single cold frame or a brief resize. It deliberately never upscales
 * again mid-session: stable editing is more valuable than oscillating detail.
 */
export class PreviewPerformancePolicyController {
  private observations: PreviewPerformanceObservation[] = [];
  private escalation = 0;

  observe(observation: PreviewPerformanceObservation): boolean {
    this.observations.push(observation);
    if (this.observations.length > 60) this.observations.shift();
    if (this.escalation >= 2) return false;

    const overloaded = this.observations.filter(
      (sample) => sample.dropped || sample.totalTimeUs > 16_667,
    ).length;
    // A short run of missed real-time frames is enough evidence to reduce
    // quality immediately. Waiting for 30 samples lets an Iris Xe/older Intel
    // queue accumulate stale work during an interactive scrub. A single cold
    // pipeline frame still cannot trigger this (the threshold is three).
    const hasBurst = this.observations.length >= 12 && overloaded >= 3;
    if (!hasBurst) return false;

    this.escalation += 1;
    this.observations = [];
    return true;
  }

  policyFor(
    adapterName: string | null | undefined,
    canvasWidth: number,
    canvasHeight: number,
    mediaWidth?: number,
    mediaHeight?: number,
  ): PreviewHardwarePolicy {
    const baseline = selectPreviewHardwarePolicy(
      adapterName,
      canvasWidth,
      canvasHeight,
      mediaWidth,
      mediaHeight,
    );
    if (!adapterName) return baseline;
    if (!/intel/i.test(adapterName)) return baseline;

    // If baseline is already at proxy, no further escalation needed.
    if (baseline.capabilityPolicy === "proxy") return baseline;

    if (this.escalation === 0) return baseline;
    if (this.escalation === 1) {
      return baseline.capabilityPolicy === "full"
        ? {
            capabilityPolicy: "reduced",
            maxDimension: 1_920,
            maximumQuality: "half",
          }
        : {
            capabilityPolicy: "proxy",
            maxDimension: 1_280,
            maximumQuality: "proxy",
          };
    }
    return {
      capabilityPolicy: "proxy",
      maxDimension: 1_280,
      maximumQuality: "proxy",
    };
  }
}

export function selectPreviewHardwarePolicy(
  adapterName: string | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
  mediaWidth?: number,
  mediaHeight?: number,
): PreviewHardwarePolicy {
  if (!adapterName) return FULL_POLICY;
  const maxWorkloadDimension = Math.max(
    canvasWidth,
    canvasHeight,
    mediaWidth ?? 0,
    mediaHeight ?? 0,
  );

  // 1440p (>=2500) and 4K (>=3500) on legacy Intel integrated GPUs
  if (
    maxWorkloadDimension >= 2_500 &&
    isLegacyIntelIntegratedGpu(adapterName)
  ) {
    return {
      capabilityPolicy: "proxy",
      maxDimension: 1_280,
      maximumQuality: "proxy",
    };
  }

  return FULL_POLICY;
}

export function applyPreviewHardwarePolicy(
  width: number,
  height: number,
  quality: NativeQualityTier,
  policy: PreviewHardwarePolicy,
): { width: number; height: number; quality: NativeQualityTier } {
  const maxDimension = policy.maxDimension;
  const scale = maxDimension
    ? Math.min(1, maxDimension / Math.max(width, height))
    : 1;

  let effectiveQuality = quality;
  if (policy.maximumQuality) {
    effectiveQuality =
      QUALITY_RANK[quality] > QUALITY_RANK[policy.maximumQuality]
        ? policy.maximumQuality
        : quality;
  }

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: effectiveQuality,
  };
}
