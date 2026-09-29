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
  private static readonly DIMENSIONS = [320, 480, 600, 720, 840, 960] as const;
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

  get currentTier(): number {
    return this.tier;
  }

  get targetCadenceFps(): number {
    if (this.tier === 0) return 10;
    if (this.tier === 1) return 20;
    if (this.tier <= 3) return 24;
    return 30;
  }

  /**
   * A playback-rate change must not multiply CPU RGBA work. The presentation
   * cadence stays in wall-clock FPS; the caller presents the newest timeline
   * frame available at each deadline and intentionally skips obsolete source
   * frames. This keeps audio continuous and prevents a decode queue from
   * forming at 1.5x/2x.
   */
  presentationAt(speed: number, sourceFps: number): {
    cadenceFps: number;
    sourceFramesPerPresentation: number;
  } {
    const safeSpeed = Number.isFinite(speed)
      ? Math.max(0.1, Math.min(4, speed))
      : 1;
    const safeSourceFps = Number.isFinite(sourceFps)
      ? Math.max(1, sourceFps)
      : 30;
    return {
      cadenceFps: this.targetCadenceFps,
      sourceFramesPerPresentation: Math.max(
        1,
        Math.ceil((safeSpeed * safeSourceFps) / this.targetCadenceFps),
      ),
    };
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
    const intervalMs =
      this.tier === 0
        ? 100
        : this.tier === 1
          ? 50
          : this.tier <= 3
            ? 1000 / 24
            : 1000 / 30;
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
      if (
        this.fastSamples >= 90 &&
        this.tier < AdaptiveReadbackPolicy.DIMENSIONS.length - 1
      ) {
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
    for (
      let candidate = 0;
      candidate < this.DIMENSIONS.length;
      candidate += 1
    ) {
      if (this.DIMENSIONS[candidate] <= maxDimension) index = candidate;
    }
    return index;
  }
}

/**
 * The embedded Windows WebView bridge serializes each RGBA payload through
 * the UI-process boundary. It is not a shared D3D texture import, so driving
 * it at the same 960px/30fps policy as Metal-backed macOS makes even powerful
 * Windows GPUs wait behind CPU copy and WebView paint work. Start at a
 * bounded 480px/20fps visual proxy there; the native audio clock still runs
 * at full precision and adaptive policy can reduce further under pressure.
 */
export function defaultEmbeddedReadbackLimit(): number {
  if (typeof navigator === "undefined") return 960;
  if (/windows/i.test(navigator.userAgent)) return 480;
  return typeof navigator.hardwareConcurrency === "number" &&
    navigator.hardwareConcurrency <= 4
    ? 720
    : 960;
}
