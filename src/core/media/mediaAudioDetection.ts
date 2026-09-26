import type { Clip, MediaAsset } from "@/types";

/**
 * Authoritative check for whether a MediaAsset has an audio stream.
 *
 * - Returns `true` for standalone audio assets (`type === "audio"`).
 * - Returns `false` for image assets (`type === "image"`).
 * - For video assets (`type === "video"`):
 *     - If `streams` metadata has been probed: returns `true` if at least one stream is of type `"audio"`.
 *     - If `streams` is empty or only has video/data streams: returns `false`.
 *     - If `streams` has not yet been probed (undefined): defaults to `true` to avoid premature UI gating before probing finishes.
 */
export function assetHasAudio(asset: MediaAsset | null | undefined): boolean {
  if (!asset) return false;
  if (asset.type === "audio") return true;
  if (asset.type === "image") return false;

  if (asset.type === "video") {
    if (Array.isArray(asset.streams)) {
      if (asset.streams.length === 0) {
        // Explicitly probed with zero streams (unlikely, but safe)
        return false;
      }
      return asset.streams.some((stream) => stream.type === "audio");
    }
    // Unprobed fallback: assume true until probed
    return true;
  }

  return false;
}

/**
 * Authoritative check for whether a timeline Clip has audible content.
 *
 * Returns `false` for:
 * - Non-audiovisual clip kinds (text, text-template, sticker, filter, effect, image)
 * - Video clips whose underlying asset has been verified to have no audio stream
 * - Video clips whose audio has been detached (`detachedFromClipId` is set)
 *
 * Returns `true` for:
 * - Audio clips (`kind === "audio"`)
 * - Video clips with verified audio streams
 * - Clips with an explicit `audioPath`
 */
export function clipHasAudio(
  clip: Clip | null | undefined,
  asset: MediaAsset | null | undefined,
): boolean {
  if (!clip) return false;

  // Non-audio kinds never have audio
  if (
    clip.kind === "text" ||
    clip.kind === "text-template" ||
    clip.kind === "sticker" ||
    clip.kind === "image" ||
    clip.kind === "filter" ||
    clip.kind === "video-effect"
  ) {
    return false;
  }

  if (clip.kind === "audio") {
    return true;
  }

  // Explicit audioPath attached to the clip
  if (Boolean((clip as any).audioPath)) {
    return true;
  }

  if (clip.kind === "video") {
    // If audio was already detached into a separate audio clip, the video clip itself is silent
    if (Boolean(clip.detachedFromClipId) || clip.audio?.linkState === "detached") {
      return false;
    }
    // If asset is provided, inspect its probed streams.
    // If asset is absent (offline media or not yet hydrated), default to true
    // so offline video clips do not prematurely lose audio controls.
    return asset ? assetHasAudio(asset) : true;
  }

  // Clips with kind unspecified (e.g. legacy projects or mock clips)
  if (asset) {
    return assetHasAudio(asset);
  }

  // If clip has explicit audio properties, assume it has audio
  return Boolean(clip.audio || clip.volume !== undefined);
}
