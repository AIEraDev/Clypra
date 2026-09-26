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
 *
 * Design principle: DeviceType (discrete / integrated / cpu) is the primary
 * axis. Vendor-string matching is only used to classify _within_ a device
 * type. This ensures AMD, Nvidia, Apple, and future GPU vendors are handled
 * correctly without adding vendor-specific branches for every new model.
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
 * GPU tier classification used by the hardware policy.
 *
 * - `software`      : CPU-only renderer (llvmpipe, Mesa SwiftShader, WARP).
 *                     Always forces proxy; even 1080p realtime compositing is
 *                     too expensive.
 * - `legacy-igpu`   : Integrated GPUs with very constrained bandwidth / EU
 *                     count (Intel HD/UHD, older AMD Vega 8/11 iGPU, Nvidia
 *                     MX 1xx). Forces proxy on ≥1440p workloads.
 * - `capable-igpu`  : Modern integrated graphics that can handle 1080p well
 *                     but may struggle at 4K+ (Intel Iris Xe, Apple Silicon
 *                     M1/M2/M3, AMD 680M/890M, Nvidia MX 3xx+). Subject to
 *                     backpressure escalation but starts at full.
 * - `discrete`      : Dedicated GPU. Starts at full quality and only
 *                     escalates via measured backpressure if the user has an
 *                     unusually weak entry-level card.
 */
export type GpuTier =
  | "software"
  | "legacy-igpu"
  | "capable-igpu"
  | "discrete"
  | "unknown";

// ---------------------------------------------------------------------------
// Individual GPU family detectors (name-pattern fallbacks)
// ---------------------------------------------------------------------------

/**
 * Detects legacy Intel integrated GPUs (Gen 7 through Gen 11).
 * These architectures (HD Graphics, UHD Graphics, Iris/Iris Pro/Iris Plus)
 * have 24-48 execution units and share DDR3/DDR4 system memory, making
 * real-time 4K or 1440p preview impossible without downscaling.
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
 * Detects AMD integrated GPUs (Radeon Vega / RDNA embedded in Ryzen APUs).
 * These share system RAM exactly like Intel iGPUs.
 *
 * Matches:  "AMD Radeon(TM) Vega 8 Graphics"
 *           "AMD Radeon(TM) Vega 11 Graphics"
 *           "AMD Radeon(TM) Graphics" (generic Ryzen 5000 / 7000 APU label)
 *           "AMD Radeon(TM) 680M"  (Ryzen 6000 RDNA2 APU)
 *           "AMD Radeon(TM) 780M"  (Ryzen 7000 RDNA3 APU)
 *           "AMD Radeon(TM) 890M"  (Ryzen AI RDNA3.5 APU)
 *
 * Excludes: "AMD Radeon RX …" (discrete), "AMD Radeon Pro …" (pro discrete)
 */
export function isAmdIntegratedGpu(
  adapterName: string | null | undefined,
): boolean {
  if (!adapterName || !/amd/i.test(adapterName)) return false;
  const adapter = adapterName.toLowerCase();
  // Discrete RX and Pro lines are not integrated
  if (/\brx\b/.test(adapter) || /\bpro\b/.test(adapter)) return false;
  // Vega or plain "radeon(tm) graphics" / radeon(tm) NNM are iGPU signals
  return /vega|radeon\(tm\)\s+(?:graphics|\d{3}m)/i.test(adapter);
}

/**
 * Detects entry-level Nvidia MX-series GPUs (discrete but weak).
 * MX 150 / 250 are legacy-igpu tier; MX 350 / 450 / 550 are capable-igpu.
 */
export function isNvidiaMxGpu(
  adapterName: string | null | undefined,
): boolean {
  if (!adapterName || !/nvidia/i.test(adapterName)) return false;
  return /\bmx\s*\d{3}/i.test(adapterName);
}

/**
 * Returns true for legacy Nvidia MX (MX 1xx / 2xx).
 */
function isLegacyNvidiaMxGpu(adapterName: string): boolean {
  // MX 150, 250 are the weak ones
  return /\bmx\s*(?:1\d{2}|2\d{2})\b/i.test(adapterName);
}

/**
 * Detects software / CPU fallback renderers.
 * These names appear for Mesa llvmpipe, D3D12 WARP, Swiftshader, and
 * similar CPU-backed rasterizers.
 */
export function isSoftwareRenderer(
  adapterName: string | null | undefined,
): boolean {
  if (!adapterName) return false;
  return /llvmpipe|swiftshader|softpipe|warp|microsoft basic render/i.test(
    adapterName,
  );
}

// ---------------------------------------------------------------------------
// Primary classifier — probe-driven, vendor-string as fallback
// ---------------------------------------------------------------------------

/**
 * Classifies the GPU into a tier that drives the quality policy.
 *
 * Priority order (most reliable signal first):
 *  1. Software renderer name → `software`
 *  2. wgpu DeviceType = "Cpu" → `software`
 *  3. wgpu DeviceType = "DiscreteGpu" → `discrete`
 *     (MX series overrides to `legacy-igpu` or `capable-igpu` via name match)
 *  4. wgpu DeviceType = "IntegratedGpu" → name-pattern sub-classify
 *  5. Fallback: name-pattern heuristics when DeviceType is "Other" / unknown
 *
 * @param adapterName  GPU adapter name string from wgpu (e.g. "Intel(R) HD Graphics 520")
 * @param deviceType   wgpu DeviceType serialized as Debug string:
 *                     "DiscreteGpu" | "IntegratedGpu" | "Cpu" | "VirtualGpu" | "Other"
 */
export function classifyGpuTier(
  adapterName: string | null | undefined,
  deviceType: string | null | undefined,
): GpuTier {
  // --- Software renderer (always the worst case) ---
  if (isSoftwareRenderer(adapterName)) return "software";
  if (deviceType === "Cpu" || deviceType === "VirtualGpu") return "software";

  const name = adapterName ?? "";

  // --- Discrete GPU ---
  if (deviceType === "DiscreteGpu") {
    // Nvidia MX 1xx/2xx: discrete slot but iGPU-class performance
    if (isNvidiaMxGpu(name)) {
      return isLegacyNvidiaMxGpu(name) ? "legacy-igpu" : "capable-igpu";
    }
    // All other discrete GPUs (RX 6800 XT, RTX 40xx, Arc A770, etc.) → full
    return "discrete";
  }

  // --- Integrated GPU ---
  if (deviceType === "IntegratedGpu") {
    // Intel
    if (/intel/i.test(name)) {
      if (isLegacyIntelIntegratedGpu(name)) return "legacy-igpu";
      if (isModernIntelIntegratedGpu(name)) return "capable-igpu";
      // Unknown Intel iGPU — treat conservatively
      return "legacy-igpu";
    }
    // AMD
    if (/amd/i.test(name)) {
      // Older Vega 8/11 are legacy; newer 680M/780M/890M (RDNA2/3) are capable
      if (/vega\s*(?:[1-9]|1[01])\b/i.test(name)) return "legacy-igpu";
      return "capable-igpu";
    }
    // Apple Silicon exposes as IntegratedGpu via Metal backend — always capable
    if (/apple/i.test(name)) return "capable-igpu";
    // Generic unknown integrated — be conservative
    return "legacy-igpu";
  }

  // --- Fallback: DeviceType is "Other" or missing — use name patterns ---
  if (isSoftwareRenderer(name)) return "software";
  if (isLegacyIntelIntegratedGpu(name)) return "legacy-igpu";
  if (isModernIntelIntegratedGpu(name)) return "capable-igpu";
  if (isAmdIntegratedGpu(name)) return "legacy-igpu";
  if (isNvidiaMxGpu(name)) {
    return isLegacyNvidiaMxGpu(name) ? "legacy-igpu" : "capable-igpu";
  }
  // Default: assume capable if we have a name but cannot classify it
  if (name.length > 0) return "discrete";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Policies per tier
// ---------------------------------------------------------------------------

const PROXY_POLICY: PreviewHardwarePolicy = {
  capabilityPolicy: "proxy",
  maxDimension: 1_280,
  maximumQuality: "proxy",
};

const REDUCED_1080_POLICY: PreviewHardwarePolicy = {
  capabilityPolicy: "reduced",
  maxDimension: 1_920,
  maximumQuality: "half",
};

// ---------------------------------------------------------------------------
// Session-scoped backpressure controller
// ---------------------------------------------------------------------------

/**
 * Session-scoped backpressure policy. It moves down one rung only after a
 * sustained bad window, avoiding a quality change for a single cold frame or
 * a brief resize. It deliberately never upscales again mid-session: stable
 * editing is more valuable than oscillating detail.
 *
 * Backpressure escalation now applies to ALL GPU tiers that are not
 * `discrete`-classified, not only Intel adapters. A weak Nvidia MX 150 or
 * AMD Vega 8 under heavy load will benefit from the same reduction.
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
    deviceType?: string | null,
  ): PreviewHardwarePolicy {
    const baseline = selectPreviewHardwarePolicy(
      adapterName,
      canvasWidth,
      canvasHeight,
      mediaWidth,
      mediaHeight,
      deviceType,
    );

    // Discrete GPUs do not participate in backpressure escalation — they can
    // always handle the workload better than an iGPU. Software renderers
    // already get the worst tier from selectPreviewHardwarePolicy.
    const tier = classifyGpuTier(adapterName, deviceType);
    if (tier === "discrete" || tier === "software" || tier === "unknown") {
      return baseline;
    }

    // If baseline is already at proxy, no further escalation needed.
    if (baseline.capabilityPolicy === "proxy") return baseline;

    if (this.escalation === 0) return baseline;
    if (this.escalation === 1) {
      return baseline.capabilityPolicy === "full"
        ? REDUCED_1080_POLICY
        : PROXY_POLICY;
    }
    return PROXY_POLICY;
  }
}

// ---------------------------------------------------------------------------
// Static hardware policy (no backpressure)
// ---------------------------------------------------------------------------

export function selectPreviewHardwarePolicy(
  adapterName: string | null | undefined,
  canvasWidth: number,
  canvasHeight: number,
  mediaWidth?: number,
  mediaHeight?: number,
  deviceType?: string | null,
): PreviewHardwarePolicy {
  if (!adapterName && !deviceType) return FULL_POLICY;

  const tier = classifyGpuTier(adapterName, deviceType);

  // Software renderers always get proxy — even 1080p is too slow in realtime
  if (tier === "software") return PROXY_POLICY;

  const maxWorkloadDimension = Math.max(
    canvasWidth,
    canvasHeight,
    mediaWidth ?? 0,
    mediaHeight ?? 0,
  );

  // Legacy iGPU (Intel HD/UHD, AMD Vega 8/11, Nvidia MX 1xx/2xx):
  // force proxy on ≥1440p workloads (maxDimension ≥ 2500px)
  if (tier === "legacy-igpu" && maxWorkloadDimension >= 2_500) {
    return PROXY_POLICY;
  }

  // All other tiers start at full quality. Backpressure escalation in
  // PreviewPerformancePolicyController handles runtime degradation.
  return FULL_POLICY;
}

// ---------------------------------------------------------------------------
// Apply policy to a concrete render request
// ---------------------------------------------------------------------------

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
