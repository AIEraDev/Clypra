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
    // Raised cadence caps at every tier.
    // Old caps (10/20/24/30) imposed a hard 30fps ceiling even on top-tier macOS
    // hardware where Metal-backed IPC readbacks are fast enough for 60fps.
    // The adaptive recordReadback() mechanism degrades tiers automatically if the
    // hardware cannot sustain the target cadence, so raising the ceiling is safe.
    if (this.tier === 0) return 15; // was 10
    if (this.tier === 1) return 24; // was 20 (Windows default tier)
    if (this.tier <= 3) return 30; // was 24
    return 60; // was 30 (macOS top-tier default)
  }

  /**
   * A playback-rate change must not multiply CPU RGBA work. The presentation
   * cadence stays in wall-clock FPS; the caller presents the newest timeline
   * frame available at each deadline and intentionally skips obsolete source
   * frames. This keeps audio continuous and prevents a decode queue from
   * forming at 1.5x/2x.
   */
  presentationAt(
    speed: number,
    sourceFps: number,
  ): {
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
    // Intervals derived from the updated targetCadenceFps values.
    // Each tier's dispatch window matches its cadence so canDispatchPlayback()
    // and targetCadenceFps stay in sync. Audio remains the clock authority.
    const intervalMs =
      this.tier === 0
        ? 1000 / 15 // ~67ms  (was 100ms / 10fps)
        : this.tier === 1
          ? 1000 / 24 // ~42ms  (was  50ms / 20fps)
          : this.tier <= 3
            ? 1000 / 30 // ~33ms  (was 1000/24 / 24fps)
            : 1000 / 60; // ~17ms  (was 1000/30 / 30fps)
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
      // Reduced recovery threshold from 90 to 30 fast samples.
      // The old value (90 samples at < 9ms each) required ~3 s of sustained fast
      // readbacks to climb one tier — an asymmetric ratchet where 3 slow frames
      // caused instant degradation but recovery took orders of magnitude longer.
      // 30 samples (~500 ms at 60fps) is still conservative enough to avoid
      // oscillation on borderline hardware while letting the policy recover
      // within a reasonable time after a brief burst of IPC congestion.
      if (
        this.fastSamples >= 30 &&
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
