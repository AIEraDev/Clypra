/**
 * Add Reaction Clip to Timeline Action
 *
 * Pure async action (no React hooks) that:
 * 1. Captures timeline epoch before async download (epoch guard)
 * 2. Downloads & SHA-256 verifies the clip via useClipDownloadStore
 * 3. Aborts cleanly if the project closed or timeline epoch changed mid-download
 * 4. Probes the local file via platform.getMediaMetadata and imports it as a MediaAsset
 * 5. Places the clip on a new overlay video track at the playhead in a single
 *    undoable transaction (AddTrackCommand + AddClipCommand) with PiP transform
 *    (40% scale, bottom-right, 5% safe margin) and -6 dB default audio volume.
 */

import { platform } from "@/core/platform";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { AddClipCommand } from "@/core/history/commands";
import { AddTrackCommand } from "@/core/history/commands/TrackCommands";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { generateId } from "@/lib/utils/id";
import { i18n } from "@/i18n";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import {
  getInsertIndexForNewTrack,
  useTimelineStore,
} from "@/store/timelineStore";
import type { MediaAsset, Track } from "@/types";
import { normalizeClipAudioProperties } from "@/types/audio";
import { useClipDownloadStore } from "../store/clipDownloadStore";
import {
  DiskFullError,
  DownloadAbortedError,
  HashMismatchError,
  type ClipItem,
} from "../types";

/** -6 dB linear audio gain: 10^(-6/20) ≈ 0.501187 */
export const REACTION_CLIP_DEFAULT_VOLUME = Math.pow(10, -6 / 20);
/** -6 dB — canonical gain stored in clip.audio.gainDb */
export const REACTION_CLIP_DEFAULT_GAIN_DB = -6;
export const REACTION_CLIP_PIP_SCALE = 0.4;
export const REACTION_CLIP_SAFE_MARGIN = 0.05;

export interface AddClipToTimelineResult {
  success: boolean;
  clipId?: string;
  trackId?: string;
  cancelled?: boolean;
  error?: string;
}

export async function addClipToTimeline(
  item: ClipItem,
): Promise<AddClipToTimelineResult> {
  const timelineBefore = useTimelineStore.getState();
  const projectBefore = useProjectStore.getState().project;
  const startEpoch = timelineBefore.epoch;
  const startProjectId = projectBefore?.id;

  let localPath: string;
  try {
    localPath = await useClipDownloadStore.getState().startDownload(item);
  } catch (err) {
    if (err instanceof DownloadAbortedError) {
      return { success: false, cancelled: true, error: err.message };
    }
    const msg =
      err instanceof HashMismatchError
        ? i18n.t("clips.error.hashMismatch")
        : err instanceof DiskFullError
          ? i18n.t("clips.error.diskFull")
          : err instanceof Error
            ? err.message
            : i18n.t("clips.error.title");
    useProjectStore.getState().showToast?.(msg, "error");
    return { success: false, error: msg };
  }

  // Epoch / project-close guard after async download
  const timelineAfterDownload = useTimelineStore.getState();
  const projectAfterDownload = useProjectStore.getState().project;
  if (
    timelineAfterDownload.epoch !== startEpoch ||
    (startProjectId && projectAfterDownload?.id !== startProjectId)
  ) {
    useClipDownloadStore.getState().cancelDownload(item.id);
    return {
      success: false,
      cancelled: true,
      error: "Project or timeline changed during download",
    };
  }

  if (!localPath) {
    const msg = i18n.t("clips.error.title");
    useProjectStore.getState().showToast?.(msg, "error");
    return { success: false, error: msg };
  }

  let transactionStarted = false;
  const history = useHistoryStore.getState();

  try {
    const metadata = await platform.getMediaMetadata(localPath);

    // Re-check epoch after async probe
    if (useTimelineStore.getState().epoch !== startEpoch) {
      return {
        success: false,
        cancelled: true,
        error: "Timeline changed during media probe",
      };
    }

    const assetWidth = metadata.width || item.width || 640;
    const assetHeight = metadata.height || item.height || 360;
    const duration = metadata.duration || item.durationSec;

    // Do NOT pre-seed streams. addMediaAsset() eagerly fires a background
    // probeMediaStreams() call whenever asset.streams is undefined, which
    // populates real codec/sample-rate/channel data from FFmpeg. The
    // manifest's hasAudio flag is advisory only; the authoritative source is
    // the probe result. During the brief probe window, assetHasAudio() returns
    // false (by design — the race-condition guard in assetHasAudio), so the
    // clip is temporarily excluded from the native preview mixer. After the
    // probe completes and updateMediaAsset fires, the next getActiveAudioClips
    // poll includes the clip. This is identical to how MediaTab imports work.
    const asset: MediaAsset = {
      id: generateId("asset"),
      name: item.title,
      path: localPath,
      type: "video",
      duration,
      width: assetWidth,
      height: assetHeight,
      size: item.bytes,
      // streams intentionally omitted — background probe fills this in
    };

    useProjectStore.getState().addMediaAsset(asset);

    const currentProject = useProjectStore.getState().project;
    const canvasW = currentProject?.canvasWidth || 1920;
    const canvasH = currentProject?.canvasHeight || 1080;

    // PiP transform: ~40% scale, bottom-right with 5% safe margin
    const aspect = assetHeight > 0 ? assetWidth / assetHeight : 16 / 9;
    let pipW = Math.round(canvasW * REACTION_CLIP_PIP_SCALE);
    let pipH = Math.round(pipW / aspect);
    const maxPipH = Math.round(canvasH * REACTION_CLIP_PIP_SCALE);
    if (pipH > maxPipH) {
      pipH = maxPipH;
      pipW = Math.round(pipH * aspect);
    }
    const marginX = Math.round(canvasW * REACTION_CLIP_SAFE_MARGIN);
    const marginY = Math.round(canvasH * REACTION_CLIP_SAFE_MARGIN);
    const pipX = canvasW - pipW - marginX;
    const pipY = canvasH - pipH - marginY;

    const playheadTime = Math.max(0, getPlaybackClock().currentTime || 0);

    history.beginTransaction("Add Reaction Clip");
    transactionStarted = true;

    const tracks = useTimelineStore.getState().tracks;
    const insertIndex = getInsertIndexForNewTrack(tracks, "video");
    const newTrack: Track = {
      id: generateId("track"),
      type: "video",
      name: item.title,
      muted: false,
      locked: false,
      visible: true,
      height: 64,
    };
    history.execute(new AddTrackCommand(newTrack, insertIndex));

    const baseClip = createClipFromAsset({
      asset,
      trackId: newTrack.id,
      startTime: playheadTime,
      width: canvasW,
      height: canvasH,
      fitMode: "contain",
    });

    // Set audio gain via the canonical `audio` sub-object. normalizeClipAudioProperties
    // reads `fields.audio.gainDb` as the primary source; the legacy `volume` field is
    // the fallback. We pass gainDb inside the nested `audio` object so it takes
    // priority over the default gainDb: 0 that createClipFromAsset seeds.
    //
    // We do NOT also set the top-level `volume` field. That field is the legacy
    // fallback read only when `clip.audio` is absent. Setting it alongside
    // `audio.gainDb` creates two sources of truth and risks confusion for future
    // readers. The pipeline path is:
    //   clip.audio.gainDb (-6) → getClipAudioProperties → evaluateEffectiveAudioState
    //   → staticGain (0.5012) → ExportAudioClipConfig.volume → Rust mixer
    const reactionClip = {
      ...baseClip,
      x: pipX,
      y: pipY,
      width: pipW,
      height: pipH,
      audio: normalizeClipAudioProperties({
        kind: "video",
        audio: {
          ...((baseClip as any).audio ?? {}),
          gainDb: REACTION_CLIP_DEFAULT_GAIN_DB,
        },
      }),
      kind: "video" as const,
    };

    history.execute(new AddClipCommand(reactionClip));
    history.commitTransaction();
    transactionStarted = false;

    return {
      success: true,
      clipId: reactionClip.id,
      trackId: newTrack.id,
    };
  } catch (err) {
    if (transactionStarted) {
      history.rollbackTransaction();
    }
    const msg = err instanceof Error ? err.message : i18n.t("clips.error.title");
    useProjectStore.getState().showToast?.(msg, "error");
    return { success: false, error: msg };
  }
}
