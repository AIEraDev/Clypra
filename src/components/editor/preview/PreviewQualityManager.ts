/**
 * Preview Quality Manager
 *
 * Prevents 4K × DPR VRAM explosion by capping preview render resolution
 * based on interaction state. Separates:
 *   - Sequence resolution (authoring space, e.g. 1920×1080)
 *   - Render resolution (quality tier)
 *   - Display resolution (viewport size)
 *   - Device pixel ratio (retina scaling)
 *
 * Usage:
 *   const manager = new PreviewQualityManager({
 *     sequenceWidth: 1920, sequenceHeight: 1080,
 *     viewportWidth: 800, viewportHeight: 450, dpr: 2,
 *   });
 *   const profile = manager.getRenderProfile(PreviewQualityTier.Playback);
 *   // profile.maxWidth = capped at viewport × DPR, never exceeds sequence
 */

export enum PreviewQualityTier {
  /** PlaybackHigh: 75% res, no DPR */
  PlaybackHigh = "playback_high",
  /** Playback: half res, no DPR — prioritizes frame rate */
  Playback = "playback",
  /** Interaction: quarter res, prioritizes latency */
  Interaction = "interaction",
  /** Idle: full res, capped at viewport × DPR */
  Idle = "idle",
  /** Export: full res, no caps */
  Export = "export",
}

export interface PreviewRenderProfile {
  /** Maximum render width in pixels */
  maxWidth: number;
  /** Maximum render height in pixels */
  maxHeight: number;
  /** DPR multiplier applied to render resolution */
  dprScale: number;
  /** True if this tier uses DPR scaling */
  useDpr: boolean;
  /** Estimated VRAM per frame (bytes) */
  estimatedVRAMBytes: number;
}

interface PreviewQualityManagerOptions {
  sequenceWidth: number;
  sequenceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
}

export class PreviewQualityManager {
  private sequenceWidth: number;
  private sequenceHeight: number;
  private viewportWidth: number;
  private viewportHeight: number;
  private dpr: number;

  constructor(options: PreviewQualityManagerOptions) {
    this.sequenceWidth = options.sequenceWidth;
    this.sequenceHeight = options.sequenceHeight;
    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.dpr = options.dpr;
  }

  /**
   * Update viewport dimensions (e.g. on resize).
   * Does NOT change sequence dimensions.
   */
  updateViewport(viewportWidth: number, viewportHeight: number, dpr?: number): void {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    if (dpr !== undefined) this.dpr = dpr;
  }

  /**
   * Get render profile for a quality tier.
   * All profiles are capped at viewport × DPR to prevent VRAM explosion,
   * except Export which is capped at sequence resolution only.
   */
  getRenderProfile(tier: PreviewQualityTier): PreviewRenderProfile {
    const viewportMaxWidth = this.viewportWidth * this.dpr;
    const viewportMaxHeight = this.viewportHeight * this.dpr;

    switch (tier) {
      case PreviewQualityTier.PlaybackHigh: {
        // 75% resolution, NO DPR
        const scale = Math.min(0.75, this.viewportWidth / this.sequenceWidth, this.viewportHeight / this.sequenceHeight);
        const w = this.sequenceWidth * scale;
        const h = this.sequenceHeight * scale;
        return {
          maxWidth: Math.floor(w),
          maxHeight: Math.floor(h),
          dprScale: 1.0,
          useDpr: false,
          estimatedVRAMBytes: w * h * 4,
        };
      }

      case PreviewQualityTier.Playback: {
        // Half resolution, NO DPR — frame rate over fidelity
        const scale = Math.min(0.5, this.viewportWidth / this.sequenceWidth, this.viewportHeight / this.sequenceHeight);
        const w = this.sequenceWidth * scale;
        const h = this.sequenceHeight * scale;
        return {
          maxWidth: Math.floor(w),
          maxHeight: Math.floor(h),
          dprScale: 1.0,
          useDpr: false,
          estimatedVRAMBytes: w * h * 4,
        };
      }

      case PreviewQualityTier.Interaction: {
        // Quarter resolution, prioritizes latency
        const scale = Math.min(0.25, (this.viewportWidth * 0.5) / this.sequenceWidth, (this.viewportHeight * 0.5) / this.sequenceHeight);
        const w = this.sequenceWidth * scale;
        const h = this.sequenceHeight * scale;
        return {
          maxWidth: Math.floor(w),
          maxHeight: Math.floor(h),
          dprScale: 1.0,
          useDpr: false,
          estimatedVRAMBytes: w * h * 4,
        };
      }

      case PreviewQualityTier.Idle: {
        // Full resolution, capped at viewport × DPR, preserving aspect ratio
        const scale = Math.min(1.0, viewportMaxWidth / this.sequenceWidth, viewportMaxHeight / this.sequenceHeight);
        const w = this.sequenceWidth * scale;
        const h = this.sequenceHeight * scale;
        return {
          maxWidth: Math.floor(w),
          maxHeight: Math.floor(h),
          dprScale: this.dpr,
          useDpr: true,
          estimatedVRAMBytes: w * h * 4,
        };
      }

      case PreviewQualityTier.Export: {
        // Full resolution, no viewport cap — used for final render
        return {
          maxWidth: this.sequenceWidth,
          maxHeight: this.sequenceHeight,
          dprScale: 1.0,
          useDpr: false,
          estimatedVRAMBytes: this.sequenceWidth * this.sequenceHeight * 4,
        };
      }
    }
  }

  /**
   * Select quality tier based on interaction state.
   *   - Playback → Playback (half res)
   *   - Scrubbing/Scrolling → Interaction (quarter res)
   *   - Idle → Idle (full res, viewport-capped)
   *   - Export mode → Export (full res, no cap)
   */
  selectTierForInteraction(
    isPlaying: boolean,
    isInteracting: boolean,
    isExporting: boolean = false,
    playbackQuality: "full" | "high" | "medium" | "low" = "high"
  ): PreviewQualityTier {
    if (isExporting) return PreviewQualityTier.Export;
    if (isPlaying) {
      if (playbackQuality === "full") return PreviewQualityTier.Idle;
      if (playbackQuality === "high") return PreviewQualityTier.PlaybackHigh;
      if (playbackQuality === "medium") return PreviewQualityTier.Playback;
      if (playbackQuality === "low") return PreviewQualityTier.Interaction;
      return PreviewQualityTier.PlaybackHigh;
    }
    if (isInteracting) return PreviewQualityTier.Interaction;
    return PreviewQualityTier.Idle;
  }

  /**
   * Get the maximum safe render dimensions given current viewport and DPR.
   * This is the "never exceed" boundary to prevent VRAM exhaustion.
   */
  getSafeMaxDimensions(): { width: number; height: number } {
    const profile = this.getRenderProfile(PreviewQualityTier.Idle);
    return { width: profile.maxWidth, height: profile.maxHeight };
  }
}
