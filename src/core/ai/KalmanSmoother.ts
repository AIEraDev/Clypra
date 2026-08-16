/**
 * 1D Kalman filter for smoothing MediaPipe bounding-box coordinates.
 *
 * Interpolates sparse inference results (10–15 FPS) to 60 FPS render cadence.
 * Each BoundingBox coordinate (x, y, width, height) is tracked by its own
 * independent 1D Kalman state.
 *
 * Usage:
 *   const smoother = new BoundingBoxKalmanSmoother();
 *
 *   // Called once per inference result (10–15 FPS)
 *   smoother.update({ x, y, width, height });
 *
 *   // Called every animation frame (60 FPS)
 *   const smooth = smoother.predict();
 */

interface KalmanState {
  /** Current state estimate */
  x: number;
  /** Estimate error covariance */
  p: number;
}

interface KalmanConfig {
  /** Process noise — how fast the true value can change. Higher = more responsive. */
  processNoise: number;
  /** Measurement noise — how noisy the raw measurement is. Higher = more smoothing. */
  measurementNoise: number;
}

const DEFAULT_CONFIG: KalmanConfig = {
  // Tuned for face bounding boxes in normalised [0, 1] space
  processNoise: 1e-4,
  measurementNoise: 1e-2,
};

class Kalman1D {
  private state: KalmanState;
  private cfg: KalmanConfig;

  constructor(initialValue: number, cfg = DEFAULT_CONFIG) {
    this.state = { x: initialValue, p: 1.0 };
    this.cfg = cfg;
  }

  /** Update with a new measurement and return the filtered estimate. */
  update(measurement: number): number {
    // Predict
    const pPred = this.state.p + this.cfg.processNoise;

    // Kalman gain
    const k = pPred / (pPred + this.cfg.measurementNoise);

    // Update
    this.state.x = this.state.x + k * (measurement - this.state.x);
    this.state.p = (1 - k) * pPred;

    return this.state.x;
  }

  /** Return current estimate without incorporating a new measurement. */
  get value(): number {
    return this.state.x;
  }
}

export interface SmoothedBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Four-channel Kalman smoother for a normalised bounding box.
 * Each spatial coordinate has its own independent filter.
 */
export class BoundingBoxKalmanSmoother {
  private filters: Record<keyof SmoothedBoundingBox, Kalman1D> | null = null;
  private cfg: KalmanConfig;

  constructor(cfg: Partial<KalmanConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
  }

  /**
   * Feed a new inference detection into all four filters.
   * Call at the inference cadence (10–15 FPS).
   */
  update(box: SmoothedBoundingBox): SmoothedBoundingBox {
    if (!this.filters) {
      // Initialise filters on first measurement
      this.filters = {
        x: new Kalman1D(box.x, this.cfg),
        y: new Kalman1D(box.y, this.cfg),
        width: new Kalman1D(box.width, this.cfg),
        height: new Kalman1D(box.height, this.cfg),
      };
    }

    return {
      x: this.filters.x.update(box.x),
      y: this.filters.y.update(box.y),
      width: this.filters.width.update(box.width),
      height: this.filters.height.update(box.height),
    };
  }

  /**
   * Return the current smoothed estimate without a new measurement.
   * Call at 60 FPS between inference updates to get interpolated values.
   * Returns `null` if no measurement has been received yet.
   */
  get current(): SmoothedBoundingBox | null {
    if (!this.filters) return null;
    return {
      x: this.filters.x.value,
      y: this.filters.y.value,
      width: this.filters.width.value,
      height: this.filters.height.value,
    };
  }

  /** Reset all filter state (e.g., when the user scrubs to a new position). */
  reset(): void {
    this.filters = null;
  }
}
