/**
 * Versioned provenance fields shared by the perf-log writer and offline
 * analyzers.  The raw NDJSON transport remains append-only during migration;
 * these fields make new records self-describing without invalidating legacy
 * sessions.
 */

export const PERF_SCHEMA_VERSION = 2 as const;

export type PerfScope =
  | "diagnostics.writer"
  | "engine.native"
  | "frontend.webview"
  | "bridge.ipc"
  | "worker.compute"
  | "filmstrip.native";

export type PreviewContextKind =
  | "native_metal_surface"
  | "native_d3d_surface"
  | "native_vulkan_surface"
  | "dom_canvas"
  | "unknown";

export interface PerfLogBuildIdentity {
  applicationVersion: string;
  gitCommit?: string | null;
  gitDirty: boolean;
  gitTree?: string | null;
  gitDiffHash?: string | null;
  optLevel: string;
  debugAssertions: boolean;
  ffmpegVersion: string;
  instrumentationPatchHash?: string | null;
  perfDriverEnabled: boolean;
  binaryHash?: string | null;
}

export interface PerfLogSystemFingerprint {
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cpuCores: number;
  ramBytes: number;
  gpuAdapter: string;
  gpuVendor: string;
  driverVersion: string;
  graphicsBackend: string;
  displayRefreshRate: number;
  powerSource: string;
  lowPowerMode?: boolean | null;
  thermalState: string;
}

export interface PerfSessionHeader {
  schemaVersion: number;
  sessionId: string;
  openedAtEpochMs: number;
  build: PerfLogBuildIdentity;
  system: PerfLogSystemFingerprint;
  resolvedFlags: Record<string, boolean>;
  decodePolicy?: "auto" | "cpu" | "metal" | "dxgi";
  decodePolicySource?: string;
  decodePolicyEffective?: "auto" | "cpu" | "metal" | "dxgi";
  decodePolicyRejectionReason?: string | null;
  unverifiedCapabilityOverride?: boolean;
  unverifiedCapabilitiesVerified?: boolean;
  ffmpegCallbackVerified?: boolean;
  mediaHash?: string | null;
  projectHash?: string | null;
  scenarioId?: string | null;
  scenarioHash?: string | null;
  experimentArm?: string | null;
  validationMode: boolean;
}

export interface PreviewContextRecord {
  previewContextId: number;
  kind: PreviewContextKind;
  role: "program" | "source" | "filmstrip" | "unknown";
  surface: {
    width: number;
    height: number;
    dpr: number;
  };
  pipeline: string[];
  fpsTarget: number;
  streamKeys: string[];
  presenterMode: "native-surface" | "bridge";
  fallbackReason?: string;
}

export function scopeForPerfKind(kind: string): PerfScope {
  if (
    kind === "engine-telemetry" ||
    kind === "engine-frame-telemetry" ||
    kind === "engine-qos-decision" ||
    kind === "engine-seek-telemetry"
  ) {
    return "engine.native";
  }
  if (kind === "native-sync" || kind === "native-session-telemetry") {
    return "engine.native";
  }
  if (kind === "session-header" || kind === "session-footer") return "diagnostics.writer";
  if (kind === "preview-context") return "frontend.webview";
  if (kind === "worker-rollup" || kind === "animation-eval") {
    return "worker.compute";
  }
  if (kind === "filmstrip-rollup") return "filmstrip.native";
  if (kind === "playback-trace" || kind === "frontend-rollup") {
    return "frontend.webview";
  }
  return "bridge.ipc";
}
