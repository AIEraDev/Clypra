/**
 * useFilmstrip — Pure projection hook
 *
 * NO STATE. NO TRANSPORT. NO BITMAP OWNERSHIP.
 * Just subscribes to RenderEngine and requests filmstrip on mount/change.
 *
 * Architecture:
 *   RenderEngine → FilmstripCache → RenderState.visibleArtifacts
 *                                  ↓
 *                            useFilmstrip (projection)
 *
 * Ownership:
 *   - RenderEngine owns all state and bitmaps
 *   - This hook BORROWS artifacts (read-only)
 *   - React rerenders only when RenderState changes
 */

import { useEffect } from "react";
import { useRenderRuntime } from "../../hooks/useRenderRuntime";
import { useRenderState } from "../renderEngine/hooks";
import { SpatialTier, InteractionState, type RenderEpochId } from "../renderEngine/types";
import type { TransportArtifact } from "../renderEngine/transport";

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseFilmstripOptions {
  clipId: string;
  videoPath: string;
  trimIn: number;
  trimOut: number;
  duration: number;
  clipStartTime: number;
  clipWidthPx: number;
  viewportScrollLeft: number;
  viewportWidth: number;
  pixelsPerSecond: number;
  enabled?: boolean;
}

export interface UseFilmstripResult {
  /** Sorted TransportArtifacts ready to pass to RasterSurface.drawFilmstrip() */
  artifacts: readonly TransportArtifact[];
  /** True while the first batch is loading */
  isLoading: boolean;
  /** True before the first valid filmstrip projection; transition UI stays neutral. */
  isFallback: boolean;
  /** Current interaction state — surface can dim during ballistic scroll */
  interactionState: InteractionState;
  /** SRP-selected tier used for UI-only layout decisions. */
  spatialTier: SpatialTier;
  /** Epoch that produced the current artifact projection. */
  epochId: RenderEpochId;
}

/**
 * useFilmstrip — Pure projection hook
 *
 * Subscribes to RenderEngine filmstrip state.
 * NO bitmap ownership - RenderEngine owns all bitmaps.
 */
export function useFilmstrip(opts: UseFilmstripOptions): UseFilmstripResult {
  const { clipId, enabled = true } = opts;

  const runtime = useRenderRuntime();
  const renderState = useRenderState(clipId);

  // Request filmstrip when options change
  useEffect(() => {
    if (!runtime || !enabled || !opts.videoPath || !opts.duration) return;

    runtime.requestFilmstrip({
      clipId: opts.clipId,
      videoPath: opts.videoPath,
      trimIn: opts.trimIn,
      trimOut: opts.trimOut,
      duration: opts.duration,
      clipStartTime: opts.clipStartTime,
      clipWidthPx: opts.clipWidthPx,
      viewportScrollLeft: opts.viewportScrollLeft,
      viewportWidth: opts.viewportWidth,
      pixelsPerSecond: opts.pixelsPerSecond,
    });
  }, [
    runtime,
    enabled,
    opts.clipId,
    opts.videoPath,
    opts.trimIn,
    opts.trimOut,
    opts.duration,
    opts.clipStartTime,
    opts.clipWidthPx,
    opts.viewportScrollLeft,
    opts.viewportWidth,
    opts.pixelsPerSecond,
    renderState.epochId, // Re-request on epoch change
  ]);

  // Keep active viewport requests transactional, then warm a bounded
  // neighborhood only after the interaction has settled.
  useEffect(() => {
    if (!runtime || !enabled || !opts.videoPath || !opts.duration || !runtime.prefetchFilmstrip) return;

    const timeoutId = setTimeout(() => {
      runtime.prefetchFilmstrip({
        clipId: opts.clipId,
        videoPath: opts.videoPath,
        trimIn: opts.trimIn,
        trimOut: opts.trimOut,
        duration: opts.duration,
        clipStartTime: opts.clipStartTime,
        clipWidthPx: opts.clipWidthPx,
        viewportScrollLeft: opts.viewportScrollLeft,
        viewportWidth: opts.viewportWidth,
        pixelsPerSecond: opts.pixelsPerSecond,
      });
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [
    runtime,
    enabled,
    opts.clipId,
    opts.videoPath,
    opts.trimIn,
    opts.trimOut,
    opts.duration,
    opts.clipStartTime,
    opts.clipWidthPx,
    opts.viewportScrollLeft,
    opts.viewportWidth,
    opts.pixelsPerSecond,
    renderState.epochId,
  ]);

  // Trigger asset-wide bounded coarse preload on timeline mount so horizontal scrolling hits cache 100% of the time.
  useEffect(() => {
    if (!runtime || !enabled || !opts.videoPath || !opts.duration) return;
    runtime.preloadAssetCoarseBaseline({
      videoPath: opts.videoPath,
      duration: opts.duration,
    });
  }, [runtime, enabled, opts.videoPath, opts.duration]);

  // Return immutable projection
  return {
    artifacts: renderState.visibleArtifacts as readonly TransportArtifact[],
    isLoading: renderState.visibleArtifacts.length === 0 && !renderState.isFallback,
    isFallback: renderState.isFallback,
    interactionState: renderState.interactionState,
    spatialTier: renderState.currentTier.spatialTier,
    epochId: renderState.epochId,
  };
}
