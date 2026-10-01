/**
 * Rational Time Representation
 *
 * Conforms to OpenTimelineIO (opentime.RationalTime) standard.
 * Implements frame-accurate, drift-free rational time arithmetic (value = frames, rate = timebase).
 */

export class RationalTime {
  public readonly value: number;
  public readonly rate: number;

  constructor(value: number, rate: number) {
    this.value = Number.isFinite(value) ? value : 0;
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 30;
  }

  /**
   * Resolves the rational time to seconds in floating point.
   */
  toSeconds(): number {
    return this.rate > 0 ? this.value / this.rate : 0;
  }

  /**
   * Resolves total integer frames at a given nominal frame rate (or this.rate).
   */
  toFrames(nominalRate?: number): number {
    if (nominalRate !== undefined && nominalRate !== this.rate) {
      return Math.round(this.toSeconds() * nominalRate);
    }
    return Math.round(this.value);
  }

  /**
   * Converts this time to a new rational rate with exact frame rounding.
   */
  rescaledTo(newRate: number): RationalTime {
    if (newRate === this.rate) return this;
    const newFrames = Math.round((this.value * newRate) / this.rate);
    return new RationalTime(newFrames, newRate);
  }

  add(other: RationalTime): RationalTime {
    const rescaledOther = other.rescaledTo(this.rate);
    return new RationalTime(this.value + rescaledOther.value, this.rate);
  }

  subtract(other: RationalTime): RationalTime {
    const rescaledOther = other.rescaledTo(this.rate);
    return new RationalTime(this.value - rescaledOther.value, this.rate);
  }

  compare(other: RationalTime): -1 | 0 | 1 {
    const diff = this.toSeconds() - other.toSeconds();
    if (diff < -1e-6) return -1;
    if (diff > 1e-6) return 1;
    return 0;
  }

  equals(other: RationalTime): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Construct from seconds and nominal frame rate.
   */
  static fromSeconds(seconds: number, rate = 30): RationalTime {
    if (!Number.isFinite(seconds) || isNaN(seconds)) {
      seconds = 0;
    }
    const [num, den] = getExactRateFraction(rate);
    const frames = Math.round((seconds * num) / den);
    return new RationalTime(frames, rate);
  }

  /**
   * Construct directly from frame count and nominal rate.
   */
  static fromFrames(frames: number, rate = 30): RationalTime {
    return new RationalTime(Math.round(frames), rate);
  }
}

/**
 * Returns exact SMPTE numerator and denominator for standard broadcast/cinema rates.
 */
export function getExactRateFraction(frameRate: number): [number, number] {
  if (Number.isInteger(frameRate)) {
    return [frameRate > 0 ? frameRate : 30, 1];
  }
  if (Math.abs(frameRate - 23.976) < 0.01 || Math.abs(frameRate - 23.98) < 0.01) {
    return [24000, 1001];
  }
  if (Math.abs(frameRate - 29.97) < 0.01) {
    return [30000, 1001];
  }
  if (Math.abs(frameRate - 59.94) < 0.01) {
    return [60000, 1001];
  }
  if (Math.abs(frameRate - 119.88) < 0.01) {
    return [120000, 1001];
  }
  const rounded = Math.round(frameRate);
  return [rounded > 0 ? rounded : 30, 1];
}
