/**
 * useAddToTimeline
 *
 * Shared hook that extracts the handleAddToTimeline logic previously
 * duplicated between EditorLayout.tsx and MobileEditorLayout.tsx.
 *
 * Returns a stable async callback: (item: any, type: string) => Promise<void>
 */
import { useCallback } from "react";
import { getInsertIndexForNewTrack, getInsertIndexForNewTrackGrouped, useTimelineStore } from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import { generateId } from "@/lib/utils/id";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { createTextClip, TEXT_PRESETS } from "@/lib/text/textClip";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/timeline/sequenceAutoAspect";
import { DEFAULT_PLACEMENT_POLICY, resolveAddToTimelinePlacement, resolveDefaultFitModeForAsset } from "@/lib/timeline/placementPolicy";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { platform } from "@/core/platform";
import { AddClipCommand, UpdateClipCommand, AddTransitionCommand } from "@/core/history/commands";
import type { MediaAsset, TrackType } from "@/types";
import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";

export function useAddToTimeline(): (item: any, type: string) => Promise<void> {
  const { selectedClipIds } = useUIStore();
  const { mediaAssets, project, updateProject } = useProjectStore();
  const { insertTrackAt, getTimelineEndTime, createTransitionBetweenClips } = useTimelineStore();
  const { execute } = useHistoryStore();
  const { getCachedFile } = useAudioLibraryStore();

  const getTimelineState = () => {
    const state = useTimelineStore.getState();
    return { tracks: state.tracks, clips: state.clips };
  };

  const findAdjacentClipsAtPlayhead = () => {
    const { tracks, clips } = getTimelineState();
    const playheadTime = getPlaybackClock().time;
    for (const track of tracks.filter((t) => t.type !== "audio" && !t.locked)) {
      const sorted = clips
        .filter((c) => c.trackId === track.id)
        .sort((a, b) => a.startTime - b.startTime);
      for (let i = 0; i < sorted.length - 1; i++) {
        const left = sorted[i];
        const right = sorted[i + 1];
        const cutTime = left.startTime + left.duration;
        const isAtCut =
          Math.abs(cutTime - right.startTime) <= 0.001 &&
          Math.abs(playheadTime - cutTime) <= 0.25;
        if (isAtCut) return [left.id, right.id] as const;
      }
    }
    return null;
  };

  return useCallback(
    async (item: any, type: string) => {
      const { tracks, clips } = getTimelineState();

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
        execute(new AddClipCommand(newClip));

      } else if (type === "text") {
        const isTemplate = item.presetType === "template" || Boolean(item.templateId);
        let placement = resolveAddToTimelinePlacement({
          asset: { type: "video", id: item.id, trackType: "text" },
          tracks,
          clips,
          playheadTime: getPlaybackClock().time,
          sequenceEndTime: getTimelineEndTime(),
          duration: isTemplate ? undefined : 5.0,
        });
        let targetTrackId = placement.targetTrackId;

        // Template payloads are fetched before creating a track. This keeps a
        // failed catalog/revision request from leaving an empty text lane.
        if (isTemplate) {
          const { useTemplateStore } = await import("@/features/text-templates/templateStore");
          const { instantiateTemplate } = await import("@/features/text-templates/instantiateTemplate");
          const store = useTemplateStore.getState();
          const candidates = [
            item.templateData,
            item.injectedData,
            item.templateDefinition?.templateData,
            item.templateDefinition?.lottieData,
            item.templateDefinition,
            store.selectedTemplate?.id === item.templateId ? store.selectedTemplate : null,
            store.templates.find((template) => template.id === item.templateId),
          ].filter(Boolean);

          let resolvedTemplate: any = candidates.find((candidate) => resolveTextTemplateArtifact(candidate));
          const summary = item.templateDefinition || store.selectedTemplate || store.templates.find((template) => template.id === item.templateId);
          if (!resolvedTemplate && summary?.category && item.templateId) {
            try {
              const { TextEffectsApi } = await import("@/features/text-effects/api/textEffectsApi");
              // Exact revision pinning is mandatory for timeline instances.
              resolvedTemplate = await TextEffectsApi.getTemplateArtifact(
                summary.category,
                item.templateId,
                item.templateRevisionId ?? summary.revisionId ?? summary.revision?.revisionId,
              );
            } catch (error) {
              console.error("[Clypra:AddToTimeline] Failed to fetch pinned text-template artifact:", error);
            }
          }

          if (!resolvedTemplate) {
            console.error("[Clypra:AddToTimeline] Refusing to insert template without a canonical artifact", {
              templateId: item.templateId,
              revisionId: item.templateRevisionId,
            });
            return;
          }

          const artifact = resolveTextTemplateArtifact(resolvedTemplate);
          const duration = artifact?.timing.duration ?? resolvedTemplate.defaultDuration ?? resolvedTemplate.duration ?? 4;
          const latest = useTimelineStore.getState();
          placement = resolveAddToTimelinePlacement({
            asset: { type: "video", id: item.templateId, trackType: "text" },
            tracks: latest.tracks,
            clips: latest.clips,
            playheadTime: getPlaybackClock().time,
            sequenceEndTime: getTimelineEndTime(),
            duration,
          });
          targetTrackId = placement.targetTrackId;
          if (placement.shouldCreateTrack || !targetTrackId) {
            const latestTracks = useTimelineStore.getState().tracks;
            targetTrackId = insertTrackAt("text", getInsertIndexForNewTrack(latestTracks, "text"));
          }
          if (!targetTrackId) return;

          const templateClip = instantiateTemplate(resolvedTemplate, {
            trackId: targetTrackId,
            startTime: placement.startTime,
            canvasWidth: project?.canvasWidth || 1920,
            canvasHeight: project?.canvasHeight || 1080,
            customization: item.customization,
          });
          execute(new AddClipCommand(templateClip));
          // Session-owned bridge caches are warmed after insertion, outside
          // the add command. Playback therefore consumes a registered native
          // texture instead of uploading the template on its first frame.
          void getActiveSessionOrNull()?.prewarmNativeRasterAssets().catch((error) => {
            console.warn("[Clypra:AddToTimeline] Template prewarm failed", error);
          });
          return;
        }

        if (placement.shouldCreateTrack || !targetTrackId) {
          const latestTracks = useTimelineStore.getState().tracks;
          targetTrackId = insertTrackAt("text", getInsertIndexForNewTrack(latestTracks, "text"));
        }
        if (!targetTrackId) return;

        let presetConfig = {};
        if (item.id && item.id.startsWith("text-")) {
          const presetName = item.name?.toLowerCase().replace(/\s+/g, "") as keyof typeof TEXT_PRESETS;
          if (TEXT_PRESETS[presetName]) presetConfig = TEXT_PRESETS[presetName];
        }

        let effectDefinition = item.effectDefinition;
        if (item.styleId && !effectDefinition) {
          try {
            const { useEffectsStore } = await import("@/features/text-effects/store/effectsStore");
            const store = useEffectsStore.getState();
            effectDefinition = store.definitions[item.styleId];
            if (!effectDefinition) {
              await store.fetchDefinitionOnlyById(item.styleId);
              effectDefinition = useEffectsStore.getState().definitions[item.styleId];
            }
          } catch {
            // Continue without definition — will use fallback sizing
          }
        }

        const textClip = createTextClip({
          trackId: targetTrackId,
          startTime: placement.startTime,
          duration: 5.0,
          text: item.text || item.name || "Text",
          canvasWidth: project?.canvasWidth || 1920,
          canvasHeight: project?.canvasHeight || 1080,
          textRole: "title",
          ...presetConfig,
          ...(item.fontFamily !== undefined ? { fontFamily: item.fontFamily } : {}),
          ...(item.color !== undefined ? { color: item.color } : {}),
          ...(item.fontSize !== undefined ? { fontSize: item.fontSize } : {}),
          ...(item.fontWeight !== undefined ? { fontWeight: item.fontWeight } : {}),
          ...(item.fontStyle !== undefined ? { fontStyle: item.fontStyle } : {}),
          ...(item.stroke !== undefined ? { stroke: item.stroke } : {}),
          ...(item.shadow !== undefined ? { shadow: item.shadow } : {}),
          ...(item.background !== undefined ? { background: item.background } : {}),
          ...(item.styleId !== undefined ? { styleId: item.styleId } : {}),
          styleRevisionId: item.styleRevisionId ?? effectDefinition?.revisionId ?? effectDefinition?.revision?.revisionId,
          styleContentHash: item.styleContentHash ?? effectDefinition?.contentHash ?? effectDefinition?.revision?.contentHash,
          styleSnapshot: item.styleSnapshot ?? effectDefinition?.scene,
          effectDefinition,
          templateId: item.templateId,
          customization: item.customization,
        });
        execute(new AddClipCommand(textClip));

      } else if (type === "audio" && item?.audioUrl) {
        const cachedFile = getCachedFile(item.id);
        if (!cachedFile) return;

        (async () => {
          const appCache = await platform.appCacheDir();
          const absolutePath = await platform.joinPaths(appCache, cachedFile.localPath);
          const mediaAsset: MediaAsset = {
            id: `audio-library-${item.id}`,
            name: item.name || "Library Audio",
            path: absolutePath,
            type: "audio",
            duration: cachedFile.metadata.duration || Number(item.duration) || 5,
            size: cachedFile.size,
          };
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
          execute(
            new AddClipCommand(
              createClipFromAsset({
                asset: mediaAsset,
                trackId: targetTrackId,
                startTime: placement.startTime,
                width: project?.canvasWidth || 1920,
                height: project?.canvasHeight || 1080,
                fitMode: resolveDefaultFitModeForAsset(mediaAsset),
                audioPath: absolutePath,
              }) as any,
            ),
          );
        })().catch((error) => {
          console.error("[useAddToTimeline] Failed to add audio to timeline:", error);
        });

      } else if (type === "stickers") {
        const cachedSticker = useStickersStore.getState().getCachedSticker(item.id);
        if (!cachedSticker) return;

        (async () => {
          const appCache = await platform.appCacheDir();
          const relativePath = cachedSticker.localImagePath || "";
          if (!relativePath) return;
          const absolutePath = await platform.joinPaths(appCache, relativePath);
          const isLottie = Boolean(
            cachedSticker.localAnimationPath &&
            (cachedSticker.localAnimationPath.endsWith(".json") || item.lottieUrl),
          );
          const absoluteAnimationPath = isLottie && cachedSticker.localAnimationPath
            ? await platform.joinPaths(appCache, cachedSticker.localAnimationPath)
            : undefined;
          const mediaAsset: MediaAsset = {
            id: `sticker-${item.id}`,
            name: item.name || "Sticker",
            path: absolutePath,
            type: "image",
            duration: 3.0,
            size: 0,
            stickerFormat: isLottie ? "lottie" : "static",
            stickerAnimationPath: absoluteAnimationPath,
            stickerSourceId: item.id,
            width: 400,
            height: 400,
          };
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
          execute(
            new AddClipCommand(
              createClipFromAsset({
                asset: mediaAsset,
                trackId: targetTrackId,
                startTime: placement.startTime,
                width: project?.canvasWidth || 1920,
                height: project?.canvasHeight || 1080,
                fitMode: resolveDefaultFitModeForAsset(mediaAsset),
              }),
            ),
          );
        })().catch((error) => {
          console.error("[useAddToTimeline] Failed to add sticker to timeline:", error);
        });

      } else if (type === "transitions") {
        const selectedPair =
          selectedClipIds.length === 2
            ? ([selectedClipIds[0], selectedClipIds[1]] as const)
            : null;
        const pair = selectedPair ?? findAdjacentClipsAtPlayhead();
        if (!pair) {
          useProjectStore.getState().showToast(
            "Select two adjacent clips or place the playhead at a cut",
            "warning",
          );
          return;
        }
        const transitionType = item?.renderer || item?.category || "fade";
        const transitionDuration = item?.duration?.default || Number(item?.duration) || 0.5;
        const renderer = item?.renderer;
        const result = createTransitionBetweenClips(pair[0], pair[1], transitionType, transitionDuration, renderer);
        if (result.error) {
          useProjectStore.getState().showToast(result.error, "warning");
        } else if (result.transition) {
          execute(new AddTransitionCommand(result.transition));
          useProjectStore.getState().showToast(`${item?.name || "Transition"} added between clips`);
        }

      } else if (type === "effects") {
        const { clips: currentClips } = getTimelineState();
        const selectedClipId = selectedClipIds[0] ?? null;
        let targetClip = currentClips.find((c) => c.id === selectedClipId);
        if (!targetClip) {
          const currentTime = getPlaybackClock().time;
          const visualClips = currentClips.filter((c) => {
            const asset = mediaAssets.find((a) => a.id === c.mediaId);
            return asset && (asset.type === "video" || asset.type === "image");
          });
          targetClip = visualClips.find(
            (c) => currentTime >= c.startTime && currentTime <= c.startTime + c.duration,
          );
        }
        if (!targetClip) {
          useProjectStore.getState().showToast("Select a video or image clip to apply this effect", "warning");
          return;
        }
        const asset = mediaAssets.find((a) => a.id === targetClip!.mediaId);
        if (asset?.type !== "video" && asset?.type !== "image") {
          useProjectStore.getState().showToast("Effects can only be applied to video or image clips", "warning");
          return;
        }
        const currentEffects = targetClip.effects || [];
        if (currentEffects.some((fx) => fx.id === item.id)) {
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
        execute(new UpdateClipCommand(targetClip.id, { effects: currentEffects }, { effects: updatedEffects }));
        useProjectStore.getState().showToast(`Applied ${item.name} effect`);

      } else if (type === "filters") {
        const cachedFilter = filterCacheManager.getCached(item.id);
        if (!cachedFilter) {
          useProjectStore.getState().showToast("Filter not downloaded yet", "warning");
          return;
        }
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
          category: cachedFilter.filter.category,
          url: cachedFilter.filter.url,
          pipeline: cachedFilter.filter.pipeline,
          gradingParams: cachedFilter.filter.gradingParams,
          effectStack: cachedFilter.filter.effectStack,
          lut: cachedFilter.filter.lut,
          lutId: cachedFilter.filter.lut ? cachedFilter.filter.id : undefined,
        };
        execute(new AddClipCommand(filterClip as any));
        useProjectStore.getState().showToast(`Added ${cachedFilter.filter.name} filter`);

      } else if (type === "video-effects" || type === "body-effects") {
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
        if (!targetTrackId) return;
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
        execute(new AddClipCommand(effectClip as any));
        useProjectStore.getState().showToast(`Added ${item.name} effect`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaAssets, project, updateProject, insertTrackAt, getTimelineEndTime, createTransitionBetweenClips, execute, getCachedFile, selectedClipIds],
  );
}
