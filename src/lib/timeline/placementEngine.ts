/**
 * TimelinePlacementEngine — Authoritative Domain Service for Timeline Additions
 *
 * Single source of truth for:
 * • Track index calculation & track creation (video, audio, text, filter, effect)
 * • Clip placement policy & sequence auto-aspect adaptation
 * • Media, text-template, text-effect, plain text, sticker, audio, filter, effect, and transition insertion
 * • PreviewInteractionCoordinator transaction wrapping (pauses preview, commits without auto-resume)
 * • Targeted clip prewarming via ProjectSession
 */

import {
  getInsertIndexForNewTrack,
  getInsertIndexForNewTrackGrouped,
  useTimelineStore,
} from "@/store/timelineStore";
import { useProjectStore } from "@/store/projectStore";
import { useUIStore } from "@/store/uiStore";
import { useHistoryStore } from "@/store/historyStore";
import { useAudioLibraryStore } from "@/features/audio-library/store/audioLibraryStore";
import { useStickersStore } from "@/features/stickers/store/stickersStore";
import { filterCacheManager } from "@/features/filters/cache/filterCache";
import { generateId } from "@/lib/utils/id";
import { createClipFromAsset } from "@/lib/timeline/timelineClip";
import { createTextClip, resolveTextEffectDefinition, TEXT_PRESETS } from "@/lib/text/textClip";
import { autoAdaptSequenceForFirstVisualClip } from "@/lib/timeline/sequenceAutoAspect";
import {
  DEFAULT_PLACEMENT_POLICY,
  resolveAddToTimelinePlacement,
  resolveDefaultFitModeForAsset,
} from "@/lib/timeline/placementPolicy";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { platform } from "@/core/platform";
import {
  AddClipCommand,
  UpdateClipCommand,
  AddTransitionCommand,
} from "@/core/history/commands";
import type { Clip, MediaAsset, TrackType } from "@/types";
import { resolveTextTemplateArtifact } from "@clypra-studio/engine";
import { getActiveSessionOrNull } from "@/core/runtime/ProjectSession";
import { getPreviewInteractionCoordinator } from "@/core/interactions/PreviewInteractionCoordinator";

export interface TimelinePlacementOptions {
  item: any;
  type: string;
  playheadTime?: number;
  sourceInPoint?: number;
  sourceOutPoint?: number;
  targetTrackId?: string;
}

export interface TimelinePlacementResult {
  success: boolean;
  clipId?: string;
  trackId?: string;
  error?: string;
}

function findAdjacentClipsAtPlayhead(playheadTime: number): [string, string] | null {
  const { tracks, clips } = useTimelineStore.getState();
  for (const track of tracks) {
    if (track.type === "audio") continue;
    const trackClips = clips.filter((c) => c.trackId === track.id);
    const sorted = [...trackClips].sort((a, b) => a.startTime - b.startTime);
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
}

export class TimelinePlacementEngine {
  private static _placementLock: Promise<void> = Promise.resolve();

  /**
   * Authoritative entry point for adding any item to the timeline.
   * Additions are serialized to prevent concurrent placement races from
   * corrupting track allocation and spawning duplicate tracks.
   */
  static async addToTimeline(
    options: TimelinePlacementOptions,
  ): Promise<TimelinePlacementResult> {
    const previousLock = TimelinePlacementEngine._placementLock;
    let releaseLock: () => void = () => {};
    TimelinePlacementEngine._placementLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await previousLock;
      return await TimelinePlacementEngine._addToTimelineInternal(options);
    } finally {
      releaseLock();
    }
  }

  private static async _addToTimelineInternal(
    options: TimelinePlacementOptions,
  ): Promise<TimelinePlacementResult> {
    const { item, type, sourceInPoint, sourceOutPoint } = options;
    const coordinator = getPreviewInteractionCoordinator();
    const token = coordinator.begin("property-edit", { pauseOnBegin: true });

    try {
      const timelineState = useTimelineStore.getState();
      const projectState = useProjectStore.getState();
      const playheadTime =
        options.playheadTime ?? getPlaybackClock().time ?? 0;
      const sequenceEndTime = timelineState.getTimelineEndTime();
      const { tracks, clips } = timelineState;
      const project = projectState.project;

      // ─── 1. Media Assets (Video, Audio, Image) ──────────────────────────────
      if (type === "media") {
        let mediaAsset: MediaAsset | undefined =
          item.id && projectState.mediaAssets.find((a) => a.id === item.id);

        if (!mediaAsset && (item.type === "video" || item.type === "audio" || item.type === "image")) {
          mediaAsset = item as MediaAsset;
        }

        if (!mediaAsset) return { success: false, error: "Media asset not found" };

        if (mediaAsset.id.startsWith("sticker-")) {
          const stickerId = mediaAsset.id.replace("sticker-", "");
          const cachedSticker = useStickersStore.getState().getCachedSticker(stickerId);
          if (cachedSticker && cachedSticker.localImagePath) {
            const appCache = await platform.appCacheDir();
            const absoluteImagePath = await platform.joinPaths(
              appCache,
              cachedSticker.localImagePath,
            );
            mediaAsset = {
              ...mediaAsset,
              path: absoluteImagePath,
              width: mediaAsset.width || 400,
              height: mediaAsset.height || 400,
            };
          }
        }

        const placement = resolveAddToTimelinePlacement({
          asset: mediaAsset,
          tracks,
          clips,
          playheadTime,
          sequenceEndTime,
        });

        let targetTrackId = options.targetTrackId || placement.targetTrackId;
        if (placement.shouldCreateTrack || !targetTrackId) {
          const latestTracks = useTimelineStore.getState().tracks;
          const insertIndex = getInsertIndexForNewTrack(latestTracks, placement.trackType);
          targetTrackId = timelineState.insertTrackAt(placement.trackType, insertIndex);
        }
        if (!targetTrackId) return { success: false, error: "Failed to allocate track" };

        if (DEFAULT_PLACEMENT_POLICY.autoAdaptSequenceForFirstVisualClip) {
          autoAdaptSequenceForFirstVisualClip({
            project,
            existingClips: clips,
            asset: mediaAsset,
            updateProject: projectState.updateProject,
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

        if (sourceInPoint !== undefined || sourceOutPoint !== undefined) {
          const trimIn = sourceInPoint ?? 0;
          const trimOut = sourceOutPoint ?? newClip.duration;
          newClip.trimIn = trimIn;
          newClip.trimOut = trimOut;
          newClip.duration = Math.max(0.1, trimOut - trimIn);
        }

        useHistoryStore.getState().execute(new AddClipCommand(newClip));
        await getActiveSessionOrNull()?.prewarmClip(newClip, placement.startTime);

        return { success: true, clipId: newClip.id, trackId: targetTrackId };
      }

      // ─── 2. Text (Templates, Effects, Presets, Plain) ────────────────────────
      if (type === "text") {
        const isTemplate =
          item.presetType === "template" || Boolean(item.templateId);

        let placement = resolveAddToTimelinePlacement({
          asset: { type: "video", id: item.id || "text-clip", trackType: "text" },
          tracks,
          clips,
          playheadTime,
          sequenceEndTime,
          duration: isTemplate ? undefined : 5.0,
        });

        let targetTrackId = options.targetTrackId || placement.targetTrackId;

        if (isTemplate) {
          const { useTemplateStore } = await import(
            "@/features/text-templates/templateStore"
          );
          const { instantiateTemplate } = await import(
            "@/features/text-templates/instantiateTemplate"
          );
          const store = useTemplateStore.getState();
          const candidates = [
            item.templateData,
            item.injectedData,
            item.templateDefinition?.templateData,
            item.templateDefinition?.lottieData,
            item.templateDefinition,
            store.selectedTemplate?.id === item.templateId ? store.selectedTemplate : null,
            store.templates.find((t) => t.id === item.templateId),
          ].filter(Boolean);

          let resolvedTemplate: any = candidates.find((c) =>
            resolveTextTemplateArtifact(c),
          );
          const summary =
            item.templateDefinition ||
            store.selectedTemplate ||
            store.templates.find((t) => t.id === item.templateId);

          if (!resolvedTemplate && summary?.category && item.templateId) {
            try {
              const { TextEffectsApi } = await import(
                "@/features/text-effects/api/textEffectsApi"
              );
              resolvedTemplate = await TextEffectsApi.getTemplateArtifact(
                summary.category,
                item.templateId,
                item.templateRevisionId ??
                  summary.revisionId ??
                  summary.revision?.revisionId,
              );
            } catch (err) {
              console.error("[PlacementEngine] Failed to fetch pinned template artifact:", err);
            }
          }

          if (!resolvedTemplate) {
            return { success: false, error: "Template artifact unavailable" };
          }

          const artifact = resolveTextTemplateArtifact(resolvedTemplate);
          const duration =
            artifact?.timing.duration ??
            resolvedTemplate.defaultDuration ??
            resolvedTemplate.duration ??
            4;

          const latest = useTimelineStore.getState();
          placement = resolveAddToTimelinePlacement({
            asset: { type: "video", id: item.templateId, trackType: "text" },
            tracks: latest.tracks,
            clips: latest.clips,
            playheadTime,
            sequenceEndTime: latest.getTimelineEndTime(),
            duration,
          });

          targetTrackId = options.targetTrackId || placement.targetTrackId;
          if (placement.shouldCreateTrack || !targetTrackId) {
            const latestTracks = useTimelineStore.getState().tracks;
            targetTrackId = latest.insertTrackAt(
              "text",
              getInsertIndexForNewTrack(latestTracks, "text"),
            );
          }
          if (!targetTrackId) return { success: false, error: "Failed to allocate text track" };

          const templateClip = instantiateTemplate(resolvedTemplate, {
            trackId: targetTrackId,
            startTime: placement.startTime,
            canvasWidth: project?.canvasWidth || 1920,
            canvasHeight: project?.canvasHeight || 1080,
            customization: item.customization,
          });

          useHistoryStore.getState().execute(new AddClipCommand(templateClip));
          await getActiveSessionOrNull()?.prewarmClip(templateClip, placement.startTime);

          return { success: true, clipId: templateClip.id, trackId: targetTrackId };
        }

        if (placement.shouldCreateTrack || !targetTrackId) {
          const latestTracks = useTimelineStore.getState().tracks;
          targetTrackId = timelineState.insertTrackAt(
            "text",
            getInsertIndexForNewTrack(latestTracks, "text"),
          );
        }
        if (!targetTrackId) return { success: false, error: "Failed to allocate text track" };

        let presetConfig = {};
        if (item.id && typeof item.id === "string" && item.id.startsWith("text-")) {
          const presetName = item.name
            ?.toLowerCase()
            .replace(/\s+/g, "") as keyof typeof TEXT_PRESETS;
          if (TEXT_PRESETS[presetName]) presetConfig = TEXT_PRESETS[presetName];
        }

        const styleId = item.styleId ?? (item.presetType === "effect" ? item.id : undefined);
        let effectDefinition = item.effectDefinition;
        if (styleId && !effectDefinition) {
          effectDefinition = resolveTextEffectDefinition(
            styleId,
            (item as any)?.effectDefinition || (item as any),
          );
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
          ...(styleId !== undefined ? { styleId } : {}),
          styleRevisionId:
            item.styleRevisionId ??
            effectDefinition?.revisionId ??
            effectDefinition?.revision?.revisionId,
          styleContentHash:
            item.styleContentHash ??
            effectDefinition?.contentHash ??
            effectDefinition?.revision?.contentHash,
          styleSnapshot: item.styleSnapshot ?? effectDefinition?.scene,
          effectDefinition,
          templateId: item.templateId,
          customization: item.customization,
        });

        useHistoryStore.getState().execute(new AddClipCommand(textClip));
        await getActiveSessionOrNull()?.prewarmClip(textClip, placement.startTime);

        return { success: true, clipId: textClip.id, trackId: targetTrackId };
      }

      // ─── 3. Audio Library & Sounds ──────────────────────────────────────────
      if (type === "audio") {
        const cachedFile = useAudioLibraryStore.getState().getCachedFile(item.id);
        if (!cachedFile) return { success: false, error: "Audio not cached" };

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
          playheadTime,
          sequenceEndTime,
        });

        let targetTrackId = options.targetTrackId || placement.targetTrackId;
        if (placement.shouldCreateTrack || !targetTrackId) {
          const insertIndex = getInsertIndexForNewTrack(
            useTimelineStore.getState().tracks,
            "audio",
          );
          targetTrackId = timelineState.insertTrackAt("audio", insertIndex);
        }
        if (!targetTrackId) return { success: false, error: "Failed to allocate audio track" };

        const audioClip = createClipFromAsset({
          asset: mediaAsset,
          trackId: targetTrackId,
          startTime: placement.startTime,
          width: project?.canvasWidth || 1920,
          height: project?.canvasHeight || 1080,
          fitMode: resolveDefaultFitModeForAsset(mediaAsset),
          audioPath: absolutePath,
        });

        useHistoryStore.getState().execute(new AddClipCommand(audioClip as any));
        return { success: true, clipId: audioClip.id, trackId: targetTrackId };
      }

      // ─── 4. Stickers ────────────────────────────────────────────────────────
      if (type === "stickers") {
        const cachedSticker = useStickersStore.getState().getCachedSticker(item.id);
        if (!cachedSticker) return { success: false, error: "Sticker not cached" };

        const appCache = await platform.appCacheDir();
        const relativePath = cachedSticker.localImagePath || "";
        if (!relativePath) return { success: false, error: "Sticker image path missing" };

        const absolutePath = await platform.joinPaths(appCache, relativePath);
        const isLottie = Boolean(
          cachedSticker.localAnimationPath &&
            (cachedSticker.localAnimationPath.endsWith(".json") || item.lottieUrl),
        );
        const absoluteAnimationPath =
          isLottie && cachedSticker.localAnimationPath
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
          playheadTime,
          sequenceEndTime,
        });

        let targetTrackId = options.targetTrackId || placement.targetTrackId;
        if (placement.shouldCreateTrack || !targetTrackId) {
          const insertIndex = getInsertIndexForNewTrack(
            useTimelineStore.getState().tracks,
            placement.trackType,
          );
          targetTrackId = timelineState.insertTrackAt(placement.trackType, insertIndex);
        }
        if (!targetTrackId) return { success: false, error: "Failed to allocate sticker track" };

        const stickerClip = createClipFromAsset({
          asset: mediaAsset,
          trackId: targetTrackId,
          startTime: placement.startTime,
          width: project?.canvasWidth || 1920,
          height: project?.canvasHeight || 1080,
          fitMode: resolveDefaultFitModeForAsset(mediaAsset),
        });

        useHistoryStore.getState().execute(new AddClipCommand(stickerClip));
        return { success: true, clipId: stickerClip.id, trackId: targetTrackId };
      }

      // ─── 5. Transitions ─────────────────────────────────────────────────────
      if (type === "transitions") {
        const selectedClipIds = useUIStore.getState().selectedClipIds;
        const selectedPair =
          selectedClipIds.length === 2
            ? ([selectedClipIds[0], selectedClipIds[1]] as const)
            : null;
        const pair = selectedPair ?? findAdjacentClipsAtPlayhead(playheadTime);
        if (!pair) {
          useProjectStore
            .getState()
            .showToast(
              "Select two adjacent clips or place the playhead at a cut",
              "warning",
            );
          return { success: false, error: "No adjacent cut found" };
        }

        const transitionType = item?.renderer || item?.category || "fade";
        const transitionDuration =
          item?.duration?.default || Number(item?.duration) || 0.5;
        const renderer = item?.renderer;
        const result = timelineState.createTransitionBetweenClips(
          pair[0],
          pair[1],
          transitionType,
          transitionDuration,
          renderer,
        );

        if (result.error) {
          useProjectStore.getState().showToast(result.error, "warning");
          return { success: false, error: result.error };
        } else if (result.transition) {
          useHistoryStore.getState().execute(new AddTransitionCommand(result.transition));
          useProjectStore
            .getState()
            .showToast(`${item?.name || "Transition"} added between clips`);
          return { success: true };
        }
      }

      // ─── 6. Filters & Video/Body Effects ────────────────────────────────────
      if (type === "filters") {
        const cachedFilter = filterCacheManager.getCached(item.id);
        if (!cachedFilter) {
          useProjectStore.getState().showToast("Filter not downloaded yet", "warning");
          return { success: false, error: "Filter not downloaded" };
        }

        const placement = resolveAddToTimelinePlacement({
          asset: { type: "video", id: item.id, trackType: "filter" },
          tracks,
          clips,
          playheadTime,
          sequenceEndTime,
        });

        let targetTrackId = options.targetTrackId || placement.targetTrackId;
        if (placement.shouldCreateTrack || !targetTrackId) {
          const latestTracks = useTimelineStore.getState().tracks;
          const latestClips = useTimelineStore.getState().clips;
          const insertIndex = getInsertIndexForNewTrackGrouped(
            latestTracks,
            latestClips,
            "filter",
            item.id,
          );
          targetTrackId = timelineState.insertTrackAt("filter", insertIndex);
        }
        if (!targetTrackId) return { success: false, error: "Failed to allocate filter track" };

        const defaultIntensity =
          item.intensity?.default !== undefined ? item.intensity.default / 100 : 0.8;
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

        useHistoryStore.getState().execute(new AddClipCommand(filterClip as any));
        useProjectStore.getState().showToast(`Added ${cachedFilter.filter.name} filter`);

        return { success: true, clipId: filterClip.id, trackId: targetTrackId };
      }

      if (type === "video-effects" || type === "body-effects") {
        const effectTrackType: TrackType =
          type === "body-effects" ? "body-effect" : "video-effect";

        const placement = resolveAddToTimelinePlacement({
          asset: { type: "video", id: item.id, trackType: effectTrackType },
          tracks,
          clips,
          playheadTime,
          sequenceEndTime,
        });

        let targetTrackId = options.targetTrackId || placement.targetTrackId;
        if (placement.shouldCreateTrack || !targetTrackId) {
          const latestTracks = useTimelineStore.getState().tracks;
          const latestClips = useTimelineStore.getState().clips;
          const insertIndex = getInsertIndexForNewTrackGrouped(
            latestTracks,
            latestClips,
            effectTrackType,
            item.id,
          );
          targetTrackId = timelineState.insertTrackAt(effectTrackType, insertIndex);
        }
        if (!targetTrackId) return { success: false, error: "Failed to allocate effect track" };

        const defaultIntensity =
          item.intensity?.default !== undefined ? item.intensity.default / 100 : 0.8;
        const effectClip = {
          id: generateId(
            type === "body-effects" ? "body-effect-clip" : "video-effect-clip",
          ),
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
          ...(type === "body-effects" && item.requirements
            ? { requirements: item.requirements }
            : {}),
        };

        useHistoryStore.getState().execute(new AddClipCommand(effectClip as any));
        useProjectStore.getState().showToast(`Added ${item.name} effect`);

        return { success: true, clipId: effectClip.id, trackId: targetTrackId };
      }

      return { success: false, error: `Unhandled item type: ${type}` };
    } finally {
      coordinator.commit(token, false);
    }
  }
}
