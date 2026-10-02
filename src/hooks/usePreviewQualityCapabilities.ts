import { useEffect, useRef, useState } from "react";
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";
import { useSettingsStore, type PreviewQuality } from "@/store/settingsStore";
import { useProjectStore } from "@/store/projectStore";
import { isTauriRuntime, getNativeGpuStatus } from "@/lib/platform/tauri";
import type { NativeGpuRuntimeStatus } from "@/lib/platform/nativeCore";
import {
  classifyGpuTier,
  selectPreviewHardwarePolicy,
  type GpuTier,
  type PreviewHardwarePolicy,
} from "@/components/editor/preview/previewHardwarePolicy";

export interface PreviewQualityOption {
  value: PreviewQuality;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
  resolutionLabel: string;
  isHardwareLimited: boolean;
  hardwareLimitReason?: string;
  isRecommended?: boolean;
}

let cachedGpuStatus: NativeGpuRuntimeStatus | null = null;
let gpuStatusPromise: Promise<NativeGpuRuntimeStatus | null> | null = null;

export async function fetchGpuStatusOnce(): Promise<NativeGpuRuntimeStatus | null> {
  if (cachedGpuStatus) return cachedGpuStatus;
  if (!isTauriRuntime()) return null;
  if (!gpuStatusPromise) {
    gpuStatusPromise = getNativeGpuStatus()
      .then((status) => {
        cachedGpuStatus = status;
        return status;
      })
      .catch(() => null);
  }
  return gpuStatusPromise;
}

export function formatDimensionTag(w: number, h: number): string {
  const maxDim = Math.max(w, h);
  const minDim = Math.min(w, h);
  if (maxDim >= 3840 || minDim >= 2160) return "4K";
  if (maxDim >= 2560 || minDim >= 1440) return "1440p";
  if (maxDim >= 1920 || minDim >= 1080) return "1080p";
  if (maxDim >= 1280 || minDim >= 720) return "720p";
  if (maxDim >= 960 || minDim >= 540) return "540p";
  if (maxDim >= 854 || minDim >= 480) return "480p";
  return `${minDim}p`;
}

export function computeQualityOptions(
  canvasWidth: number,
  canvasHeight: number,
  gpuStatus: NativeGpuRuntimeStatus | null,
): {
  tierOptions: PreviewQualityOption[];
  gpuTier: GpuTier;
  hardwarePolicy: PreviewHardwarePolicy;
  is4kProject: boolean;
} {
  const width = Math.max(1, canvasWidth || 1920);
  const height = Math.max(1, canvasHeight || 1080);
  const maxDim = Math.max(width, height);
  const minDim = Math.min(width, height);

  const is4kProject = maxDim >= 3840 || minDim >= 2160;
  const is1440pProject = !is4kProject && (maxDim >= 2560 || minDim >= 1440);

  const adapterName = gpuStatus?.adapterName;
  const deviceType = gpuStatus?.deviceType;

  const gpuTier = classifyGpuTier(adapterName, deviceType);
  const hardwarePolicy = selectPreviewHardwarePolicy(
    adapterName,
    width,
    height,
    undefined,
    undefined,
    deviceType,
  );

  const isLegacyOrSoftware = gpuTier === "legacy-igpu" || gpuTier === "software";
  const cannotHandle4k = isLegacyOrSoftware || hardwarePolicy.capabilityPolicy === "proxy";

  const tierConfigs: Array<{
    value: PreviewQuality;
    scale: number;
    shortLabel: string;
    prefix: string;
  }> = [
    { value: "full", scale: 1.0, shortLabel: "Full", prefix: "Full" },
    { value: "high", scale: 0.75, shortLabel: "High", prefix: "High" },
    { value: "medium", scale: 0.5, shortLabel: "Med", prefix: "Medium" },
    { value: "low", scale: 0.25, shortLabel: "Proxy", prefix: "Proxy" },
  ];

  const tierOptions: PreviewQualityOption[] = tierConfigs.map((config) => {
    const tierWidth = Math.max(1, Math.round(width * config.scale));
    const tierHeight = Math.max(1, Math.round(height * config.scale));
    const tag = formatDimensionTag(tierWidth, tierHeight);
    const label = `${config.prefix} ${tag}`;
    const resolutionLabel = `${tierWidth}×${tierHeight}`;

    let isHardwareLimited = false;
    let hardwareLimitReason: string | undefined;
    let isRecommended = false;

    if (config.value === "full") {
      if ((is4kProject || is1440pProject) && cannotHandle4k) {
        isHardwareLimited = true;
        hardwareLimitReason = `${adapterName || "This GPU"} cannot sustain real-time ${is4kProject ? "4K" : "1440p"} preview. Engine automatically downscales to proxy for smooth playback.`;
      } else if (cannotHandle4k && maxDim > (hardwarePolicy.maxDimension ?? 1280)) {
        isHardwareLimited = true;
        hardwareLimitReason = `${adapterName || "This GPU"} is capped at ${hardwarePolicy.maxDimension ?? 1280}p by hardware policy for real-time playback.`;
      }
    } else if (config.value === "medium" || config.value === "low") {
      if (isLegacyOrSoftware) {
        isRecommended = config.value === "medium";
      }
    }

    return {
      value: config.value,
      label,
      shortLabel: config.shortLabel,
      width: tierWidth,
      height: tierHeight,
      resolutionLabel,
      isHardwareLimited,
      hardwareLimitReason,
      isRecommended,
    };
  });

  return { tierOptions, gpuTier, hardwarePolicy, is4kProject };
}

export function usePreviewQualityCapabilities() {
  const { previewQuality, setPreviewQuality } = useSettingsStore();
  const project = useProjectStore((s) => s.project);
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;

  const [gpuStatus, setGpuStatus] = useState<NativeGpuRuntimeStatus | null>(() => cachedGpuStatus);

  useEffect(() => {
    if (!cachedGpuStatus) {
      let active = true;
      fetchGpuStatusOnce().then((status) => {
        if (active && status) setGpuStatus(status);
      });
      return () => {
        active = false;
      };
    }
  }, []);

  // Emit one-time benchmark telemetry after GPU status is resolved.
  // Uses a separate effect so we only fire after the fetch effect sets gpuStatus.
  const hasBenchmarkedRef = useRef(false);
  useEffect(() => {
    if (!gpuStatus || hasBenchmarkedRef.current) return;
    hasBenchmarkedRef.current = true;

    const { tierOptions, gpuTier, hardwarePolicy, is4kProject } = computeQualityOptions(
      canvasWidth,
      canvasHeight,
      gpuStatus,
    );

    // Determine resolution bucket from project dimensions
    const maxDim = Math.max(canvasWidth, canvasHeight);
    const minDim = Math.min(canvasWidth, canvasHeight);
    const resolutionBucket =
      maxDim >= 3840 || minDim >= 2160 ? "4K" :
      maxDim >= 2560 || minDim >= 1440 ? "1440p" :
      maxDim >= 1920 || minDim >= 1080 ? "1080p" :
      maxDim >= 1280 || minDim >= 720  ? "720p"  : "sub-720p";

    const currentOption = tierOptions.find((t) => t.value === previewQuality) ?? tierOptions[0];

    EditorFeatureTelemetry.recordPreviewQualityBenchmark({
      gpuTier,
      capabilityPolicy: hardwarePolicy.capabilityPolicy ?? "full",
      policyMaxDimension: hardwarePolicy.maxDimension ?? null,
      canvasWidth,
      canvasHeight,
      resolutionBucket,
      isHardwareLimited: currentOption.isHardwareLimited,
      previewQuality,
      gpuModel: gpuStatus.adapterName ?? null,
      graphicsBackend: gpuStatus.backend?.toLowerCase() ?? null,
      tiers: tierOptions.map((t) => ({
        value: t.value,
        label: t.label,
        resolutionLabel: t.resolutionLabel,
        isHardwareLimited: t.isHardwareLimited,
        isRecommended: t.isRecommended ?? false,
      })),
    });
  }, [gpuStatus]);

  const { tierOptions, gpuTier, hardwarePolicy, is4kProject } = computeQualityOptions(
    canvasWidth,
    canvasHeight,
    gpuStatus,
  );

  const currentOption = tierOptions.find((t) => t.value === previewQuality) ?? tierOptions[0];

  return {
    previewQuality,
    setPreviewQuality,
    currentOption,
    tierOptions,
    gpuName: gpuStatus?.adapterName ?? null,
    gpuTier,
    hardwarePolicy,
    is4kProject,
    isHardwareLimited: currentOption.isHardwareLimited,
  };
}
