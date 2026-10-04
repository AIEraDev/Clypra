/**
 * OpenTimelineIO (OTIO) Exporter
 *
 * Converts Clypra timeline and project state into the industry-standard
 * OpenTimelineIO (.otio) JSON specification for seamless interchange with
 * DaVinci Resolve, Adobe Premiere Pro, Final Cut Pro, and Blender.
 *
 * Specification: https://opentimelineio.readthedocs.io/
 */

import type { Clip, Track, MediaAsset } from "@/types";
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";

// ─── OTIO Schema Typings ──────────────────────────────────────────────────────

export interface OTIORationalTime {
  OTIO_SCHEMA: "RationalTime.1";
  value: number;
  rate: number;
}

export interface OTIOTimeRange {
  OTIO_SCHEMA: "TimeRange.1";
  start_time: OTIORationalTime;
  duration: OTIORationalTime;
}

export interface OTIOMediaReferenceExternal {
  OTIO_SCHEMA: "ExternalReference.1";
  metadata?: Record<string, unknown>;
  name?: string;
  target_url: string;
  available_range?: OTIOTimeRange | null;
}

export interface OTIOMediaReferenceMissing {
  OTIO_SCHEMA: "MissingReference.1";
  metadata?: Record<string, unknown>;
  name?: string;
}

export type OTIOMediaReference = OTIOMediaReferenceExternal | OTIOMediaReferenceMissing;

export interface OTIOEffectLinearTimeWarp {
  OTIO_SCHEMA: "LinearTimeWarp.1";
  name: string;
  time_scalar: number;
  metadata?: Record<string, unknown>;
}

export interface OTIOEffectFreezeFrame {
  OTIO_SCHEMA: "FreezeFrame.1";
  name: string;
  metadata?: Record<string, unknown>;
}

export type OTIOEffect = OTIOEffectLinearTimeWarp | OTIOEffectFreezeFrame | Record<string, unknown>;

export interface OTIOClip {
  OTIO_SCHEMA: "Clip.2";
  name: string;
  metadata?: Record<string, unknown>;
  source_range: OTIOTimeRange;
  media_reference: OTIOMediaReference;
  effects?: OTIOEffect[];
}

export interface OTIOGap {
  OTIO_SCHEMA: "Gap.1";
  name?: string;
  metadata?: Record<string, unknown>;
  source_range: OTIOTimeRange;
}

export type OTIOTrackChild = OTIOClip | OTIOGap;

export interface OTIOTrack {
  OTIO_SCHEMA: "Track.1";
  name: string;
  kind: "Video" | "Audio";
  metadata?: Record<string, unknown>;
  children: OTIOTrackChild[];
}

export interface OTIOStack {
  OTIO_SCHEMA: "Stack.1";
  name: string;
  metadata?: Record<string, unknown>;
  children: OTIOTrack[];
}

export interface OTIOTimeline {
  OTIO_SCHEMA: "Timeline.1";
  name: string;
  metadata?: Record<string, unknown>;
  global_start_time?: OTIORationalTime;
  tracks: OTIOStack;
}

// ─── Export Input ─────────────────────────────────────────────────────────────

export interface OTIOExportOptions {
  projectName?: string;
  frameRate?: number;
  tracks: Track[];
  clips: Clip[];
  mediaAssets?: MediaAsset[];
}

/**
 * Creates an OTIORationalTime with rounded frame value.
 */
export function createRationalTime(seconds: number, rate: number): OTIORationalTime {
  return {
    OTIO_SCHEMA: "RationalTime.1",
    value: Math.round(seconds * rate),
    rate,
  };
}

/**
 * Creates an OTIOTimeRange.
 */
export function createTimeRange(startSeconds: number, durationSeconds: number, rate: number): OTIOTimeRange {
  return {
    OTIO_SCHEMA: "TimeRange.1",
    start_time: createRationalTime(startSeconds, rate),
    duration: createRationalTime(durationSeconds, rate),
  };
}

/**
 * Formats a file system path as a standard file URL for ExternalReference.
 */
export function toFileUrl(filePath: string): string {
  if (filePath.startsWith("file://") || filePath.startsWith("http://") || filePath.startsWith("https://")) {
    return filePath;
  }
  const normalized = filePath.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

/**
 * Serializes Clypra timeline and project state into an OpenTimelineIO (OTIO) object.
 */
export function exportToOTIO(options: OTIOExportOptions): OTIOTimeline {
  const t0 = performance.now();
  let gapCount = 0;
  let missingMediaCount = 0;

  try {
    const frameRate = options.frameRate && options.frameRate > 0 ? options.frameRate : 30;
    const projectName = options.projectName || "Clypra Timeline";
    const assetsById = new Map<string, MediaAsset>();

    if (options.mediaAssets) {
      for (const asset of options.mediaAssets) {
        assetsById.set(asset.id, asset);
      }
    }

    const otioTracks: OTIOTrack[] = [];

    for (const track of options.tracks) {
      const isAudio = track.type === "audio";
      const otioKind = isAudio ? "Audio" : "Video";

      // Gather and sort all clips belonging to this track
      const trackClips = options.clips
        .filter((clip) => clip.trackId === track.id)
        .sort((a, b) => a.startTime - b.startTime);

      const children: OTIOTrackChild[] = [];
      let trackCursorSec = 0;
      const EPSILON = 0.5 / frameRate;

      for (const clip of trackClips) {
        // If there is empty space before this clip, fill with an OTIO Gap
        if (clip.startTime > trackCursorSec + EPSILON) {
          const gapDurationSec = clip.startTime - trackCursorSec;
          const gapFrames = Math.round(gapDurationSec * frameRate);
          if (gapFrames > 0) {
            gapCount++;
            children.push({
              OTIO_SCHEMA: "Gap.1",
              name: "Gap",
              source_range: {
                OTIO_SCHEMA: "TimeRange.1",
                start_time: {
                  OTIO_SCHEMA: "RationalTime.1",
                  value: 0,
                  rate: frameRate,
                },
                duration: {
                  OTIO_SCHEMA: "RationalTime.1",
                  value: gapFrames,
                  rate: frameRate,
                },
              },
            });
          }
        }

        // Resolve media reference
        const asset = assetsById.get(clip.mediaId);
        let mediaReference: OTIOMediaReference;

        if (asset?.path) {
          mediaReference = {
            OTIO_SCHEMA: "ExternalReference.1",
            name: asset.name || clip.name || "Media",
            target_url: toFileUrl(asset.path),
          };
        } else {
          missingMediaCount++;
          mediaReference = {
            OTIO_SCHEMA: "MissingReference.1",
            name: clip.name || "Missing Media",
          };
        }

        // Check effects (Speed / Freeze)
        const effects: OTIOEffect[] = [];
        if (clip.playbackMapping?.kind === "freeze") {
          effects.push({
            OTIO_SCHEMA: "FreezeFrame.1",
            name: "Freeze Frame",
          });
        } else if (
          clip.playbackMapping?.kind === "normal" &&
          Math.abs(clip.playbackMapping.speed - 1.0) > 0.001
        ) {
          effects.push({
            OTIO_SCHEMA: "LinearTimeWarp.1",
            name: "Speed",
            time_scalar: clip.playbackMapping.speed,
          });
        } else if (clip.speed && Math.abs(clip.speed - 1.0) > 0.001) {
          effects.push({
            OTIO_SCHEMA: "LinearTimeWarp.1",
            name: "Speed",
            time_scalar: clip.speed,
          });
        }

        const otioClip: OTIOClip = {
          OTIO_SCHEMA: "Clip.2",
          name: clip.name || asset?.name || "Clip",
          source_range: createTimeRange(clip.trimIn, clip.duration, frameRate),
          media_reference: mediaReference,
          metadata: {
            clypra: {
              id: clip.id,
              trackId: clip.trackId,
              mediaId: clip.mediaId,
              volume: clip.volume ?? 1.0,
              opacity: clip.opacity ?? 1.0,
              x: clip.x ?? 0,
              y: clip.y ?? 0,
              rotation: clip.rotation ?? 0,
              blendMode: clip.blendMode ?? "normal",
            },
          },
        };

        if (effects.length > 0) {
          otioClip.effects = effects;
        }

        children.push(otioClip);
        trackCursorSec = clip.startTime + clip.duration;
      }

      otioTracks.push({
        OTIO_SCHEMA: "Track.1",
        name: track.name || `${otioKind} Track`,
        kind: otioKind,
        metadata: {
          clypra: {
            id: track.id,
            muted: track.muted,
            locked: track.locked,
            visible: track.visible,
            height: track.height,
            volume: track.volume ?? 1.0,
          },
        },
        children,
      });
    }

    const timeline: OTIOTimeline = {
      OTIO_SCHEMA: "Timeline.1",
      name: projectName,
      global_start_time: {
        OTIO_SCHEMA: "RationalTime.1",
        value: 0,
        rate: frameRate,
      },
      metadata: {
        clypra: {
          version: "1.5.9",
          exportedAt: new Date().toISOString(),
        },
      },
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "tracks",
        children: otioTracks,
      },
    };

    const validation = EditorFeatureTelemetry.validateOtioExport(timeline);
    EditorFeatureTelemetry.recordOtio({
      action: "export",
      trackCount: options.tracks.length,
      clipCount: options.clips.length,
      gapCount,
      missingMediaCount,
      durationMs: performance.now() - t0,
      success: validation.valid,
      validationWarnings: validation.errors.length > 0 ? validation.errors : undefined,
    });

    return timeline;
  } catch (err: any) {
    EditorFeatureTelemetry.recordOtio({
      action: "export",
      trackCount: options.tracks?.length ?? 0,
      clipCount: options.clips?.length ?? 0,
      gapCount,
      missingMediaCount,
      durationMs: performance.now() - t0,
      success: false,
      error: err?.message || String(err),
    });
    throw err;
  }
}

/**
 * Serializes Clypra timeline and project state to a formatted OTIO JSON string.
 */
export function exportToOTIOJson(options: OTIOExportOptions): string {
  const otio = exportToOTIO(options);
  return JSON.stringify(otio, null, 2);
}
