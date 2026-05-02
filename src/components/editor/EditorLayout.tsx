import React from "react";
import { TopBar } from "./TopBar";
import { MediaPanel } from "./MediaPanel";
import { PreviewPanel } from "./PreviewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { useTimelineStore } from "../../store/timelineStore";
import { useProjectStore } from "../../store/projectStore";
import type { Clip } from "../../types";

export const EditorLayout: React.FC = () => {
  const { tracks, addClip, addTrack, getTimelineEndTime } = useTimelineStore();
  const { mediaAssets, project } = useProjectStore();
  const DEFAULT_STILL_DURATION = 5;

  const getClipDuration = (asset: { type: string; duration: number }) => {
    if (asset.type === "image") return DEFAULT_STILL_DURATION;
    if (asset.duration > 0) return asset.duration;
    return DEFAULT_STILL_DURATION;
  };

  const handleAddToTimeline = (mediaId: string) => {
    const mediaAsset = mediaAssets.find((asset) => asset.id === mediaId);
    if (!mediaAsset) return;

    // Determine the appropriate track type based on media type
    // Video and image assets go to video tracks, audio goes to audio tracks
    const targetTrackType = mediaAsset.type === "audio" ? "audio" : "video";

    // Find the first track of the appropriate type
    let targetTrack = tracks.find((track) => track.type === targetTrackType);

    // If no track exists for this type, create one
    if (!targetTrack) {
      console.log("[EditorLayout] No track found for type:", targetTrackType, "- creating one");
      addTrack(targetTrackType);
      // Get the newly created track
      targetTrack = useTimelineStore.getState().tracks.find((t) => t.type === targetTrackType);
    }

    if (!targetTrack) return;

    // Get the end time of all existing clips (optimized - calculated once in store)
    const endTime = getTimelineEndTime();

    // Create a new clip starting at the end of existing content
    const clipDuration = getClipDuration(mediaAsset);

    const newClip: Clip = {
      id: `clip-${Date.now()}`,
      trackId: targetTrack.id,
      mediaId: mediaAsset.id,
      startTime: endTime,
      duration: clipDuration,
      trimIn: 0,
      trimOut: clipDuration,
      x: 0,
      y: 0,
      width: project?.canvasWidth || 1920,
      height: project?.canvasHeight || 1080,
      opacity: 1,
      rotation: 0,
    };

    addClip(newClip);
  };

  return (
    <div className="w-full h-full flex flex-col bg-bg overflow-hidden rounded-md">
      <TopBar />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden space-y-1.5">
        <div className="flex-1 min-h-0 flex overflow-hidden space-x-1.5">
          <MediaPanel onAddToTimeline={handleAddToTimeline} />

          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <PreviewPanel />
          </div>

          <PropertiesPanel />
        </div>

        <div className="h-80 border-t border-border bg-surface">
          <Timeline />
        </div>
      </div>
    </div>
  );
};
