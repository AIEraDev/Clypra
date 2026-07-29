// Re-export new render engine types (non-breaking alongside existing DENSITY_CONFIGS)
export type { SpatialTier, TemporalTier, VelocityState } from "../renderEngine/types";
export { VELOCITY_THRESHOLDS, classifyVelocity } from "../renderEngine/types";

import type { DragItem, Track, Clip, DensityConfig, DensityLevel } from "../../types";
import { useTimelineStore } from "../../store/timelineStore";
import { useProjectStore } from "../../store/projectStore";
import { useUIStore } from "../../store/uiStore";
import { useHistoryStore } from "../../store/historyStore";
import { AddTrackCommand, AddClipCommand, DeleteClipCommand, InsertEditCommand } from "../../core/history/commands";
import { capitalize } from "../utils";
import { DensityLevel as DensityLevelEnum } from "../../types";
import { createClipFromAsset } from "./timelineClip";
import { autoAdaptSequenceForFirstVisualClip } from "../sequence/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveClipStartTime } from "./placementPolicy";
import { generateId } from "@/lib/utils/id";
import { resolveInsertEdit } from "./insertEdit";
import { getTimelineLaneClientX } from "./timelineViewport";

// Density configurations mapping zoom levels to extraction densities. Each configuration defines the time interval between thumbnails and the zoom range.
export const DENSITY_CONFIGS: DensityConfig[] = [
  { level: DensityLevelEnum.Low, interval: 5.0, minZoom: 0, maxZoom: 0.3 },
  { level: DensityLevelEnum.Medium, interval: 1.0, minZoom: 0.3, maxZoom: 1.5 },
  { level: DensityLevelEnum.High, interval: 0.2, minZoom: 1.5, maxZoom: 3.0 },
  { level: DensityLevelEnum.Ultra, interval: 0.05, minZoom: 3.0, maxZoom: Infinity },
];

// Maps a zoom level (pixels per second) to the appropriate density level.
export function getDensityForZoom(pixelsPerSecond: number): DensityLevel {
  for (const config of DENSITY_CONFIGS) {
    if (pixelsPerSecond >= config.minZoom && pixelsPerSecond < config.maxZoom) {
      return config.level;
    }
  }
  return DensityLevelEnum.Ultra;
}

// Returns the time interval (in seconds) for a given density level.
export function getIntervalForDensity(density: DensityLevel): number {
  const config = DENSITY_CONFIGS.find((c) => c.level === density);
  return config?.interval ?? 1.0;
}

// Generates a globally-aligned timestamp grid for a clip range.
// Aligns to a global origin so clips from the same video share cached frames.
// Uses multiplication (not accumulation) to avoid float drift at Ultra density.
export function generateTimestampGrid(trimIn: number, trimOut: number, interval: number, videoDuration: number): number[] {
  // Align to global grid: floor(trimIn / interval) × interval
  const gridStart = Math.floor(trimIn / interval) * interval;

  const timestamps: number[] = [];
  let step = 0;

  // Use multiplication instead of accumulation to avoid float drift at Ultra density
  while (true) {
    const t = Math.round((gridStart + step * interval) * 1000) / 1000;
    if (t > trimOut) break;

    // Clamp to valid video range [0, videoDuration] rather than dropping out-of-range
    // timestamps. This ensures the grid always covers the full clip range even when
    // gridStart falls slightly before t=0 (e.g. trimIn=0.3s, interval=5s → gridStart=0).
    const clamped = Math.min(Math.max(t, 0), videoDuration);
    timestamps.push(clamped);
    step++;
  }

  // Sort and deduplicate — clamping can produce duplicate values when multiple
  // pre-zero steps all clamp to 0, or when trimOut equals videoDuration exactly.
  const seen = new Set<number>();
  return timestamps
    .sort((a, b) => a - b)
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

export function handleCreateTrackAndDrop(item: DragItem, monitor: any, insertIndex: number) {
  const { tracks, pixelsPerSecond, scrollLeft } = useTimelineStore.getState();
  const { execute } = useHistoryStore.getState();

  const offset = monitor.getClientOffset();
  const containerRect = document.getElementById("timeline-tracks-container")?.getBoundingClientRect();

  const dropTime = offset && containerRect ? (offset.x - containerRect.left + scrollLeft) / pixelsPerSecond : 0;
  const startTime = resolveClipStartTime({ intent: "drop", timelineEndTime: 0, dropTime });

  // Infer track type from what's being dropped
  const trackType: "video" | "audio" | "text" = item.type === "MEDIA_ASSET" ? (item.asset.type === "audio" ? "audio" : "video") : "video";

  const existingOfType = tracks.filter((t) => t.type === trackType).length;

  const newTrack: Track = {
    id: generateId("track"),
    type: trackType,
    name: `${capitalize(trackType)} ${existingOfType + 1}`,
    muted: false,
    locked: false,
    visible: true,
    height: trackType === "video" ? 68 : trackType === "audio" ? 52 : 56,
  };

  // Use command to add track (enables undo/redo)
  execute(new AddTrackCommand(newTrack, insertIndex));

  if (item.type === "MEDIA_ASSET") {
    const projectState = useProjectStore.getState();
    if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
      autoAdaptSequenceForFirstVisualClip({
        project: projectState.project,
        existingClips: useTimelineStore.getState().clips,
        asset: item.asset,
        updateProject: projectState.updateProject,
      });
    }

    const nextProject = useProjectStore.getState().project;
    const canvasWidth = nextProject?.canvasWidth ?? projectState.project?.canvasWidth ?? 1920;
    const canvasHeight = nextProject?.canvasHeight ?? projectState.project?.canvasHeight ?? 1080;

    // Use createClipFromAsset to preserve aspect ratio (professional behavior)
    const newClip = createClipFromAsset({
      asset: item.asset,
      trackId: newTrack.id,
      startTime,
      width: canvasWidth,
      height: canvasHeight,
    });

    // Use command to add clip (enables undo/redo)
    execute(new AddClipCommand(newClip));
  } else if (item.type === "CLIP") {
    // Moving existing clip to new track - use commands (enables undo/redo)
    execute(new DeleteClipCommand(item.clip.id));
    execute(new AddClipCommand({ ...item.clip, trackId: newTrack.id, startTime }));
  }
}

// Handle dropping media assets onto existing tracks
export function handleDropOnTrack(item: DragItem, monitor: any, trackId: string) {
  const timelineState = useTimelineStore.getState();
  const { pixelsPerSecond, scrollLeft } = timelineState;
  const { execute } = useHistoryStore.getState();

  const offset = monitor.getClientOffset();
  const containerRect = document.getElementById("timeline-tracks-container")?.getBoundingClientRect();

  const dropTime = offset && containerRect ? (getTimelineLaneClientX(offset.x, containerRect.left, timelineState.clips.length > 0) + scrollLeft) / pixelsPerSecond : 0;
  const startTime = resolveClipStartTime({ intent: "drop", timelineEndTime: 0, dropTime });

  if (item.type === "MEDIA_ASSET") {
    const projectState = useProjectStore.getState();
    if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
      autoAdaptSequenceForFirstVisualClip({
        project: projectState.project,
        existingClips: useTimelineStore.getState().clips,
        asset: item.asset,
        updateProject: projectState.updateProject,
      });
    }

    const nextProject = useProjectStore.getState().project;
    const canvasWidth = nextProject?.canvasWidth ?? projectState.project?.canvasWidth ?? 1920;
    const canvasHeight = nextProject?.canvasHeight ?? projectState.project?.canvasHeight ?? 1080;

    // Use createClipFromAsset to preserve aspect ratio (professional behavior)
    const newClip = createClipFromAsset({
      asset: item.asset,
      trackId,
      startTime,
      width: canvasWidth,
      height: canvasHeight,
    });

    const track = timelineState.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const decision = resolveInsertEdit({
      track,
      asset: item.asset,
      clips: timelineState.clips,
      requestedTime: startTime,
      frameRate: projectState.project?.frameRate ?? 30,
    });
    if (!decision.accepted) {
      useProjectStore.getState().showToast(decision.reason ?? "Cannot insert media here", "error");
      return;
    }

    execute(new InsertEditCommand({ ...newClip, startTime: decision.insertionTime }, decision.insertionTime, decision.splitClipId));
    useUIStore.getState().clearSelection();
    useUIStore.getState().selectClip(newClip.id);
    requestAnimationFrame(() => useTimelineStore.getState().detectAndSyncGaps(trackId));
  }
}
