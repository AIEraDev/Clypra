/**
 * Keeps the CPU RGBA fallback within a bounded latency budget.
 *
 * WebViews cannot portably import VideoToolbox/Metal, D3D, or DMA-BUF textures
 * directly. When the embedded canvas is the presentation target we therefore
 * prefer a fresh lower-resolution frame over a queue of full-resolution stale
 * frames. This policy is deliberately local to the presentation path: export
 * and native-surface quality are never affected.
 */
export class AdaptiveReadbackPolicy {
  private static readonly DIMENSIONS = [480, 600, 720, 840, 960] as const;
  private tier: number;
  private slowSamples = 0;
  private fastSamples = 0;
  private nextPlaybackDispatchAt = 0;

  constructor(maxDimension: number) {
    this.tier = AdaptiveReadbackPolicy.closestTier(maxDimension);
  }

  get maxDimension(): number {
    return AdaptiveReadbackPolicy.DIMENSIONS[this.tier];
  }

  cap<T extends { width: number; height: number }>(target: T): T {
    const largest = Math.max(target.width, target.height);
    if (largest <= this.maxDimension) return target;
    const scale = this.maxDimension / largest;
    return {
      ...target,
      width: Math.max(1, Math.floor(target.width * scale)),
      height: Math.max(1, Math.floor(target.height * scale)),
    };
  }

  canDispatchPlayback(now = performance.now()): boolean {
    return now >= this.nextPlaybackDispatchAt;
  }

  markPlaybackDispatch(now = performance.now()): void {
    // A CPU readback must not try to chase a 60fps source. The tier controls
    // both bytes per frame and cadence; audio remains the clock authority.
    const intervalMs = this.tier <= 1 ? 50 : this.tier === 2 ? 1000 / 24 : 1000 / 30;
    this.nextPlaybackDispatchAt = now + intervalMs;
  }

  recordReadback(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;

    if (elapsedMs > 16) {
      this.slowSamples += 1;
      this.fastSamples = 0;
      if (this.slowSamples >= 3 && this.tier > 0) {
        this.tier -= 1;
        this.slowSamples = 0;
      }
      return;
    }

    if (elapsedMs < 9) {
      this.fastSamples += 1;
      this.slowSamples = 0;
      // Recover conservatively so a brief fast patch does not make preview
      // oscillate between resolutions.
      if (this.fastSamples >= 90 && this.tier < AdaptiveReadbackPolicy.DIMENSIONS.length - 1) {
        this.tier += 1;
        this.fastSamples = 0;
      }
      return;
    }

    this.slowSamples = 0;
    this.fastSamples = 0;
  }

  private static closestTier(maxDimension: number): number {
    let index = 0;
    for (let candidate = 0; candidate < this.DIMENSIONS.length; candidate += 1) {
      if (this.DIMENSIONS[candidate] <= maxDimension) index = candidate;
    }
    return index;
  }
}
