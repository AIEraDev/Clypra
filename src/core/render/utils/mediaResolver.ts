/**
 * Media Resolver
 *
 * Utilities for resolving media sources (video elements, image resources)
 * from evaluated layers.
 */

import type { EvaluatedMediaLayer } from "../../evaluation/types";
import { getResourceCache } from "../../resources/ResourceCache";

export type VideoFrameSource = HTMLVideoElement | HTMLCanvasElement;

/**
 * Resolve video element for a media layer.
 *
 * @param mediaLayer - Evaluated media layer
 * @param videoElements - Map of clip/media ID to video elements
 * @returns Video element if found, null otherwise
 */
export function resolveVideoElement(mediaLayer: EvaluatedMediaLayer, videoElements: Map<string, VideoFrameSource>): VideoFrameSource | null {
  const key = `${mediaLayer.clipId}-${mediaLayer.mediaId}`;
  const element = videoElements.get(key);

  if (!element && import.meta.env.DEV) {
    console.warn(`[MediaResolver] Missing video element for clip "${mediaLayer.clipId}" (key: ${key})`);
  }

  return element ?? null;
}

/**
 * Resolve image resource for a media layer.
 *
 * @param mediaLayer - Evaluated media layer
 * @param resourceHandleMap - Optional map of layer IDs to resource handles
 * @returns ImageBitmap if found, null otherwise
 */
export function resolveImageResource(mediaLayer: EvaluatedMediaLayer, resourceHandleMap?: Map<string, any>): ImageBitmap | null {
  const resolvedHandle = resourceHandleMap?.get(mediaLayer.layerId) ?? mediaLayer.resourceHandle;

  if (!resolvedHandle) {
    return null;
  }

  const resource = getResourceCache().get(resolvedHandle);

  if (resource && resource.data instanceof ImageBitmap) {
    return resource.data;
  }

  return null;
}

/**
 * Resolve source element (video or image) for a media layer.
 *
 * @param mediaLayer - Evaluated media layer
 * @param videoElements - Map of clip/media ID to video elements
 * @param resourceHandleMap - Optional map of layer IDs to resource handles
 * @returns Source element (HTMLVideoElement | ImageBitmap) or null
 */
export function resolveMediaSource(mediaLayer: EvaluatedMediaLayer, videoElements: Map<string, VideoFrameSource>, resourceHandleMap?: Map<string, any>): VideoFrameSource | ImageBitmap | null {
  if (mediaLayer.mediaType === "video") {
    return resolveVideoElement(mediaLayer, videoElements);
  } else {
    return resolveImageResource(mediaLayer, resourceHandleMap);
  }
}
