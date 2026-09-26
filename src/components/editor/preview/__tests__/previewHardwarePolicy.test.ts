import { describe, expect, it } from "vitest";
import {
  applyPreviewHardwarePolicy,
  classifyGpuTier,
  isAmdIntegratedGpu,
  isLegacyIntelIntegratedGpu,
  isModernIntelIntegratedGpu,
  isNvidiaMxGpu,
  isSoftwareRenderer,
  PreviewPerformancePolicyController,
  selectPreviewHardwarePolicy,
} from "../previewHardwarePolicy";

// ---------------------------------------------------------------------------
// GPU tier classifier
// ---------------------------------------------------------------------------

describe("classifyGpuTier", () => {
  // --- Discrete ---
  it("classifies AMD Radeon RX 6800 XT as discrete", () => {
    expect(
      classifyGpuTier("AMD Radeon RX 6800 XT", "DiscreteGpu"),
    ).toBe("discrete");
  });

  it("classifies AMD Radeon RX 7900 XTX as discrete", () => {
    expect(
      classifyGpuTier("AMD Radeon RX 7900 XTX", "DiscreteGpu"),
    ).toBe("discrete");
  });

  it("classifies Nvidia RTX 4090 as discrete", () => {
    expect(
      classifyGpuTier("NVIDIA GeForce RTX 4090", "DiscreteGpu"),
    ).toBe("discrete");
  });

  it("classifies Intel Arc A770 as discrete", () => {
    expect(
      classifyGpuTier("Intel(R) Arc(TM) A770 Graphics", "DiscreteGpu"),
    ).toBe("discrete");
  });

  // --- Legacy iGPU ---
  it("classifies Intel HD 520 as legacy-igpu via DeviceType", () => {
    expect(
      classifyGpuTier("Intel(R) HD Graphics 520", "IntegratedGpu"),
    ).toBe("legacy-igpu");
  });

  it("classifies Intel UHD 630 as legacy-igpu via DeviceType", () => {
    expect(
      classifyGpuTier("Intel(R) UHD Graphics 630", "IntegratedGpu"),
    ).toBe("legacy-igpu");
  });

  it("classifies AMD Radeon Vega 8 as legacy-igpu", () => {
    expect(
      classifyGpuTier("AMD Radeon(TM) Vega 8 Graphics", "IntegratedGpu"),
    ).toBe("legacy-igpu");
  });

  it("classifies AMD Radeon Vega 11 as legacy-igpu", () => {
    expect(
      classifyGpuTier("AMD Radeon(TM) Vega 11 Graphics", "IntegratedGpu"),
    ).toBe("legacy-igpu");
  });

  it("classifies Nvidia MX 150 as legacy-igpu (weak discrete)", () => {
    expect(
      classifyGpuTier("NVIDIA GeForce MX 150", "DiscreteGpu"),
    ).toBe("legacy-igpu");
  });

  it("classifies Nvidia MX 250 as legacy-igpu (weak discrete)", () => {
    expect(
      classifyGpuTier("NVIDIA GeForce MX250", "DiscreteGpu"),
    ).toBe("legacy-igpu");
  });

  // --- Capable iGPU ---
  it("classifies Intel Iris Xe as capable-igpu", () => {
    expect(
      classifyGpuTier("Intel(R) Iris(R) Xe Graphics", "IntegratedGpu"),
    ).toBe("capable-igpu");
  });

  it("classifies AMD Radeon 680M (Ryzen 6000 RDNA2 APU) as capable-igpu", () => {
    expect(
      classifyGpuTier("AMD Radeon(TM) 680M", "IntegratedGpu"),
    ).toBe("capable-igpu");
  });

  it("classifies AMD Radeon 780M (Ryzen 7000 RDNA3 APU) as capable-igpu", () => {
    expect(
      classifyGpuTier("AMD Radeon(TM) 780M", "IntegratedGpu"),
    ).toBe("capable-igpu");
  });

  it("classifies Apple M2 GPU as capable-igpu", () => {
    expect(
      classifyGpuTier("Apple M2", "IntegratedGpu"),
    ).toBe("capable-igpu");
  });

  it("classifies Nvidia MX 350 as capable-igpu", () => {
    expect(
      classifyGpuTier("NVIDIA GeForce MX350", "DiscreteGpu"),
    ).toBe("capable-igpu");
  });

  it("classifies Nvidia MX 550 as capable-igpu", () => {
    expect(
      classifyGpuTier("NVIDIA GeForce MX 550", "DiscreteGpu"),
    ).toBe("capable-igpu");
  });

  // --- Software renderer ---
  it("classifies llvmpipe as software", () => {
    expect(classifyGpuTier("llvmpipe (LLVM 15.0.0, 256 bits)", "Cpu")).toBe(
      "software",
    );
  });

  it("classifies WARP as software", () => {
    expect(classifyGpuTier("Microsoft Basic Render Driver", "Cpu")).toBe(
      "software",
    );
  });

  it("classifies SwiftShader as software even with Other DeviceType", () => {
    expect(classifyGpuTier("SwiftShader Device", "Other")).toBe("software");
  });

  it("classifies Cpu DeviceType as software regardless of name", () => {
    expect(classifyGpuTier("Unknown CPU Renderer", "Cpu")).toBe("software");
  });

  // --- Fallback: name-only (DeviceType missing) ---
  it("classifies Intel HD 520 by name when DeviceType is missing", () => {
    expect(classifyGpuTier("Intel(R) HD Graphics 520", null)).toBe(
      "legacy-igpu",
    );
  });

  it("classifies AMD Vega 8 by name when DeviceType is missing", () => {
    expect(classifyGpuTier("AMD Radeon(TM) Vega 8 Graphics", null)).toBe(
      "legacy-igpu",
    );
  });

  it("returns unknown for null adapter and null deviceType", () => {
    expect(classifyGpuTier(null, null)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Individual detector helpers
// ---------------------------------------------------------------------------

describe("isLegacyIntelIntegratedGpu", () => {
  it("matches Intel HD 520", () =>
    expect(isLegacyIntelIntegratedGpu("Intel(R) HD Graphics 520")).toBe(true));
  it("matches Intel UHD 630", () =>
    expect(isLegacyIntelIntegratedGpu("Intel(R) UHD Graphics 630")).toBe(true));
  it("matches Iris Plus 655", () =>
    expect(
      isLegacyIntelIntegratedGpu("Intel(R) Iris(R) Plus Graphics 655"),
    ).toBe(true));
  it("rejects Iris Xe", () =>
    expect(isLegacyIntelIntegratedGpu("Intel(R) Iris(R) Xe Graphics")).toBe(
      false,
    ));
  it("rejects Arc A770", () =>
    expect(
      isLegacyIntelIntegratedGpu("Intel(R) Arc(TM) A770 Graphics"),
    ).toBe(false));
  it("rejects AMD GPU", () =>
    expect(isLegacyIntelIntegratedGpu("AMD Radeon RX 6800 XT")).toBe(false));
});

describe("isModernIntelIntegratedGpu", () => {
  it("matches Iris Xe", () =>
    expect(isModernIntelIntegratedGpu("Intel(R) Iris(R) Xe Graphics")).toBe(
      true,
    ));
  it("rejects Arc A770 (discrete)", () =>
    expect(
      isModernIntelIntegratedGpu("Intel(R) Arc(TM) A770 Graphics"),
    ).toBe(false));
  it("rejects Intel HD 520", () =>
    expect(isModernIntelIntegratedGpu("Intel(R) HD Graphics 520")).toBe(false));
});

describe("isAmdIntegratedGpu", () => {
  it("matches Vega 8", () =>
    expect(isAmdIntegratedGpu("AMD Radeon(TM) Vega 8 Graphics")).toBe(true));
  it("matches Vega 11", () =>
    expect(isAmdIntegratedGpu("AMD Radeon(TM) Vega 11 Graphics")).toBe(true));
  it("rejects RX 6800 XT (discrete)", () =>
    expect(isAmdIntegratedGpu("AMD Radeon RX 6800 XT")).toBe(false));
  it("rejects Radeon Pro (discrete)", () =>
    expect(isAmdIntegratedGpu("AMD Radeon Pro 5500M")).toBe(false));
});

describe("isNvidiaMxGpu", () => {
  it("matches MX 150", () =>
    expect(isNvidiaMxGpu("NVIDIA GeForce MX 150")).toBe(true));
  it("matches MX550", () =>
    expect(isNvidiaMxGpu("NVIDIA GeForce MX550")).toBe(true));
  it("rejects RTX 4090", () =>
    expect(isNvidiaMxGpu("NVIDIA GeForce RTX 4090")).toBe(false));
});

describe("isSoftwareRenderer", () => {
  it("matches llvmpipe", () =>
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.0, 256 bits)")).toBe(true));
  it("matches SwiftShader", () =>
    expect(isSoftwareRenderer("SwiftShader Device")).toBe(true));
  it("matches Microsoft Basic Render Driver (WARP)", () =>
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true));
  it("rejects real GPUs", () =>
    expect(isSoftwareRenderer("Intel(R) HD Graphics 520")).toBe(false));
});

// ---------------------------------------------------------------------------
// selectPreviewHardwarePolicy — static baseline
// ---------------------------------------------------------------------------

describe("preview hardware policy", () => {
  // --- Intel legacy iGPU (unchanged behaviour) ---
  it("uses a proxy-sized preview for 4K Intel HD 520", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) HD Graphics 520",
      3840,
      2160,
      undefined,
      undefined,
      "IntegratedGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(applyPreviewHardwarePolicy(3840, 2160, "full", policy)).toEqual({
      width: 1280,
      height: 720,
      quality: "proxy",
    });
  });

  it("uses a proxy-sized preview for 4K Intel UHD 630", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) UHD Graphics 630",
      3840,
      2160,
      undefined,
      undefined,
      "IntegratedGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  it("does not constrain modern Intel Iris Xe on 4K", () => {
    expect(
      selectPreviewHardwarePolicy(
        "Intel(R) Iris(R) Xe Graphics",
        3840,
        2160,
        undefined,
        undefined,
        "IntegratedGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("does not constrain Intel HD 520 on sub-1440p canvas", () => {
    expect(
      selectPreviewHardwarePolicy(
        "Intel(R) HD Graphics 520",
        1920,
        1080,
        undefined,
        undefined,
        "IntegratedGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  // --- AMD iGPU ---
  it("uses proxy for 4K AMD Radeon Vega 8 (Ryzen APU)", () => {
    const policy = selectPreviewHardwarePolicy(
      "AMD Radeon(TM) Vega 8 Graphics",
      3840,
      2160,
      undefined,
      undefined,
      "IntegratedGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(policy.maximumQuality).toBe("proxy");
  });

  it("uses proxy for 1440p AMD Vega 11 (Ryzen APU)", () => {
    const policy = selectPreviewHardwarePolicy(
      "AMD Radeon(TM) Vega 11 Graphics",
      2560,
      1440,
      undefined,
      undefined,
      "IntegratedGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  it("does not constrain AMD Radeon 680M (capable RDNA2 iGPU) on 4K", () => {
    expect(
      selectPreviewHardwarePolicy(
        "AMD Radeon(TM) 680M",
        3840,
        2160,
        undefined,
        undefined,
        "IntegratedGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  // --- AMD discrete ---
  it("does not constrain AMD Radeon RX 6800 XT on 4K", () => {
    expect(
      selectPreviewHardwarePolicy(
        "AMD Radeon RX 6800 XT",
        3840,
        2160,
        undefined,
        undefined,
        "DiscreteGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  // --- Nvidia discrete ---
  it("does not constrain RTX 4090 on 4K", () => {
    expect(
      selectPreviewHardwarePolicy(
        "NVIDIA GeForce RTX 4090",
        3840,
        2160,
        undefined,
        undefined,
        "DiscreteGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("uses proxy for Nvidia MX 150 on 4K (legacy-igpu class)", () => {
    const policy = selectPreviewHardwarePolicy(
      "NVIDIA GeForce MX 150",
      3840,
      2160,
      undefined,
      undefined,
      "DiscreteGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  it("does not constrain Nvidia MX 350 (capable-igpu) on 4K", () => {
    expect(
      selectPreviewHardwarePolicy(
        "NVIDIA GeForce MX350",
        3840,
        2160,
        undefined,
        undefined,
        "DiscreteGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  // --- Software renderer ---
  it("always uses proxy for llvmpipe software renderer", () => {
    const policy = selectPreviewHardwarePolicy(
      "llvmpipe (LLVM 15.0.0, 256 bits)",
      1920,
      1080,
      undefined,
      undefined,
      "Cpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  it("always uses proxy for WARP software renderer", () => {
    const policy = selectPreviewHardwarePolicy(
      "Microsoft Basic Render Driver",
      1920,
      1080,
      undefined,
      undefined,
      "Cpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  // --- Apple Silicon ---
  it("does not constrain Apple M2 on 4K", () => {
    expect(
      selectPreviewHardwarePolicy(
        "Apple M2",
        3840,
        2160,
        undefined,
        undefined,
        "IntegratedGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  // --- Media dimension workload ---
  it("recognizes 4K media workload on 1080p canvas for Intel HD 520", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) HD Graphics 520",
      1920,
      1080,
      3840,
      2160,
      "IntegratedGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(policy.maxDimension).toBe(1280);
    expect(policy.maximumQuality).toBe("proxy");
  });

  it("recognizes 4K media workload on 1080p canvas for AMD Vega 8", () => {
    const policy = selectPreviewHardwarePolicy(
      "AMD Radeon(TM) Vega 8 Graphics",
      1920,
      1080,
      3840,
      2160,
      "IntegratedGpu",
    );
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  // --- Quality rank clamping ---
  it("clamps quality rank down without promoting already lower tiers", () => {
    const halfPolicy = {
      capabilityPolicy: "reduced" as const,
      maxDimension: 1920,
      maximumQuality: "half" as const,
    };
    expect(applyPreviewHardwarePolicy(1920, 1080, "full", halfPolicy).quality).toBe("half");
    expect(applyPreviewHardwarePolicy(1920, 1080, "quarter", halfPolicy).quality).toBe("quarter");
  });
});

// ---------------------------------------------------------------------------
// PreviewPerformancePolicyController — backpressure escalation
// ---------------------------------------------------------------------------

describe("PreviewPerformancePolicyController", () => {
  it("steps down Intel Iris Xe after a sustained miss burst", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 12; index += 1) {
      controller.observe({ totalTimeUs: index < 3 ? 20_000 : 10_000, dropped: false });
    }
    expect(
      controller.policyFor(
        "Intel(R) Iris(R) Xe Graphics",
        3840,
        2160,
        undefined,
        undefined,
        "IntegratedGpu",
      ),
    ).toMatchObject({ capabilityPolicy: "reduced", maximumQuality: "half" });
  });

  it("steps down AMD Radeon Vega 8 after a sustained miss burst", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 12; index += 1) {
      controller.observe({ totalTimeUs: index < 3 ? 20_000 : 10_000, dropped: false });
    }
    // Vega 8 on 4K is already at proxy baseline — no further escalation
    const policy = controller.policyFor(
      "AMD Radeon(TM) Vega 8 Graphics",
      3840,
      2160,
      undefined,
      undefined,
      "IntegratedGpu",
    );
    // baseline is already proxy; escalation should not go below that
    expect(policy.capabilityPolicy).toBe("proxy");
  });

  it("does NOT escalate backpressure for discrete AMD RX 6800 XT", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 60; index += 1) {
      controller.observe({ totalTimeUs: 20_000, dropped: true });
    }
    // Discrete GPU — backpressure skipped, always full
    expect(
      controller.policyFor(
        "AMD Radeon RX 6800 XT",
        3840,
        2160,
        undefined,
        undefined,
        "DiscreteGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("does NOT escalate backpressure for Nvidia RTX discrete", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 60; index += 1) {
      controller.observe({ totalTimeUs: 20_000, dropped: true });
    }
    expect(
      controller.policyFor(
        "NVIDIA GeForce RTX 4090",
        3840,
        2160,
        undefined,
        undefined,
        "DiscreteGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("does not react to isolated cold frames", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 60; index += 1) {
      controller.observe({ totalTimeUs: index === 0 ? 100_000 : 10_000, dropped: false });
    }
    expect(
      controller.policyFor(
        "Intel(R) Iris(R) Xe Graphics",
        3840,
        2160,
        undefined,
        undefined,
        "IntegratedGpu",
      ),
    ).toEqual({ capabilityPolicy: "full" });
  });
});
