/**
 * OpenTimelineIO (OTIO) Importer
 *
 * Parses OpenTimelineIO (.otio) JSON data into Clypra-compatible
 * Project, Track, Clip, and MediaAsset structures.
 */

import type { Clip, Track, MediaAsset, TrackType } from "@/types";
import { generateId } from "@/lib/utils/id";
import type { OTIOTimeline, OTIOTrackChild, OTIOClip, OTIOGap } from "./otioExporter";
import { EditorFeatureTelemetry } from "@/services/editorFeatureTelemetry";

export interface OTIOImportResult {
  projectName: string;
  frameRate: number;
  tracks: Track[];
  clips: Clip[];
  mediaAssets: MediaAsset[];
}

/**
 * Strips "file://" URL scheme and decodes URI components.
 */
function fromFileUrl(url: string): string {
  if (url.startsWith("file://")) {
    const withoutScheme = url.slice(7);
    const decoded = decodeURIComponent(withoutScheme);
    // On Windows, file:///C:/path -> C:/path
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  }
  return decodeURIComponent(url);
}

/**
 * Parses an OTIO JSON string or object and converts it to Clypra timeline entities.
 */
export function importFromOTIO(otioInput: string | OTIOTimeline): OTIOImportResult {
  const t0 = performance.now();
  let gapCount = 0;
  let missingMediaCount = 0;

  try {
    const otio: OTIOTimeline = typeof otioInput === "string" ? JSON.parse(otioInput) : otioInput;

    if (otio.OTIO_SCHEMA !== "Timeline.1") {
      throw new Error(`Unsupported OTIO schema: ${(otio as any).OTIO_SCHEMA || "unknown"}. Expected Timeline.1`);
    }

    const frameRate = otio.global_start_time?.rate && otio.global_start_time.rate > 0
      ? otio.global_start_time.rate
      : 30;
    const projectName = otio.name || "Imported OTIO Timeline";

    const tracks: Track[] = [];
    const clips: Clip[] = [];
    const mediaAssets: MediaAsset[] = [];
    const assetMapByUrl = new Map<string, MediaAsset>();

    const otioTracks = otio.tracks?.children || [];

    for (let trackIdx = 0; trackIdx < otioTracks.length; trackIdx++) {
      const otioTrack = otioTracks[trackIdx];
      const isAudio = otioTrack.kind === "Audio";
      const trackType: TrackType = isAudio ? "audio" : "video";
      const trackId = (otioTrack.metadata?.clypra as any)?.id || generateId("track");

      const track: Track = {
        id: trackId,
        type: trackType,
        name: otioTrack.name || (isAudio ? `A${trackIdx + 1}` : `V${trackIdx + 1}`),
        muted: Boolean((otioTrack.metadata?.clypra as any)?.muted),
        locked: Boolean((otioTrack.metadata?.clypra as any)?.locked),
        visible: (otioTrack.metadata?.clypra as any)?.visible !== false,
        height: (otioTrack.metadata?.clypra as any)?.height || (isAudio ? 48 : 64),
        volume: typeof (otioTrack.metadata?.clypra as any)?.volume === "number" ? (otioTrack.metadata?.clypra as any).volume : 1.0,
      };
      tracks.push(track);

      let timelineCursorSec = 0;
      const children = otioTrack.children || [];

      for (const child of children) {
        const schema = child.OTIO_SCHEMA;

        if (schema === "Gap.1") {
          gapCount++;
          const gap = child as OTIOGap;
          const rate = gap.source_range?.duration?.rate || frameRate;
          const durationSec = (gap.source_range?.duration?.value ?? 0) / rate;
          timelineCursorSec += durationSec;
          continue;
        }

        if (schema?.startsWith("Clip")) {
          const otioClip = child as OTIOClip;
          const clipRate = otioClip.source_range?.duration?.rate || frameRate;
          const durationSec = (otioClip.source_range?.duration?.value ?? 0) / clipRate;
          const inRate = otioClip.source_range?.start_time?.rate || frameRate;
          const trimInSec = (otioClip.source_range?.start_time?.value ?? 0) / inRate;
          const trimOutSec = trimInSec + durationSec;

          // Resolve or create MediaAsset
          let mediaId = (otioClip.metadata?.clypra as any)?.mediaId || "";
          const targetUrl = (otioClip.media_reference as any)?.target_url;

          if (targetUrl) {
            const filePath = fromFileUrl(targetUrl);
            let asset = assetMapByUrl.get(filePath);
            if (!asset) {
              const newAsset: MediaAsset = {
                id: mediaId || generateId("asset"),
                name: otioClip.media_reference?.name || otioClip.name || "Media Asset",
                path: filePath,
                type: isAudio ? "audio" : "video",
                duration: durationSec + trimInSec,
                size: 0,
              };
              asset = newAsset;
              assetMapByUrl.set(filePath, newAsset);
              mediaAssets.push(newAsset);
            }
            mediaId = asset.id;
          } else {
            missingMediaCount++;
          }

          if (!mediaId) {
            mediaId = generateId("asset");
          }

          const clypraMeta = (otioClip.metadata?.clypra as any) || {};

          // Parse speed/freeze effects
          let speed = 1.0;
          let isFreeze = false;
          if (Array.isArray(otioClip.effects)) {
            for (const effect of otioClip.effects) {
              if ((effect as any).OTIO_SCHEMA === "FreezeFrame.1") {
                isFreeze = true;
              } else if ((effect as any).OTIO_SCHEMA === "LinearTimeWarp.1") {
                speed = (effect as any).time_scalar || 1.0;
              }
            }
          }

          const clip: Clip = {
            id: clypraMeta.id || generateId("clip"),
            name: otioClip.name || "Imported Clip",
            trackId: track.id,
            mediaId,
            startTime: timelineCursorSec,
            duration: durationSec,
            trimIn: trimInSec,
            trimOut: trimOutSec,
            x: clypraMeta.x ?? 0,
            y: clypraMeta.y ?? 0,
            width: clypraMeta.width ?? 1920,
            height: clypraMeta.height ?? 1080,
            opacity: clypraMeta.opacity ?? 1.0,
            rotation: clypraMeta.rotation ?? 0,
            volume: clypraMeta.volume ?? 1.0,
            blendMode: clypraMeta.blendMode ?? "normal",
            speed,
            playbackMapping: isFreeze
              ? { kind: "freeze", atSourceTime: trimInSec }
              : { kind: "normal", speed },
          };

          clips.push(clip);
          timelineCursorSec += durationSec;
        }
      }
    }

    const result: OTIOImportResult = {
      projectName,
      frameRate,
      tracks,
      clips,
      mediaAssets,
    };

    const validation = EditorFeatureTelemetry.validateOtioImport({ tracks, clips });
    EditorFeatureTelemetry.recordOtio({
      action: "import",
      trackCount: tracks.length,
      clipCount: clips.length,
      gapCount,
      missingMediaCount,
      durationMs: performance.now() - t0,
      success: validation.valid,
      validationWarnings: validation.errors.length > 0 ? validation.errors : undefined,
    });

    return result;
  } catch (err: any) {
    EditorFeatureTelemetry.recordOtio({
      action: "import",
      trackCount: 0,
      clipCount: 0,
      gapCount,
      missingMediaCount,
      durationMs: performance.now() - t0,
      success: false,
      error: err?.message || String(err),
    });
    throw err;
  }
}
