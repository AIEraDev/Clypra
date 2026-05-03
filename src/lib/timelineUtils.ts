import type { DragItem, Track, Clip } from "../types";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { capitalize } from "./utils";

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
