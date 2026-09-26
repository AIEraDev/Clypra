import { describe, expect, it } from "vitest";
import {
  applyPreviewHardwarePolicy,
  PreviewPerformancePolicyController,
  selectPreviewHardwarePolicy,
} from "../previewHardwarePolicy";

describe("preview hardware policy", () => {
  it("uses a proxy-sized preview for 4K Intel HD 520", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) HD Graphics 520",
      3840,
      2160,
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
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(applyPreviewHardwarePolicy(3840, 2160, "full", policy)).toEqual({
      width: 1280,
      height: 720,
      quality: "proxy",
    });
  });

  it("does not constrain modern Intel or sub-4K previews", () => {
    expect(
      selectPreviewHardwarePolicy("Intel(R) Iris(R) Xe Graphics", 3840, 2160),
    ).toEqual({ capabilityPolicy: "full" });
    expect(
      selectPreviewHardwarePolicy("Intel(R) HD Graphics 520", 1920, 1080),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("steps down modern integrated Intel after a bounded miss burst", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 12; index += 1) {
      controller.observe({ totalTimeUs: index < 3 ? 20_000 : 10_000, dropped: false });
    }
    expect(
      controller.policyFor("Intel(R) Iris(R) Xe Graphics", 3840, 2160),
    ).toMatchObject({ capabilityPolicy: "reduced", maximumQuality: "half" });
  });

  it("does not react to isolated cold frames", () => {
    const controller = new PreviewPerformancePolicyController();
    for (let index = 0; index < 60; index += 1) {
      controller.observe({ totalTimeUs: index === 0 ? 100_000 : 10_000, dropped: false });
    }
    expect(
      controller.policyFor("Intel(R) Iris(R) Xe Graphics", 3840, 2160),
    ).toEqual({ capabilityPolicy: "full" });
  });

  it("uses a proxy-sized preview for 1440p Intel HD 520", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) HD Graphics 520",
      2560,
      1440,
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(applyPreviewHardwarePolicy(2560, 1440, "full", policy)).toEqual({
      width: 1280,
      height: 720,
      quality: "proxy",
    });
  });

  it("uses a proxy-sized preview for Intel UHD 620 and Iris Plus 655", () => {
    const uhdPolicy = selectPreviewHardwarePolicy(
      "Intel(R) UHD Graphics 620",
      3840,
      2160,
    );
    expect(uhdPolicy.capabilityPolicy).toBe("proxy");

    const irisPolicy = selectPreviewHardwarePolicy(
      "Intel(R) Iris(R) Plus Graphics 655",
      3840,
      2160,
    );
    expect(irisPolicy.capabilityPolicy).toBe("proxy");
  });

  it("recognizes 4K media workload even on a 1080p canvas", () => {
    const policy = selectPreviewHardwarePolicy(
      "Intel(R) HD Graphics 520",
      1920,
      1080,
      3840,
      2160,
    );
    expect(policy.capabilityPolicy).toBe("proxy");
    expect(policy.maxDimension).toBe(1280);
    expect(policy.maximumQuality).toBe("proxy");
  });

  it("clamps quality rank down without promoting already lower tiers", () => {
    const halfPolicy = {
      capabilityPolicy: "reduced" as const,
      maxDimension: 1920,
      maximumQuality: "half" as const,
    };
    // full is clamped to half
    expect(applyPreviewHardwarePolicy(1920, 1080, "full", halfPolicy).quality).toBe("half");
    // quarter is preserved (not promoted to half)
    expect(applyPreviewHardwarePolicy(1920, 1080, "quarter", halfPolicy).quality).toBe("quarter");
  });
});
