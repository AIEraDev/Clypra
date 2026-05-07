import type { DragItem, Track, Clip, DensityConfig, DensityLevel } from "../types";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { capitalize } from "./utils";
import { DensityLevel as DensityLevelEnum } from "../types";

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
  const { addTrack, addClip, removeClip, tracks, pixelsPerSecond, scrollLeft } = useTimelineStore.getState();

  const offset = monitor.getClientOffset();
  const containerRect = document.getElementById("timeline-tracks-container")?.getBoundingClientRect();

  const startTime = offset && containerRect ? Math.max(0, (offset.x - containerRect.left + scrollLeft) / pixelsPerSecond) : 0;

  // Infer track type from what's being dropped
  const trackType: "video" | "audio" | "text" = item.type === "MEDIA_ASSET" ? (item.asset.type === "audio" ? "audio" : "video") : "video";

  const existingOfType = tracks.filter((t) => t.type === trackType).length;

  const newTrack: Track = {
    id: crypto.randomUUID(),
    type: trackType,
    name: `${capitalize(trackType)} ${existingOfType + 1}`,
    muted: false,
    locked: false,
    visible: true,
    height: trackType === "video" ? 68 : trackType === "audio" ? 52 : 56,
  };

  // Add track at specific index
  const currentTracks = useTimelineStore.getState().tracks;
  const newTracks = [...currentTracks.slice(0, insertIndex), newTrack, ...currentTracks.slice(insertIndex)];

  // Update tracks directly
  useTimelineStore.setState({ tracks: newTracks });

  if (item.type === "MEDIA_ASSET") {
    const { project } = useProjectStore.getState();
    const newClip: Clip = {
      id: crypto.randomUUID(),
      trackId: newTrack.id,
      mediaId: item.asset.id,
      startTime,
      duration: item.asset.duration || 5,
      trimIn: 0,
      trimOut: item.asset.duration || 5,
      x: 0,
      y: 0,
      width: project?.canvasWidth ?? 1920,
      height: project?.canvasHeight ?? 1080,
      opacity: 1,
      rotation: 0,
    };
    addClip(newClip);
  } else if (item.type === "CLIP") {
    // Moving existing clip to new track
    removeClip(item.clip.id);
    addClip({ ...item.clip, trackId: newTrack.id, startTime });
  }

  // Trigger auto-save
  useProjectStore.getState().scheduleAutoSave();
}
