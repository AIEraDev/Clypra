/**
 * Canonical Timeline Scene Evaluator
 *
 * This is the SINGLE SOURCE OF TRUTH for NLE timeline evaluation.
 * All rendering paths use this:
 * - Preview
 * - Export
 * - Thumbnails
 * - Proxies
 *
 * NOTE: The function is named evaluateTimelineScene (not evaluateScene) to
 * avoid collision with @clypra-studio/engine's evaluateScene, which takes a
 * SceneDocument and draws directly to a Canvas 2D context. These two
 * functions operate at different layers:
 *
 *   evaluateTimelineScene  → reads Clips/Tracks/Assets → produces EvaluatedScene
 *   engine.evaluateScene   → reads SceneDocument       → draws pixels
 */

import type { Clip, Track, MediaAsset, Project, TextClip, TransitionTimelineItem } from "@/types";
import type { EvaluatedScene, EvaluatedVisualLayer, EvaluatedMediaLayer, EvaluatedTextLayer, EvaluatedAudioLayer, EvaluatedTransition, SceneMetadata, BlendMode } from "./types";
import { toCompositorClips } from "../timeline/adapter";
import { getClipEndTime } from "@/lib/timeline/timelineClip";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveConform } from "@clypra-studio/engine";

const isExternalOrDataUrl = (value: string) => value.startsWith("data:") || value.startsWith("http") || value.startsWith("asset://");
import { getEvaluationCache, computeClipVersion, computeAssetsVersion } from "./cache";
import { evaluateProperty } from "./animation";
import { resolveClipSourceTime } from "../timeline/sourceTime";
import { calculateTextAnimationState } from "@/lib/text/textAnimation";
import { normalizeFilterIntensity } from "../render/filterIR";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";

/**
 * Evaluate the NLE timeline at a specific time.
 * Returns a complete EvaluatedScene ready for rasterization.
 *
 * @param time    - Timeline time in seconds
 * @param clips   - All clips in timeline
 * @param tracks  - All tracks
 * @param assets  - All media assets
 * @param project - Project settings
 */
export function evaluateTimelineScene(time: number, clips: Clip[], tracks: Track[], assets: MediaAsset[], project: Project | null, transitions: TransitionTimelineItem[] = []): EvaluatedScene {
  // Convert to compositor clips (adds roles, priorities)
  const compositorClips = toCompositorClips(clips, tracks);

  // Build lookup maps for performance
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  // Determine the max end time of all clips to identify the end of the active timeline
  const maxEndTime = compositorClips.reduce((max, clip) => {
    const clipEnd = clip.startTime + clip.duration;
    return Math.max(max, clipEnd);
  }, 0);

  // If time is exactly at or slightly past the end of the active timeline (and not in a gap),
  // clamp it slightly back (e.g., by 0.001s) so that the final frame remains active and rendered.
  let evalTime = time;
  if (maxEndTime > 0 && evalTime >= maxEndTime && evalTime < maxEndTime + 0.001) {
    evalTime = Math.max(0, maxEndTime - 0.001);
  }

  // ─── 1. Active Clip Resolution (Contract §1) ─────────────────────────────

  const transitionWindows = resolveActiveTransitionWindows(transitions, compositorClips, evalTime);

  const activeClips = compositorClips.filter((clip) => {
    const clipEnd = getClipEndTime(clip);
    const isInTimeBounds = clip.startTime <= evalTime && evalTime < clipEnd;
    const track = trackMap.get(clip.trackId);
    const isVisible = track?.visible ?? true;
    const isInTransition = transitionWindows.some((transition) => transition.fromClip.id === clip.id || transition.toClip.id === clip.id);
    return (isInTimeBounds || isInTransition) && isVisible;
  });

  // ─── 2. Compositing Order (Contract §2) ───────────────────────────────────

  // Find active timeline filter clip at this time (lowest trackIndex = top in UI)
  const activeFilterClips = compositorClips
    .filter((c) => {
      const track = trackMap.get(c.trackId);
      return c.kind === "filter" && (track?.visible ?? true) && c.startTime <= evalTime && evalTime < c.startTime + c.duration;
    })
    .sort((a, b) => a.trackIndex - b.trackIndex);
  const activeFilterClip = activeFilterClips[0] ?? null;

  const activeEffectClips = compositorClips
    .filter((c) => {
      const track = trackMap.get(c.trackId);
      return (c.kind === "video-effect" || c.kind === "body-effect") && (track?.visible ?? true) && c.startTime <= evalTime && evalTime < c.startTime + c.duration;
    })
    .sort((a, b) => a.trackIndex - b.trackIndex);

  const sortedClips = activeClips.sort((a, b) => {
    const roleOrder = getRoleOrder(a.role) - getRoleOrder(b.role);
    if (roleOrder !== 0) return roleOrder;
    // CRITICAL: Lower trackIndex (top in UI) must draw LAST to appear on top
    // The rasterizer draws array elements in order: [0] first, [last] last
    // Canvas compositing: last drawn = on top
    // So: higher trackIndex → earlier in array, lower trackIndex → later in array
    const trackOrder = b.trackIndex - a.trackIndex; // DESC: higher index first (draws early/below), lower index last (draws late/on top)
    if (trackOrder !== 0) return trackOrder;
    const zOrder = a.zIndex - b.zIndex;
    if (zOrder !== 0) return zOrder;
    return a.evaluationPriority - b.evaluationPriority;
  });

  // ─── 3. Evaluate Visual Layers ────────────────────────────────────────────

  const visualLayers: EvaluatedVisualLayer[] = [];

  for (let i = 0; i < sortedClips.length; i++) {
    const clip = sortedClips[i];
    const offset = evalTime - clip.startTime;
    const kf = (clip as any).keyframes || {};

    let evalX = kf.x !== undefined ? evaluateProperty(kf.x, offset, clip.duration) : clip.x;
    let evalY = kf.y !== undefined ? evaluateProperty(kf.y, offset, clip.duration) : clip.y;
    let evalW = kf.width !== undefined ? evaluateProperty(kf.width, offset, clip.duration) : clip.width;
    let evalH = kf.height !== undefined ? evaluateProperty(kf.height, offset, clip.duration) : clip.height;

    if (clip.conform && clip.conform.sourceWidth && clip.conform.sourceHeight) {
      const conformed = resolveConform(clip.conform, project?.canvasWidth ?? 1920, project?.canvasHeight ?? 1080);
      evalX = conformed.x;
      evalY = conformed.y;
      evalW = conformed.width;
      evalH = conformed.height;
    }

    const evalRot = kf.rotation !== undefined ? evaluateProperty(kf.rotation, offset, clip.duration) : clip.rotation;
    const evalOpacity = kf.opacity !== undefined ? evaluateProperty(kf.opacity, offset, clip.duration) : clip.opacity;

    const isTextClip = clip.kind === "text";

    if (isTextClip) {
      const textClip = clip as unknown as TextClip;
      const transitionState = evaluateTransitionState(clip, transitionWindows);

      const styleDefinition = textClip.styleId ? (useEffectsStore.getState().definitions[textClip.styleId] ?? textClip.styleDefinition) : textClip.styleDefinition;

      const evalFontSize = kf.fontSize !== undefined ? evaluateProperty(kf.fontSize, offset, clip.duration) : textClip.fontSize || 48;
      const evalColor = kf.color !== undefined ? evaluateProperty(kf.color, offset, clip.duration) : textClip.color || "#ffffff";
      const evalLetterSpacing = kf.letterSpacing !== undefined ? evaluateProperty(kf.letterSpacing, offset, clip.duration) : (textClip.letterSpacing ?? styleDefinition?.font?.letterSpacing ?? 0);
      const evalLineHeight = kf.lineHeight !== undefined ? evaluateProperty(kf.lineHeight, offset, clip.duration) : (textClip.lineHeight ?? styleDefinition?.font?.lineHeight ?? 1.2);

      // ── Calculate Text Animations ──────────────────────────────────────────
      const animationState = calculateTextAnimationState(evalTime, clip.startTime, clip.duration, textClip.entranceAnimation, textClip.exitAnimation);

      // Apply animation opacity (multiply with transition opacity)
      const finalOpacity = evalOpacity * (transitionState.opacity ?? 1.0) * animationState.opacity;

      // Apply animation transforms to position
      const finalX = evalX + animationState.translateX;
      const finalY = evalY + animationState.translateY;

      // Apply animation scale to dimensions
      const finalWidth = evalW * animationState.scale;
      const finalHeight = evalH * animationState.scale;

      const textLayer: EvaluatedTextLayer = {
        layerId: clip.id,
        clipId: clip.id,
        role: clip.role,
        clipKind: clip.kind,
        zIndex: i,
        trackIndex: clip.trackIndex,
        layerType: "text",
        time: evalTime,
        clipStartTime: clip.startTime,
        clipDuration: clip.duration,
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight,
        rotation: evalRot,
        opacity: finalOpacity,
        inTransition: transitionState.inTransition,
        transitionType: transitionState.type,
        transitionProgress: transitionState.progress,
        blendMode: (clip as any).blendMode || "normal",
        text: textClip.text || "Text",
        fontFamily: normalizeFontFamily(textClip.fontFamily || styleDefinition?.font?.family || "Inter Variable"),
        fontSize: evalFontSize,
        color: evalColor,
        fontWeight: (textClip.fontWeight ?? styleDefinition?.font?.weight ?? "normal") as "normal" | "bold" | number,
        fontStyle: textClip.fontStyle || styleDefinition?.font?.style || "normal",
        textAlign: textClip.align || "center",
        verticalAlign: textClip.valign || "middle",
        lineHeight: evalLineHeight,
        letterSpacing: evalLetterSpacing,
        stroke: textClip.stroke,
        shadow: textClip.shadow,
        background: textClip.background,
        styleId: textClip.styleId,
        styleDefinition,
        templateId: textClip.templateId,
        customization: textClip.customization,
      };

      visualLayers.push(textLayer);

      continue;
    }

    // ── Media layers ──────────────────────────────────────────────────────────
    let asset = assetMap.get(clip.mediaId);
    if (!asset && (clip.kind === "sticker" || clip.mediaId.startsWith("sticker-"))) {
      asset = {
        id: clip.mediaId,
        name: clip.name || "Sticker",
        path: (clip as any).stickerImagePath || clip.stickerAnimationPath || "",
        type: "image",
        duration: clip.duration,
        size: 0,
        stickerFormat: clip.stickerFormat,
        stickerAnimationPath: clip.stickerAnimationPath,
        stickerSourceId: clip.stickerSourceId,
      };
    }
    if (!asset || (asset.type !== "video" && asset.type !== "image")) continue;

    const sourceTime = resolveClipSourceTime(clip, evalTime, {
      clampToRange: true,
      frameRate: project?.frameRate ?? 30,
    }).sourceTime;
    const sourcePath = asset.path ? (isExternalOrDataUrl(asset.path) ? asset.path : convertFileSrc(asset.path)) : asset.posterFrame || "";
    if (!sourcePath) continue;

    const transitionState = evaluateTransitionState(clip, transitionWindows);

    const mediaLayer: EvaluatedMediaLayer = {
      layerId: clip.id,
      clipId: clip.id,
      role: clip.role,
      clipKind: clip.kind,
      zIndex: i,
      trackIndex: clip.trackIndex, // ADDED: Include track index for compositor debugging
      layerType: "media",
      mediaId: clip.mediaId,
      mediaType: asset.type === "video" ? "video" : "image",
      sourcePath,
      posterFrame: asset.posterFrame,
      sourceTime,
      sourceRotation: asset.rotation,
      conform: (clip as any).conform,
      adjustments: clip.adjustments,
      x: evalX,
      y: evalY,
      width: evalW,
      height: evalH,
      rotation: evalRot,
      opacity: evalOpacity,
      transitionOpacity: transitionState.opacity ?? 1.0,
      inTransition: transitionState.inTransition,
      transitionType: transitionState.type,
      transitionProgress: transitionState.progress,
      blendMode: (clip as any).blendMode || "normal",
      stickerSettings: (clip as any).stickerSettings,
      stickerFormat: (clip as any).stickerFormat ?? (asset as any).stickerFormat,
      stickerAnimationPath: (clip as any).stickerAnimationPath ?? (asset as any).stickerAnimationPath,
      stickerSourceId: (clip as any).stickerSourceId ?? (asset as any).stickerSourceId,
      effects: [
        ...(clip.effects || []).map((fx) => ({
          effectId: fx.effectId || fx.id,
          type: "video_effect" as const,
          renderer: fx.renderer || fx.effectId || fx.id,
          parameters: { ...(fx.params || {}), name: fx.name },
          intensity: normalizeEffectIntensity(fx.intensity),
          localTime: Math.max(0, offset - (fx.startTime || 0)),
        })),
        ...activeEffectClips.map((fxClip) => ({
          effectId: fxClip.mediaId || fxClip.id,
          type: fxClip.kind === "body-effect" ? ("body_effect" as const) : ("video_effect" as const),
          renderer: (fxClip as any).renderer || fxClip.mediaId || fxClip.id,
          parameters: { ...((fxClip as any).params || {}), name: fxClip.name },
          intensity: normalizeEffectIntensity((fxClip as any).intensity),
          localTime: Math.max(0, evalTime - fxClip.startTime),
        })),
      ],
      // Apply filter from clip (if directly attached) OR from activeFilterClip (timeline filter track)
      filter:
        clip.filter ||
        (activeFilterClip
          ? {
              id: activeFilterClip.mediaId,
              name: activeFilterClip.name || "",
              intensity: normalizeFilterIntensity((activeFilterClip as any).intensity),
            }
          : undefined),
    };

    visualLayers.push(mediaLayer);
  }

  // ─── 4. Evaluate Audio Layers ─────────────────────────────────────────────

  const audioLayers: EvaluatedAudioLayer[] = [];

  for (const clip of sortedClips) {
    const asset = assetMap.get(clip.mediaId);
    const track = trackMap.get(clip.trackId);
    // Audio layer creation:
    // - Explicit audio role clips always create audio
    // - Video assets with primary OR overlay role create audio (video tracks have audio)
    const hasAudio = clip.role === "audio" || (asset?.type === "video" && (clip.role === "primary" || clip.role === "overlay"));
    if (!hasAudio || !asset) continue;
    if (track?.muted ?? false) continue;

    const sourceTime = resolveClipSourceTime(clip, evalTime, {
      clampToRange: true,
      frameRate: project?.frameRate ?? 30,
    }).sourceTime;
    const sourcePath = asset.path ? (isExternalOrDataUrl(asset.path) ? asset.path : convertFileSrc(asset.path)) : "";
    if (!sourcePath) continue;

    audioLayers.push({
      layerId: `${clip.id}-audio`,
      clipId: clip.id,
      mediaId: clip.mediaId,
      sourcePath,
      sourceTime,
      pan: 0.0,
      priority: clip.trackIndex,
      volume: Math.max(0, Math.min(1, clip.volume ?? 1.0)),
      muted: track?.muted ?? false,
    });
  }

  audioLayers.sort((a, b) => b.priority - a.priority);

  // ─── 5. Transitions ───────────────────────────────────────────────────────
  const evaluatedTransitions: EvaluatedTransition[] = transitionWindows
    .map<EvaluatedTransition | null>((transition) => {
      const outgoingLayer = visualLayers.find((layer) => layer.clipId === transition.fromClip.id);
      const incomingLayer = visualLayers.find((layer) => layer.clipId === transition.toClip.id);
      if (!outgoingLayer || !incomingLayer) return null;
      return {
        transitionId: transition.transition.id,
        type: transition.transition.type,
        renderer: transition.transition.renderer, // Pass renderer from timeline transition
        progress: transition.progress,
        duration: transition.transition.placement.duration,
        outgoingLayer: outgoingLayer.layerId,
        incomingLayer: incomingLayer.layerId,
        blendMode: "normal" as BlendMode,
      };
    })
    .filter((transition): transition is EvaluatedTransition => transition !== null);

  // ─── 6. Metadata ──────────────────────────────────────────────────────────

  const activeMediaHash = visualLayers
    .filter((l) => l.layerType === "media")
    .map((l) => l.clipId)
    .sort()
    .join("|");

  const metadata: SceneMetadata = {
    time: evalTime,
    canvasWidth: project?.canvasWidth ?? 1920,
    canvasHeight: project?.canvasHeight ?? 1080,
    frameRate: project?.frameRate ?? 30,
    isGap: visualLayers.length === 0,
    fallbackStrategy: visualLayers.length === 0 ? "black" : undefined,
    activeMediaHash,
  };

  const activeFilter = activeFilterClip
    ? {
        id: activeFilterClip.mediaId,
        name: activeFilterClip.name || "",
        intensity: normalizeFilterIntensity((activeFilterClip as any).intensity),
        pipeline: (activeFilterClip as any).pipeline as "v2" | undefined,
        effectStack: (activeFilterClip as any).effectStack as Array<{ type: string; params?: Record<string, unknown> }> | undefined,
      }
    : undefined;

  return { visualLayers, audioLayers, transitions: evaluatedTransitions, metadata, activeFilter };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRoleOrder(role: string): number {
  const order: Record<string, number> = {
    background: 0,
    primary: 1,
    overlay: 2,
    text: 3,
    effect: 4,
    audio: -1,
  };
  return order[role] ?? 1;
}

function normalizeEffectIntensity(value: unknown): number {
  const numeric = typeof value === "number" ? value : 1;
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(0, Math.min(1, numeric));
}

interface ActiveTransitionWindow {
  transition: TransitionTimelineItem;
  fromClip: Clip;
  toClip: Clip;
  progress: number;
}

function resolveActiveTransitionWindows(transitions: TransitionTimelineItem[], clips: Clip[], time: number): ActiveTransitionWindow[] {
  return transitions
    .map((transition) => {
      const start = transition.placement.startTime;
      const duration = transition.placement.duration;
      const end = start + duration;
      if (duration <= 0 || time < start || time > end) return null;

      const fromClip = clips.find((clip) => clip.id === transition.fromItemId);
      const toClip = clips.find((clip) => clip.id === transition.toItemId);
      if (!fromClip || !toClip) return null;

      const rawProgress = Math.max(0, Math.min(1, (time - start) / duration));
      // Map legacy "easeInOut" to "ease-in-out" for compatibility
      const easing = (transition.easing as string) === "easeInOut" ? "ease-in-out" : transition.easing;
      const progress = easing === "ease-in-out" ? rawProgress * rawProgress * (3 - 2 * rawProgress) : rawProgress;
      return { transition, fromClip, toClip, progress };
    })
    .filter((transition): transition is ActiveTransitionWindow => transition !== null);
}

function evaluateTransitionState(
  clip: Clip,
  transitionWindows: ActiveTransitionWindow[],
): {
  inTransition: boolean;
  type?: EvaluatedTransition["type"];
  progress?: number;
  opacity?: number;
} {
  const transition = transitionWindows.find((candidate) => candidate.fromClip.id === clip.id || candidate.toClip.id === clip.id);
  if (!transition) return { inTransition: false, opacity: 1.0 };

  const isOutgoing = transition.fromClip.id === clip.id;
  const opacity = isOutgoing ? 1 - transition.progress : transition.progress;
  return {
    inTransition: true,
    type: transition.transition.type,
    progress: transition.progress,
    opacity,
  };
}

// ─── Cached variant ───────────────────────────────────────────────────────────

/**
 * Evaluate the NLE timeline with LRU caching and epoch-based invalidation.
 * This is the recommended entry point for all preview/render paths.
 */
export function evaluateTimelineSceneCached(time: number, clips: Clip[], tracks: Track[], assets: MediaAsset[], project: Project | null, epoch: number = 0, transitions: TransitionTimelineItem[] = []): EvaluatedScene {
  const cache = getEvaluationCache();
  const clipVersion = computeClipVersion(clips, transitions);
  const assetsVersion = computeAssetsVersion(assets);
  const canvasWidth = project?.canvasWidth ?? 1920;
  const canvasHeight = project?.canvasHeight ?? 1080;
  const cacheKey = { time, epoch, clipVersion, assetsVersion, canvasWidth, canvasHeight };

  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const scene = evaluateTimelineScene(time, clips, tracks, assets, project, transitions);
  cache.set(cacheKey, scene);
  return scene;
}

export function getEvaluationCacheStats() {
  return getEvaluationCache().getStats();
}

export function clearEvaluationCache() {
  getEvaluationCache().clear();
}

export function invalidateEvaluationCache(epoch: number) {
  getEvaluationCache().invalidateEpoch(epoch);
}

/**
 * Resolve and normalize font family strings to exact loaded Fontsource font stacks.
 */
export function normalizeFontFamily(family: string): string {
  const f = family.toLowerCase();
  if (f === "inter") return "Inter";
  if (f.includes("inter")) return "Inter Variable";
  if (f.includes("montserrat")) return "Montserrat Variable";
  if (f.includes("geist")) return "Geist Variable";
  if (f.includes("space grotesk") || f.includes("grotesk")) return "Space Grotesk Variable";
  if (f.includes("outfit")) return "Outfit Variable";
  if (f.includes("roboto condensed")) return "Roboto Condensed";
  if (f.includes("roboto variable")) return "Roboto Variable";
  if (f === "roboto") return "Roboto Variable";
  if (f.includes("open sans")) return "Open Sans Variable";
  if (f.includes("raleway")) return "Raleway Variable";
  if (f.includes("oswald")) return "Oswald Variable";
  if (f.includes("playfair display")) return "Playfair Display Variable";
  if (f.includes("nunito")) return "Nunito Variable";
  if (f.includes("dancing script")) return "Dancing Script Variable";
  return family;
}
