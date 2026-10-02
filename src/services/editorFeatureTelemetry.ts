/**
 * Editor Feature Telemetry & Validation Service
 *
 * Dedicated telemetry instrumentation and invariant validation for:
 * - Transport J/K/L Shuttle speed shifts and frame jogging
 * - OpenTimelineIO (.otio) export/import interchange pipelines
 * - SMPTE timecode parsing and jump-to-timecode navigation
 * - Advanced NLE editing modes (Slip, Slide, Roll)
 */

import { perfLogService } from "./perfLogService";
import type { OTIOTimeline } from "@/lib/export/otioExporter";

export interface ShuttleTelemetryPayload {
  action: "shuttle-speed" | "jog-step";
  fromSpeed?: number;
  toSpeed?: number;
  direction?: "forward" | "reverse" | "pause" | "step-forward" | "step-backward";
  frameRate?: number;
  playheadTime?: number;
  durationMs?: number;
}

export interface OtioInterchangeTelemetryPayload {
  action: "export" | "import";
  trackCount: number;
  clipCount: number;
  gapCount?: number;
  missingMediaCount?: number;
  fileSizeBytes?: number;
  durationMs: number;
  success: boolean;
  error?: string;
  validationWarnings?: string[];
}

export interface TimecodeJumpTelemetryPayload {
  rawInput: string;
  fromTime: number;
  toTime: number;
  deltaSeconds: number;
  isRelative: boolean;
  frameRate: number;
  dropFrame: boolean;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface PreviewQualityBenchmarkPayload {
  /** GPU tier classification: 'legacy-igpu', 'mid-tier', 'discrete', 'apple-silicon', 'software', 'unknown' */
  gpuTier: string;
  /** Hardware capability policy cap, e.g. 'proxy' | 'reduced' | 'full' */
  capabilityPolicy: string;
  /** Maximum preview dimension enforced by hardware policy (px), or null if unconstrained */
  policyMaxDimension: number | null;
  /** Project canvas width (px) */
  canvasWidth: number;
  /** Project canvas height (px) */
  canvasHeight: number;
  /** Detected resolution bucket e.g. '4K', '1440p', '1080p' */
  resolutionBucket: string;
  /** Whether the engine is hardware-limited for the current project+quality combination */
  isHardwareLimited: boolean;
  /** Currently active preview quality setting */
  previewQuality: string;
  /** GPU adapter name as reported by wgpu */
  gpuModel: string | null;
  /** Graphics backend (e.g. 'metal', 'd3d12') */
  graphicsBackend: string | null;
  /** Per-tier capability snapshot — what the engine can actually render per tier */
  tiers: Array<{
    value: string;
    label: string;
    resolutionLabel: string;
    isHardwareLimited: boolean;
    isRecommended: boolean;
  }>;
}

export class EditorFeatureTelemetry {
  /**
   * Record transport shuttle transitions (1x, 2x, 4x, reverse, pause).
   */
  static recordShuttle(payload: ShuttleTelemetryPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "shuttle-transition",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Record OTIO export or import interchange metrics and validation.
   */
  static recordOtio(payload: OtioInterchangeTelemetryPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "otio-interchange",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Record jump-to-timecode actions.
   */
  static recordTimecodeJump(payload: TimecodeJumpTelemetryPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "timecode-jump",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Records a one-time snapshot of preview quality capabilities and GPU tier
   * so we can correlate hardware constraints with quality choices fleet-wide.
   * Call once per session after GPU status is resolved.
   */
  static recordPreviewQualityBenchmark(payload: PreviewQualityBenchmarkPayload): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "preview-quality-benchmark",
        sessionId,
        timestampEpochMs: Date.now(),
        payload,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Records a snapshot of the native preview performance & benchmark report
   * (e.g. when copied from Diagnostics or during benchmark tests).
   */
  static recordPreviewBenchmarkReport(report: unknown): void {
    try {
      const sessionId = perfLogService.getSessionId() ?? "unknown";
      perfLogService.enqueue({
        kind: "preview-benchmark-report",
        sessionId,
        timestampEpochMs: Date.now(),
        payload: report,
      });
    } catch {
      // Non-blocking telemetry
    }
  }

  /**
   * Validates an exported OTIO timeline against spec invariants.
   */
  static validateOtioExport(timeline: OTIOTimeline): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!timeline.OTIO_SCHEMA || !timeline.OTIO_SCHEMA.startsWith("Timeline.")) {
      errors.push(`Invalid OTIO_SCHEMA: ${timeline.OTIO_SCHEMA}`);
    }
    if (!timeline.tracks || timeline.tracks.OTIO_SCHEMA !== "Stack.1") {
      errors.push("Missing or invalid tracks stack");
    }
    const tracks = timeline.tracks?.children ?? [];
    for (const track of tracks) {
      if (!track.OTIO_SCHEMA?.startsWith("Track.")) {
        errors.push(`Invalid track schema: ${track.OTIO_SCHEMA}`);
      }
      for (const item of track.children ?? []) {
        if (item.source_range) {
          const start = item.source_range.start_time;
          const duration = item.source_range.duration;
          if (start.value < 0) {
            errors.push(`Negative start_time in item ${item.name}: ${start.value}`);
          }
          if (duration.value <= 0) {
            errors.push(`Non-positive duration in item ${item.name}: ${duration.value}`);
          }
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates parsed OTIO import results against Clypra model invariants.
   */
  static validateOtioImport(result: { tracks: { id: string }[]; clips: { id: string; trackId: string; duration: number; startTime: number; trimIn: number }[] }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const trackIds = new Set(result.tracks.map((t) => t.id));
    for (const clip of result.clips) {
      if (!trackIds.has(clip.trackId)) {
        errors.push(`Clip ${clip.id} references missing track ${clip.trackId}`);
      }
      if (clip.duration <= 0) {
        errors.push(`Clip ${clip.id} has non-positive duration: ${clip.duration}`);
      }
      if (clip.startTime < 0) {
        errors.push(`Clip ${clip.id} has negative startTime: ${clip.startTime}`);
      }
      if (clip.trimIn < 0) {
        errors.push(`Clip ${clip.id} has negative trimIn: ${clip.trimIn}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
}
