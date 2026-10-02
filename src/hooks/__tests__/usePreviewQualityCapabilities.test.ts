import { describe, expect, it } from "vitest";
import { computeQualityOptions, formatDimensionTag } from "../usePreviewQualityCapabilities";
import type { NativeGpuRuntimeStatus } from "@/lib/platform/nativeCore";

const mockGpu = (adapterName: string, deviceType: string): NativeGpuRuntimeStatus => ({
  contractVersion: 2,
  state: "ready",
  available: true,
  adapterName,
  backend: "Dx12",
  requestedBackend: null,
  deviceType: deviceType as any,
  vendorId: 0,
  deviceId: 0,
  driver: "",
  driverInfo: "",
  isSoftwareAdapter: false,
  surfaceAvailable: false,
  failureReason: null,
});

describe("formatDimensionTag", () => {
  it("recognizes standard resolutions in 16:9 landscape", () => {
    expect(formatDimensionTag(3840, 2160)).toBe("4K");
    expect(formatDimensionTag(2560, 1440)).toBe("1440p");
    expect(formatDimensionTag(1920, 1080)).toBe("1080p");
    expect(formatDimensionTag(1280, 720)).toBe("720p");
    expect(formatDimensionTag(960, 540)).toBe("540p");
    expect(formatDimensionTag(854, 480)).toBe("480p");
  });

  it("recognizes 9:16 vertical video resolutions correctly", () => {
    expect(formatDimensionTag(2160, 3840)).toBe("4K");
    expect(formatDimensionTag(1440, 2560)).toBe("1440p");
    expect(formatDimensionTag(1080, 1920)).toBe("1080p");
    expect(formatDimensionTag(720, 1280)).toBe("720p");
  });
});

describe("computeQualityOptions", () => {
  it("synchronizes labels for a 1080p project on discrete GPU without falsely claiming 4K", () => {
    const gpu = mockGpu("NVIDIA GeForce RTX 4080", "DiscreteGpu");
    const { tierOptions, is4kProject } = computeQualityOptions(1920, 1080, gpu);

    expect(is4kProject).toBe(false);

    const fullTier = tierOptions.find((t) => t.value === "full")!;
    expect(fullTier.label).toBe("Full 1080p");
    expect(fullTier.resolutionLabel).toBe("1920×1080");
    expect(fullTier.isHardwareLimited).toBe(false);

    const highTier = tierOptions.find((t) => t.value === "high")!;
    expect(highTier.label).toBe("High 720p");
    expect(highTier.resolutionLabel).toBe("1440×810");

    const medTier = tierOptions.find((t) => t.value === "medium")!;
    expect(medTier.label).toBe("Medium 540p");
    expect(medTier.resolutionLabel).toBe("960×540");

    const lowTier = tierOptions.find((t) => t.value === "low")!;
    expect(lowTier.label).toBe("Proxy 270p");
    expect(lowTier.resolutionLabel).toBe("480×270");
  });

  it("highlights 4K hardware limitation when running 4K project on legacy Intel HD 520 iGPU", () => {
    const gpu = mockGpu("Intel(R) HD Graphics 520", "IntegratedGpu");
    const { tierOptions, is4kProject, gpuTier } = computeQualityOptions(3840, 2160, gpu);

    expect(is4kProject).toBe(true);
    expect(gpuTier).toBe("legacy-igpu");

    const fullTier = tierOptions.find((t) => t.value === "full")!;
    expect(fullTier.label).toBe("Full 4K");
    expect(fullTier.resolutionLabel).toBe("3840×2160");
    expect(fullTier.isHardwareLimited).toBe(true);
    expect(fullTier.hardwareLimitReason).toContain("cannot sustain real-time 4K preview");

    const medTier = tierOptions.find((t) => t.value === "medium")!;
    expect(medTier.isRecommended).toBe(true);
  });

  it("permits full 4K without limitation on powerful discrete GPU", () => {
    const gpu = mockGpu("NVIDIA GeForce RTX 4090", "DiscreteGpu");
    const { tierOptions, is4kProject } = computeQualityOptions(3840, 2160, gpu);

    expect(is4kProject).toBe(true);
    const fullTier = tierOptions.find((t) => t.value === "full")!;
    expect(fullTier.label).toBe("Full 4K");
    expect(fullTier.isHardwareLimited).toBe(false);
  });
});
