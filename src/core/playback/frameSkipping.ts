/**
 * Frame Skipping Strategy
 *
 * Dynamically adjusts frame rendering frequency based on playback speed
 * to maintain smooth playback at high speeds (2x, 4x, etc.).
 *
 * Key principles:
 * - At 1x speed: Render every frame (target 30/60fps)
 * - At 2x speed: Render every 2nd frame (maintain 30fps visual)
 * - At 4x speed: Render every 4th frame (maintain 30fps visual)
 * - Audio continues at full speed (no skipping)
 *
 * This prevents frame scheduler queue backlog and dropped frames.
 */

export interface FrameSkipConfig {
  /** Playback speed multiplier (1.0 = normal, 2.0 = double speed, etc.) */
  speed: number;

  /** Target render FPS (default: 30fps for smooth preview) */
  targetFps?: number;

  /** Project frame rate (default: 30fps) */
  projectFps?: number;

  /** Enable frame skipping (default: true) */
  enabled?: boolean;
}

export interface FrameSkipResult {
  /** Whether to render this frame */
  shouldRender: boolean;

  /** Frame skip interval (1 = render every frame, 2 = every other, etc.) */
  skipInterval: number;

  /** Expected render FPS at current speed */
  expectedFps: number;

  /** Frame budget in ms (for scheduler timeout) */
  frameBudgetMs: number;
}

/**
 * Calculate frame skipping strategy for current playback speed.
 *
 * @param currentTime - Current playback time in seconds
 * @param config - Frame skip configuration
 * @returns Frame skip decision
 */
export function calculateFrameSkip(currentTime: number, config: FrameSkipConfig): FrameSkipResult {
  const { speed, targetFps = 30, projectFps = 30, enabled = true } = config;

  // Disabled or normal speed: render every frame
  if (!enabled || speed <= 1.0) {
    return {
      shouldRender: true,
      skipInterval: 1,
      expectedFps: projectFps,
      frameBudgetMs: 1000 / projectFps,
    };
  }

  // Calculate skip interval to maintain target FPS
  // Example: At 2x speed with 30fps target, skip every 2nd frame
  const skipInterval = Math.max(1, Math.floor(speed));

  // Calculate which frame number we're on
  const frameNumber = Math.floor(currentTime * projectFps);

  // Render only on interval frames
  const shouldRender = frameNumber % skipInterval === 0;

  // Calculate expected visual FPS
  const expectedFps = Math.min(projectFps / speed, targetFps);

  // Frame budget is inversely proportional to expected FPS
  const frameBudgetMs = 1000 / expectedFps;

  return {
    shouldRender,
    skipInterval,
    expectedFps,
    frameBudgetMs,
  };
}

/**
 * Frame skip controller for managing skip state across playback session.
 * Provides stateful interface for frame skipping decisions.
 */
export class FrameSkipController {
  private lastRenderedFrame = -1;
  private config: Required<FrameSkipConfig>;
  private stats = {
    totalFrames: 0,
    renderedFrames: 0,
    skippedFrames: 0,
  };

  constructor(config: Partial<FrameSkipConfig> = {}) {
    this.config = {
      speed: config.speed ?? 1.0,
      targetFps: config.targetFps ?? 30,
      projectFps: config.projectFps ?? 30,
      enabled: config.enabled ?? true,
    };
  }

  /**
   * Update playback speed.
   */
  setSpeed(speed: number): void {
    this.config.speed = speed;
  }

  /**
   * Update project frame rate.
   */
  setProjectFps(fps: number): void {
    this.config.projectFps = fps;
  }

  /**
   * Enable or disable frame skipping.
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if current frame should be rendered.
   *
   * @param currentTime - Current playback time in seconds
   * @returns Frame skip result
   */
  shouldRenderFrame(currentTime: number): FrameSkipResult {
    const result = calculateFrameSkip(currentTime, this.config);

    this.stats.totalFrames++;
    if (result.shouldRender) {
      this.stats.renderedFrames++;
      this.lastRenderedFrame = Math.floor(currentTime * this.config.projectFps);
    } else {
      this.stats.skippedFrames++;
    }

    return result;
  }

  /**
   * Get frame skip statistics.
   */
  getStats() {
    const skipRate = this.stats.totalFrames > 0 ? this.stats.skippedFrames / this.stats.totalFrames : 0;

    return {
      ...this.stats,
      skipRate,
      lastRenderedFrame: this.lastRenderedFrame,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats(): void {
    this.stats = {
      totalFrames: 0,
      renderedFrames: 0,
      skippedFrames: 0,
    };
    this.lastRenderedFrame = -1;
  }
}

/**
 * Calculate optimal frame skip interval for target FPS at given speed.
 *
 * Examples:
 * - 1x speed, 30fps target → skip 1 (render all)
 * - 2x speed, 30fps target → skip 2 (render every 2nd)
 * - 4x speed, 30fps target → skip 4 (render every 4th)
 * - 8x speed, 30fps target → skip 8 (render every 8th)
 */
export function calculateOptimalSkipInterval(speed: number, targetFps: number = 30, projectFps: number = 30): number {
  if (speed <= 1.0) return 1;

  // At higher speeds, we want to maintain visual smoothness
  // by rendering just enough frames to hit target FPS
  const effectiveFps = projectFps * speed;
  const skipInterval = Math.max(1, Math.floor(effectiveFps / targetFps));

  return skipInterval;
}

/**
 * Estimate frame budget based on skip strategy.
 * Returns recommended maximum time to spend rendering each frame.
 */
export function estimateFrameBudget(skipInterval: number, targetFps: number = 30): number {
  // Frame budget = time available per target frame
  const frameBudgetMs = 1000 / targetFps;

  // With skipping, we have more time per rendered frame
  return frameBudgetMs * skipInterval;
}
