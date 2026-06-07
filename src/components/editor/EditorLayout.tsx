import React from "react";
import { TopBar } from "./TopBar";
import { EnhancedMediaPanel } from "./media-panel/EnhancedMediaPanel";
import { PreviewPanel } from "./preview/PreviewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { getInsertIndexForNewTrack, useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { createClipFromAsset } from "@/lib/timelineClip";
import { createTextClip, TEXT_PRESETS } from "@/lib/textClip";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveAddToTimelinePlacement, resolveDefaultFitModeForAsset } from "@/lib/placementPolicy";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useWindowSize } from "@/hooks/useWindowSize";
import { MobileEditorLayout } from "./MobileEditorLayout";
import type { MediaAsset } from "@/types";
import { useUIStore } from "@/store/uiStore";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { convertFileSrc } from "@tauri-apps/api/core";

export const EditorLayout: React.FC = () => {
  const { width } = useWindowSize();

  if (width < 768) {
    return <MobileEditorLayout />;
  }

  const { tracks, clips, addClip, addTrack, insertTrackAt, getTimelineEndTime, createTransitionBetweenClips } = useTimelineStore();
  const { mediaAssets, project, updateProject, addMediaAsset } = useProjectStore();
  const { selectedClipIds } = useUIStore();

  const findAdjacentClipsAtPlayhead = () => {
    const playheadTime = getPlaybackClock().time;
    for (const track of tracks.filter((candidate) => candidate.type !== "audio" && !candidate.locked)) {
      const sorted = clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.startTime - b.startTime);
      for (let i = 0; i < sorted.length - 1; i++) {
        const left = sorted[i];
        const right = sorted[i + 1];
        const cutTime = left.startTime + left.duration;
        const isAtCut = Math.abs(cutTime - right.startTime) <= 0.001 && Math.abs(playheadTime - cutTime) <= 0.25;
        if (isAtCut) return [left.id, right.id] as const;
      }
    }
    return null;
  };
  const { getCachedFile } = useAudioLibraryStore();

  const handleAddToTimeline = (item: any, type: string) => {
    // Handle different item types
    if (type === "media") {
      const mediaAsset = mediaAssets.find((asset) => asset.id === item.id);
      if (!mediaAsset) return;

      const placement = resolveAddToTimelinePlacement({
        asset: mediaAsset,
        tracks,
        clips,
        playheadTime: getPlaybackClock().time,
        sequenceEndTime: getTimelineEndTime(),
      });
      let targetTrackId = placement.targetTrackId;
      if (placement.shouldCreateTrack || !targetTrackId) {
        const latestTracks = useTimelineStore.getState().tracks;
        const insertIndex = getInsertIndexForNewTrack(latestTracks, placement.trackType);
        targetTrackId = insertTrackAt(placement.trackType, insertIndex);
      }

      if (!targetTrackId) return;

      if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
        autoAdaptSequenceForFirstVisualClip({
          project,
          existingClips: clips,
          asset: mediaAsset,
          updateProject,
        });
      }

      const nextProject = useProjectStore.getState().project;

      const newClip = createClipFromAsset({
        asset: mediaAsset,
        trackId: targetTrackId,
        startTime: placement.startTime,
        width: nextProject?.canvasWidth || project?.canvasWidth || 1920,
        height: nextProject?.canvasHeight || project?.canvasHeight || 1080,
        fitMode: resolveDefaultFitModeForAsset(mediaAsset),
      });

      addClip(newClip);
    } else if (type === "text") {
      // Text clips follow the same placement policy semantics:
      // playhead-first, no overwrite, create track when occupied.
      const sequenceEndTime = getTimelineEndTime();
      const playheadTime = getPlaybackClock().time;
      const startTime = Math.max(0, Math.min(playheadTime, Math.max(0, sequenceEndTime)));
      const firstUnlockedTextTrack = tracks.find((track) => track.type === "text" && !track.locked);
      let targetTrackId: string | null = firstUnlockedTextTrack?.id ?? null;

      if (targetTrackId) {
        const targetTrackClips = clips.filter((clip) => clip.trackId === targetTrackId);
        const occupiedAtPlayhead = targetTrackClips.some((clip) => clip.startTime <= startTime && startTime < clip.startTime + clip.duration);
        if (occupiedAtPlayhead) {
          targetTrackId = null;
        }
      }

      if (!targetTrackId) {
        const latestTracks = useTimelineStore.getState().tracks;
        const insertIndex = getInsertIndexForNewTrack(latestTracks, "text");
        targetTrackId = insertTrackAt("text", insertIndex);
      }

      if (!targetTrackId) return;

      // Determine preset settings
      let presetConfig = {};
      if (item.id && item.id.startsWith("text-")) {
        const presetName = item.name?.toLowerCase().replace(/\s+/g, "") as keyof typeof TEXT_PRESETS;
        if (TEXT_PRESETS[presetName]) {
          presetConfig = TEXT_PRESETS[presetName];
        }
      }

      // Create text clip
      const textClip = createTextClip({
        trackId: targetTrackId,
        startTime,
        duration: 5.0,
        text: item.text || item.name || "Text", // Use effect's default text first, then name as fallback
        canvasWidth: project?.canvasWidth || 1920,
        canvasHeight: project?.canvasHeight || 1080,
        ...presetConfig,
        // Map styling properties from custom text tab effects or templates
        fontFamily: item.fontFamily,
        color: item.color,
        fontSize: item.fontSize,
        fontWeight: item.fontWeight,
        fontStyle: item.fontStyle,
        stroke: item.stroke,
        shadow: item.shadow,
        background: item.background,
        styleId: item.styleId,
        templateId: item.templateId,
      });

      addClip(textClip);
    } else if (type === "audio" && item?.audioUrl) {
      // Audio library item - must be downloaded first
      const cachedFile = getCachedFile(item.id);

      if (!cachedFile) {
        console.error("[EditorLayout] Audio not downloaded yet:", item.id);
        return;
      }

      // Convert relative cache path to absolute path
      // cachedFile.localPath is relative to AppCache (e.g., "audio-library/filename.wav")
      (async () => {
        const { appCacheDir } = await import("@tauri-apps/api/path");
        const { join } = await import("@tauri-apps/api/path");
        const appCache = await appCacheDir();
        const absolutePath = await join(appCache, cachedFile.localPath);

        // Use local cached file path
        const mediaAsset: MediaAsset = {
          id: `audio-library-${item.id}`,
          name: item.name || "Library Audio",
          path: absolutePath, // Use absolute path for media playback
          type: "audio",
          duration: cachedFile.metadata.duration || Number(item.duration) || 5,
          size: cachedFile.size,
          coverArt: item.coverArtUrl,
        };

        addMediaAsset(mediaAsset);

        const latestTracks = useTimelineStore.getState().tracks;
        const latestClips = useTimelineStore.getState().clips;
        const placement = resolveAddToTimelinePlacement({
          asset: mediaAsset,
          tracks: latestTracks,
          clips: latestClips,
          playheadTime: getPlaybackClock().time,
          sequenceEndTime: getTimelineEndTime(),
        });
        let targetTrackId = placement.targetTrackId;
        if (placement.shouldCreateTrack || !targetTrackId) {
          const insertIndex = getInsertIndexForNewTrack(useTimelineStore.getState().tracks, "audio");
          targetTrackId = insertTrackAt("audio", insertIndex);
        }

        if (!targetTrackId) return;

        addClip(
          createClipFromAsset({
            asset: mediaAsset,
            trackId: targetTrackId,
            startTime: placement.startTime,
            width: project?.canvasWidth || 1920,
            height: project?.canvasHeight || 1080,
            fitMode: resolveDefaultFitModeForAsset(mediaAsset),
          }),
        );
      })().catch((error) => {
        console.error("[EditorLayout] Failed to add audio to timeline:", error);
      });
    } else if (type === "transitions") {
      const selectedPair = selectedClipIds.length === 2 ? ([selectedClipIds[0], selectedClipIds[1]] as const) : null;
      const pair = selectedPair ?? findAdjacentClipsAtPlayhead();
      if (!pair) {
        useProjectStore.getState().showToast("Select two adjacent clips or place the playhead at a cut", "warning");
        return;
      }
      const transitionType = item?.preview === "dissolve" || item?.name?.toLowerCase?.() === "dissolve" ? "dissolve" : "fade";
      const result = createTransitionBetweenClips(pair[0], pair[1], transitionType, Number(item?.duration) || 0.5);
      if (result.error) {
        useProjectStore.getState().showToast(result.error, "warning");
      } else {
        useProjectStore.getState().showToast(`${item?.name || "Transition"} added`);
      }
    } else {
      // Handle other types (stickers, effects, captions)
    }
  };

  return (
    <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0">
      <TopBar />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-1">
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
