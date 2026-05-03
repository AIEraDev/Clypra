import React from "react";
import { TopBar } from "./TopBar";
import { EnhancedMediaPanel } from "./EnhancedMediaPanel";
import { PreviewPanel } from "./PreviewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { useTimelineStore } from "../../store/timelineStore";
import { useProjectStore } from "../../store/projectStore";
import { createClipFromAsset } from "../../lib/timelineClip";

export const EditorLayout: React.FC = () => {
  const { tracks, addClip, addTrack, getTimelineEndTime } = useTimelineStore();
  const { mediaAssets, project } = useProjectStore();

  const handleAddToTimeline = (item: any, type: string) => {
    // Handle different item types
    if (type === "media") {
      const mediaAsset = mediaAssets.find((asset) => asset.id === item.id);
      if (!mediaAsset) return;

      // Determine the appropriate track type based on media type
      const targetTrackType = mediaAsset.type === "audio" ? "audio" : "video";

      // Find the first track of the appropriate type
      let targetTrack = tracks.find((track) => track.type === targetTrackType && !track.locked);

      // If no track exists for this type, create one
      if (!targetTrack) {
        console.log("[EditorLayout] No track found for type:", targetTrackType, "- creating one");
        addTrack(targetTrackType);
        // Get the newly created track
        targetTrack = useTimelineStore.getState().tracks.find((t) => t.type === targetTrackType && !t.locked);
      }

      if (!targetTrack) return;

      // Get the end time of all existing clips
      const endTime = getTimelineEndTime();

      const newClip = createClipFromAsset({
        asset: mediaAsset,
        trackId: targetTrack.id,
        startTime: endTime,
        width: project?.canvasWidth || 1920,
        height: project?.canvasHeight || 1080,
      });

      addClip(newClip);
    } else {
      // Handle other types (audio, text, stickers, effects, transitions, captions)
      console.log(`[EditorLayout] Adding ${type} to timeline:`, item);
      // TODO: Implement handlers for other types
    }
  };

  return (
    <div className="w-full h-full flex flex-col app-shell overflow-hidden p-2 md:p-3 gap-2">
      <TopBar />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-2">
        <div className="flex-1 min-h-0 flex overflow-hidden gap-2">
          <EnhancedMediaPanel onAddToTimeline={handleAddToTimeline} />

          <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell">
            <PreviewPanel />
          </div>

          <PropertiesPanel />
        </div>

        <div className="h-80 panel-shell overflow-hidden">
          <Timeline />
        </div>
      </div>
    </div>
  );
};
