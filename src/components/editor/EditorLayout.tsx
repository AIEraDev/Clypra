import React from "react";
import { TopBar } from "./TopBar";
import { EnhancedMediaPanel } from "./media-panel/EnhancedMediaPanel";
import { PreviewPanel } from "./preview/PreviewPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { getInsertIndexForNewTrack, getInsertIndexForNewTrackGrouped, useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { generateId } from "@/lib/utils/id";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { createTextClip, TEXT_PRESETS } from "@/lib/text/textClip";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/sequence/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveAddToTimelinePlacement, resolveDefaultFitModeForAsset } from "@/lib/timeline/placementPolicy";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { useWindowSize } from "@/hooks/useWindowSize";
import { MobileEditorLayout } from "./MobileEditorLayout";
import type { MediaAsset, TrackType } from "@/types";
import { useUIStore } from "@/store/uiStore";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import { AddClipCommand } from "@/core/history/commands/DeleteClipCommand";
import { useHistoryStore } from "@/store/historyStore";

interface EditorLayoutProps {
  onRequestClose?: () => void;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({ onRequestClose }) => {
  const { width } = useWindowSize();

  if (width < 768) {
    return <MobileEditorLayout />;
  }

  // Only subscribe to actions, not state - prevents re-renders when clips/tracks change
  const addClip = useTimelineStore((s) => s.addClip);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const insertTrackAt = useTimelineStore((s) => s.insertTrackAt);
  const getTimelineEndTime = useTimelineStore((s) => s.getTimelineEndTime);
  const createTransitionBetweenClips = useTimelineStore((s) => s.createTransitionBetweenClips);

  // Read state only when needed in the handler (not as subscriptions)
  const getTimelineState = () => {
    const state = useTimelineStore.getState();
    return { tracks: state.tracks, clips: state.clips };
  };
  const { mediaAssets, project, updateProject, addMediaAsset } = useProjectStore();
  const { selectedClipIds } = useUIStore();
  const execute = useHistoryStore((s) => s.execute);

  const findAdjacentClipsAtPlayhead = () => {
    const { tracks, clips } = getTimelineState();
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

  const handleAddToTimeline = async (item: any, type: string) => {
    // Get current timeline state
    const { tracks, clips } = getTimelineState();

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
      const placement = resolveAddToTimelinePlacement({
        asset: { type: "video", id: item.id, trackType: "text" },
        tracks,
        clips,
        playheadTime: getPlaybackClock().time,
        sequenceEndTime: getTimelineEndTime(),
      });

      let targetTrackId = placement.targetTrackId;
      if (placement.shouldCreateTrack || !targetTrackId) {
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

      // If styleId is present but effectDefinition is missing, fetch it before creating the clip
      let effectDefinition = item.effectDefinition;
      if (item.styleId && !effectDefinition) {
        try {
          const { useEffectsStore } = await import("@/features/text-effects/store/effectsStore");
          const store = useEffectsStore.getState();

          // Check if already in store cache
          effectDefinition = store.definitions[item.styleId];

          // If not in cache, fetch it
          if (!effectDefinition) {
            await store.fetchDefinitionOnlyById(item.styleId);
            effectDefinition = useEffectsStore.getState().definitions[item.styleId];
          }
        } catch (error) {
          // Continue without definition - will use fallback sizing
        }
      }

      // Create text clip
      const textClip = createTextClip({
        trackId: targetTrackId,
        startTime: placement.startTime,
        duration: 5.0,
        text: item.text || item.name || "Text", // Use effect's default text first, then name as fallback
        canvasWidth: project?.canvasWidth || 1920,
        canvasHeight: project?.canvasHeight || 1080,
        textRole: "title", // Text effects and templates are titles, not captions
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
        effectDefinition: effectDefinition, // ← Now properly fetched if missing
        templateId: item.templateId,
        customization: item.customization,
      });

      addClip(textClip);
    } else if (type === "audio" && item?.audioUrl) {
      // Audio library item - must be downloaded first
      const cachedFile = getCachedFile(item.id);

      if (!cachedFile) {
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
          // coverArt removed - will use Clypra logo fallback in preview
        };

        // NOTE: Don't add audio library items to project media assets
        // They should only exist as timeline clips, not in the media panel
        // addMediaAsset(mediaAsset);

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
            audioPath: absolutePath, // Store path directly for audio library items
          }) as any,
        );
      })().catch((error) => {
        // Audio add failed silently
      });
    } else if (type === "stickers") {
      const cachedSticker = useStickersStore.getState().getCachedSticker(item.id);
      if (!cachedSticker) {
        return;
      }

      (async () => {
        const { appCacheDir, join } = await import("@tauri-apps/api/path");
        const appCache = await appCacheDir();

        // Stickers are Lottie-only now
        const relativePath = cachedSticker.localImagePath || "";
        if (!relativePath) {
          return;
        }

        const absolutePath = await join(appCache, relativePath);
        const absoluteAnimationPath = cachedSticker.localAnimationPath ? await join(appCache, cachedSticker.localAnimationPath) : undefined;

        const mediaAsset: MediaAsset = {
          id: `sticker-${item.id}`,
          name: item.name || "Sticker",
          path: absolutePath,
          type: "image",
          duration: 3.0,
          size: 0,
          stickerFormat: "lottie",
          stickerAnimationPath: absoluteAnimationPath,
          stickerSourceId: item.id,
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
          const insertIndex = getInsertIndexForNewTrack(useTimelineStore.getState().tracks, placement.trackType);
          targetTrackId = insertTrackAt(placement.trackType, insertIndex);
        }

        if (!targetTrackId) return;

        const stickerClip = createClipFromAsset({
          asset: mediaAsset,
          trackId: targetTrackId,
          startTime: placement.startTime,
          width: project?.canvasWidth || 1920,
          height: project?.canvasHeight || 1080,
          fitMode: resolveDefaultFitModeForAsset(mediaAsset),
        });
        execute(new AddClipCommand(stickerClip));
      })().catch((error) => {
        // Sticker add failed silently
      });
    } else if (type === "transitions") {
      const selectedPair = selectedClipIds.length === 2 ? ([selectedClipIds[0], selectedClipIds[1]] as const) : null;
      const pair = selectedPair ?? findAdjacentClipsAtPlayhead();
      if (!pair) {
        useProjectStore.getState().showToast("Select two adjacent clips or place the playhead at a cut", "warning");
        return;
      }

      // Use the transition renderer from the API instead of hardcoding
      const transitionType = item?.renderer || item?.category || "fade";
      const transitionDuration = item?.duration?.default || Number(item?.duration) || 0.5;

      const result = createTransitionBetweenClips(pair[0], pair[1], transitionType, transitionDuration);
      if (result.error) {
        useProjectStore.getState().showToast(result.error, "warning");
      } else {
        useProjectStore.getState().showToast(`${item?.name || "Transition"} added between clips`);
      }
    } else if (type === "effects") {
      const selectedClipId = selectedClipIds[0] ?? null;
      let targetClip = clips.find((c) => c.id === selectedClipId);

      // If no clip is explicitly selected, find the active visual clip (video/image) at the playhead
      if (!targetClip) {
        const currentTime = getPlaybackClock().time;
        const visualClips = clips.filter((c) => {
          const asset = mediaAssets.find((a) => a.id === c.mediaId);
          return asset && (asset.type === "video" || asset.type === "image");
        });
        targetClip = visualClips.find((c) => currentTime >= c.startTime && currentTime <= c.startTime + c.duration);
      }

      if (!targetClip) {
        useProjectStore.getState().showToast("Select a video or image clip to apply this effect", "warning");
        return;
      }

      const asset = mediaAssets.find((a) => a.id === targetClip.mediaId);
      if (asset?.type !== "video" && asset?.type !== "image") {
        useProjectStore.getState().showToast("Effects can only be applied to video or image clips", "warning");
        return;
      }

      const currentEffects = targetClip.effects || [];
      const effectExists = currentEffects.some((fx) => fx.id === item.id);

      if (effectExists) {
        useProjectStore.getState().showToast(`Effect "${item.name}" is already applied`, "warning");
        return;
      }

      const updatedEffects = [
        ...currentEffects,
        {
          id: item.id,
          effectId: item.id,
          type: "effect" as const,
          renderer: item.renderer || item.id,
          params: item.params || {},
          name: item.name,
          startTime: 0,
          duration: targetClip.duration,
          intensity: 0.5,
        },
      ];

      updateClip(targetClip.id, { effects: updatedEffects });
      useProjectStore.getState().showToast(`Applied ${item.name} effect`);
    } else if (type === "filters") {
      // Filter must be downloaded first
      const cachedFilter = filterCacheManager.getCached(item.id);

      if (!cachedFilter) {
        useProjectStore.getState().showToast("Filter not downloaded yet", "warning");
        return;
      }

      // Filter clips follow the same placement policy semantics:
      // playhead-first, no overwrite, create track when occupied.
      const placement = resolveAddToTimelinePlacement({
        asset: { type: "video", id: item.id, trackType: "filter" },
        tracks,
        clips,
        playheadTime: getPlaybackClock().time,
        sequenceEndTime: getTimelineEndTime(),
      });

      let targetTrackId = placement.targetTrackId;
      if (placement.shouldCreateTrack || !targetTrackId) {
        const latestTracks = useTimelineStore.getState().tracks;
        const latestClips = useTimelineStore.getState().clips;
        const insertIndex = getInsertIndexForNewTrackGrouped(latestTracks, latestClips, "filter", item.id);
        targetTrackId = insertTrackAt("filter", insertIndex);
      }

      if (!targetTrackId) return;

      const defaultIntensity = item.intensity?.default !== undefined ? item.intensity.default / 100 : 0.8;

      const filterClip = {
        id: generateId("filter-clip"),
        trackId: targetTrackId,
        mediaId: item.id,
        startTime: placement.startTime,
        duration: 5.0,
        trimIn: 0,
        trimOut: 5.0,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 1.0,
        rotation: 0,
        kind: "filter" as const,
        name: cachedFilter.filter.name || "Filter",
        intensity: defaultIntensity,
        swatch: cachedFilter.filter.swatch || "",
        pipeline: cachedFilter.filter.pipeline,
        effectStack: cachedFilter.filter.effectStack,
      };

      addClip(filterClip as any);
      useProjectStore.getState().showToast(`Added ${cachedFilter.filter.name} filter`);
    } else if (type === "video-effects" || type === "body-effects") {
      // Effects are now created directly on timeline without downloading
      // The effect data comes from the engine's effectsRegistry

      // Create effect clip on timeline (same pattern as filter clips)
      const effectTrackType: TrackType = type === "body-effects" ? "body-effect" : "video-effect";

      const placement = resolveAddToTimelinePlacement({
        asset: { type: "video", id: item.id, trackType: effectTrackType },
        tracks,
        clips,
        playheadTime: getPlaybackClock().time,
        sequenceEndTime: getTimelineEndTime(),
      });

      let targetTrackId = placement.targetTrackId;
      if (placement.shouldCreateTrack || !targetTrackId) {
        const latestTracks = useTimelineStore.getState().tracks;
        const latestClips = useTimelineStore.getState().clips;
        const insertIndex = getInsertIndexForNewTrackGrouped(latestTracks, latestClips, effectTrackType, item.id);
        targetTrackId = insertTrackAt(effectTrackType, insertIndex);
      }

      if (!targetTrackId) {
        return;
      }

      const defaultIntensity = item.intensity?.default !== undefined ? item.intensity.default / 100 : 0.8;

      const effectClip = {
        id: generateId(type === "body-effects" ? "body-effect-clip" : "video-effect-clip"),
        trackId: targetTrackId,
        mediaId: item.id,
        startTime: placement.startTime,
        duration: 5.0,
        trimIn: 0,
        trimOut: 5.0,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        opacity: 1.0,
        rotation: 0,
        kind: type === "body-effects" ? ("body-effect" as const) : ("video-effect" as const),
        name: item.name || "Effect",
        intensity: defaultIntensity,
        renderer: item.renderer || item.id,
        params: item.params || {},
        ...(type === "body-effects" && item.requirements ? { requirements: item.requirements } : {}),
      };

      addClip(effectClip as any);
      useProjectStore.getState().showToast(`Added ${item.name} effect`);
    }
  };

  return (
    <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0">
      <TopBar onRequestClose={onRequestClose} />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden gap-1">
        <div className="flex-1 min-h-0 flex overflow-hidden gap-1">
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
