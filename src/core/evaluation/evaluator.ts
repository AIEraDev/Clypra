/**
 * Canonical Scene Evaluator
 *
 * This is the SINGLE SOURCE OF TRUTH for timeline evaluation.
 * All rendering paths use this:
 * - Preview
 * - Export
 * - Thumbnails
 * - Proxies
 *
 * Follows the Evaluation Contract (see contract.md)
 */

import type { Clip, Track, MediaAsset, Project, TextClip } from "@/types";
import type { EvaluatedScene, EvaluatedVisualLayer, EvaluatedMediaLayer, EvaluatedTextLayer, EvaluatedAudioLayer, EvaluatedTransition, SceneMetadata, BlendMode } from "./types";
import { toCompositorClips } from "../timeline/adapter";
import { getClipEndTime } from "@/lib/timelineClip";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getEvaluationCache, computeClipVersion } from "./cache";

/**
 * Evaluate the timeline at a specific time.
 * Returns a complete EvaluatedScene ready for rendering.
 *
 * This is the canonical evaluation function.
 * All other evaluation paths should use this.
 *
 * @param time - Timeline time in seconds
 * @param clips - All clips in timeline
 * @param tracks - All tracks
 * @param assets - All media assets
 * @param project - Project settings
 * @returns Complete evaluated scene
 */
export function evaluateScene(time: number, clips: Clip[], tracks: Track[], assets: MediaAsset[], project: Project | null): EvaluatedScene {
  // Convert to compositor clips (adds roles, priorities)
  const compositorClips = toCompositorClips(clips, tracks);

  // Build lookup maps for performance
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const trackIndexMap = new Map(tracks.map((track, index) => [track.id, index]));

  // ─── 1. Active Clip Resolution (Contract §1) ─────────────────────────────

  const activeClips = compositorClips.filter((clip) => {
    // Time bounds check
    const clipEnd = getClipEndTime(clip);
    const isInTimeBounds = clip.startTime <= time && time < clipEnd;

    // Track visibility check
    const track = trackMap.get(clip.trackId);
    const isVisible = track?.visible ?? true;

    return isInTimeBounds && isVisible;
  });

  // ─── 2. Compositing Order (Contract §2) ───────────────────────────────────

  const sortedClips = activeClips.sort((a, b) => {
    // 1. Role type
    const roleOrder = getRoleOrder(a.role) - getRoleOrder(b.role);
    if (roleOrder !== 0) return roleOrder;

    // 2. Track index (INVERTED: higher index renders below, so top track renders on top)
    const trackOrder = b.trackIndex - a.trackIndex;
    if (trackOrder !== 0) return trackOrder;

    // 3. Z-index
    const zOrder = a.zIndex - b.zIndex;
    if (zOrder !== 0) return zOrder;

    // 4. Evaluation priority
    return a.evaluationPriority - b.evaluationPriority;
  });

  // ─── 3. Evaluate Visual Layers ────────────────────────────────────────────

  const visualLayers: EvaluatedVisualLayer[] = [];

  for (let i = 0; i < sortedClips.length; i++) {
    const clip = sortedClips[i];

    // Check if this is a text clip
    const isTextClip = "text" in clip;

    if (isTextClip) {
      // Evaluate text layer
      const textClip = clip as unknown as TextClip;

      // Evaluate transition state
      const transitionState = evaluateTransitionState(clip, time, sortedClips);

      const textLayer: EvaluatedTextLayer = {
        layerId: `${clip.id}-${time}`,
        clipId: clip.id,
        role: clip.role,
        zIndex: i,
        layerType: "text",

        // Transform
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
        rotation: clip.rotation,
        opacity: clip.opacity * (transitionState.opacity ?? 1.0),

        // Transition
        inTransition: transitionState.inTransition,
        transitionType: transitionState.type,
        transitionProgress: transitionState.progress,
        blendMode: "normal",

        // Text content
        text: textClip.text || "Text",
        fontFamily: textClip.fontFamily || "Inter, system-ui, sans-serif",
        fontSize: textClip.fontSize || 48,
        color: textClip.color || "#ffffff",
        fontWeight: (textClip.fontWeight || "normal") as "normal" | "bold" | number,
        fontStyle: textClip.fontStyle || "normal",
        textAlign: textClip.align || "center",
        verticalAlign: textClip.valign || "middle",
        lineHeight: textClip.lineHeight || 1.2,
        letterSpacing: textClip.letterSpacing || 0,
      };

      visualLayers.push(textLayer);
      continue;
    }

    // Handle media layers (video/image)
    const asset = assetMap.get(clip.mediaId);

    // Skip non-visual clips
    if (!asset || (asset.type !== "video" && asset.type !== "image")) {
      continue;
    }

    // Calculate source time (accounting for trim)
    const sourceTime = clip.trimIn + (time - clip.startTime);

    // Convert file path to Tauri URL
    const sourcePath = asset.path ? convertFileSrc(asset.path) : asset.posterFrame || "";
    if (!sourcePath) continue;

    // Evaluate transition state (Contract §3 - basic implementation)
    const transitionState = evaluateTransitionState(clip, time, sortedClips);

    // Create evaluated media layer
    const mediaLayer: EvaluatedMediaLayer = {
      layerId: `${clip.id}-${time}`,
      clipId: clip.id,
      role: clip.role,
      zIndex: i, // Actual render order
      layerType: "media",

      // Source media
      mediaId: clip.mediaId,
      mediaType: asset.type === "video" ? "video" : "image",
      sourcePath,
      posterFrame: asset.posterFrame,
      sourceTime,

      // Transform
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      rotation: clip.rotation,
      opacity: clip.opacity * (transitionState.opacity ?? 1.0),

      // Transition
      inTransition: transitionState.inTransition,
      transitionType: transitionState.type,
      transitionProgress: transitionState.progress,
      blendMode: "normal",
    };

    visualLayers.push(mediaLayer);
  }

  // ─── 4. Evaluate Audio Layers (Contract §6) ───────────────────────────────

  const audioLayers: EvaluatedAudioLayer[] = [];

  for (const clip of sortedClips) {
    const asset = assetMap.get(clip.mediaId);
    const track = trackMap.get(clip.trackId);

    // Check if clip has audio
    const hasAudio = clip.role === "audio" || (asset?.type === "video" && clip.role === "primary");

    if (!hasAudio || !asset) continue;

    // Check if muted
    const isMuted = track?.muted ?? false;
    if (isMuted) continue;

    // Calculate source time
    const sourceTime = clip.trimIn + (time - clip.startTime);

    // Convert file path
    const sourcePath = asset.path ? convertFileSrc(asset.path) : "";
    if (!sourcePath) continue;

    const audioLayer: EvaluatedAudioLayer = {
      layerId: `${clip.id}-audio-${time}`,
      clipId: clip.id,
      mediaId: clip.mediaId,
      sourcePath,
      sourceTime,
      volume: 1.0, // TODO: Per-clip volume
      pan: 0.0, // TODO: Per-clip pan
      priority: clip.trackIndex, // Higher tracks have priority
      muted: false,
    };

    audioLayers.push(audioLayer);
  }

  // Sort audio by priority (higher = more important)
  audioLayers.sort((a, b) => b.priority - a.priority);

  // ─── 5. Evaluate Transitions (Contract §3 - placeholder) ──────────────────

  const transitions: EvaluatedTransition[] = [];
  // TODO: Detect and evaluate transitions between clips

  // ─── 6. Create Metadata ────────────────────────────────────────────────────

  // Create deterministic hash of active media to trigger lifecycle events
  const activeMediaHash = visualLayers
    .filter((l) => l.layerType === "media")
    .map((l) => l.clipId)
    .sort() // Sort to prevent ordering bugs
    .join("|");

  const metadata: SceneMetadata = {
    time,
    canvasWidth: project?.canvasWidth ?? 1920,
    canvasHeight: project?.canvasHeight ?? 1080,
    frameRate: project?.frameRate ?? 30,
    isGap: visualLayers.length === 0,
    fallbackStrategy: visualLayers.length === 0 ? "black" : undefined,
    activeMediaHash,
  };

  // ─── 7. Return Evaluated Scene ────────────────────────────────────────────

  return {
    visualLayers,
    audioLayers,
    transitions,
    metadata,
  };
}

/**
 * Get role order for compositing (Contract §2).
 */
function getRoleOrder(role: string): number {
  const order: Record<string, number> = {
    background: 0,
    primary: 1,
    overlay: 2,
    text: 3,
    effect: 4,
    audio: -1, // Audio doesn't participate in visual compositing
  };
  return order[role] ?? 1;
}

/**
 * Evaluate transition state for a clip (Contract §3 - basic implementation).
 *
 * TODO: This is a placeholder. Full transition evaluation needs:
 * - Transition detection at clip boundaries
 * - Configurable transition duration
 * - Multiple transition types
 * - Transition curves (ease in/out)
 */
function evaluateTransitionState(
  clip: any,
  time: number,
  allClips: any[],
): {
  inTransition: boolean;
  type?: "fade" | "dissolve";
  progress?: number;
  opacity?: number;
} {
  // Placeholder: No transitions yet
  return {
    inTransition: false,
    opacity: 1.0,
  };

  // TODO: Implement transition detection
  // const transitionDuration = 0.5; // seconds
  // const clipEnd = getClipEndTime(clip);
  //
  // // Fade out at end
  // if (time > clipEnd - transitionDuration && time <= clipEnd) {
  //   const progress = (time - (clipEnd - transitionDuration)) / transitionDuration;
  //   return {
  //     inTransition: true,
  //     type: "fade",
  //     progress,
  //     opacity: 1.0 - progress,
  //   };
  // }
  //
  // return { inTransition: false, opacity: 1.0 };
}

/**
 * Evaluate scene with caching.
 *
 * This is the recommended entry point for all evaluation.
 * Uses LRU cache with epoch-based invalidation.
 *
 * @param time - Timeline time in seconds
 * @param clips - All clips in timeline
 * @param tracks - All tracks
 * @param assets - All media assets
 * @param project - Project settings
 * @param epoch - Timeline epoch (for cache invalidation)
 * @returns Complete evaluated scene
 */
export function evaluateSceneCached(time: number, clips: Clip[], tracks: Track[], assets: MediaAsset[], project: Project | null, epoch: number = 0): EvaluatedScene {
  const cache = getEvaluationCache();

  // Compute cache key
  const clipVersion = computeClipVersion(clips);
  const cacheKey = { time, epoch, clipVersion };

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Cache miss - evaluate
  const scene = evaluateScene(time, clips, tracks, assets, project);

  // Store in cache
  cache.set(cacheKey, scene);

  return scene;
}

/**
 * Get cache statistics (for debugging/monitoring).
 */
export function getEvaluationCacheStats() {
  return getEvaluationCache().getStats();
}

/**
 * Clear evaluation cache (for testing or manual invalidation).
 */
export function clearEvaluationCache() {
  getEvaluationCache().clear();
}

/**
 * Invalidate cache for specific epoch (called when timeline changes).
 */
export function invalidateEvaluationCache(epoch: number) {
  getEvaluationCache().invalidateEpoch(epoch);
}
