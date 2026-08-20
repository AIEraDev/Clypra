/**
 * Z-Index Calculator
 *
 * Implements the canonical visual stacking contract for NLE layer ordering.
 *
 * Contract:
 * 1. Lower trackIndex (top in timeline UI) renders LAST → appears ON TOP
 * 2. Within same track, renderOrder (evaluator array index) determines order
 * 3. z-index formula: (maxTrackIndex - trackIndex) * SPACING + renderOrder
 *
 * This ensures:
 * - Track 0 (timeline top) always occludes all other tracks
 * - Overlapping clips on same track follow evaluator sort order
 * - No z-index collisions even with many tracks or clips
 */

import type { EvaluatedMediaLayer } from "../../evaluation/types";

/**
 * Spacing multiplier for intra-track ordering.
 * Must be large enough to accommodate max clips per track.
 */
export const INTRA_TRACK_SPACING = 1_000_000;

/**
 * Calculate the maximum trackIndex from a set of visual media layers.
 * Used as the base for z-index inversion calculations.
 *
 * @param layers - Visual media layers (video/image only)
 * @returns Maximum trackIndex, or 0 if no layers
 */
export function calculateMaxTrackIndex(layers: EvaluatedMediaLayer[]): number {
  if (layers.length === 0) return 0;

  const trackIndices = [...new Set(layers.map((layer) => layer.trackIndex ?? 0))].sort((a, b) => a - b);

  return trackIndices.length > 0 ? trackIndices[trackIndices.length - 1] : 0;
}

/**
 * Calculate z-index for a layer based on track ordering and render order.
 *
 * Timeline convention: lower-numbered tracks are visually higher (top in UI)
 * Native convention: higher zIndex renders later / on top
 * Therefore: sprite.zIndex = (maxTrackIndex - trackIndex) * SPACING + renderOrder
 *
 * @param trackIndex - Track index of the layer (0 = top track)
 * @param maxTrackIndex - Maximum track index in the scene
 * @param renderOrder - Layer's position in the evaluator array (for intra-track ordering)
 * @returns Calculated z-index value
 *
 * @example
 * // 3 tracks (0, 1, 2), first clip on each track
 * calculateLayerZIndex(0, 2, 0) // = 2,000,000 (top track, renders last)
 * calculateLayerZIndex(1, 2, 1) // = 1,000,001 (middle track)
 * calculateLayerZIndex(2, 2, 2) // = 2 (bottom track, renders first)
 */
export function calculateLayerZIndex(trackIndex: number, maxTrackIndex: number, renderOrder: number): number {
  return (maxTrackIndex - trackIndex) * INTRA_TRACK_SPACING + renderOrder;
}

/**
 * Extract visual media layers (video/image) from a scene's visual layers.
 * Used for computing max track index.
 *
 * @param visualLayers - All visual layers from evaluated scene
 * @returns Filtered array of media layers (video/image only)
 */
export function extractVisualMediaLayers(visualLayers: readonly any[]): EvaluatedMediaLayer[] {
  return visualLayers.filter((layer) => layer.layerType === "media" && (layer.mediaType === "video" || layer.mediaType === "image")) as EvaluatedMediaLayer[];
}
