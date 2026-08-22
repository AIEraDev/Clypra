import { getAnchoredZoomScrollLeft } from "@/lib/timeline/timelineViewport";
import { clampTimelinePixelsPerSecond } from "@/lib/timeline/timelineZoom";
import { useTimelineStore } from "@/store/timelineStore";

/**
 * Per-frame exponential decay constant — controls how quickly currentPps chases targetPps.
 * k = 0.22 → ~120ms to within 1% of target at 60fps. Matches Final Cut Pro feel.
 * Increase for snappier (Premiere-like, k≈0.3) or decrease for floatier (DaVinci-like, k≈0.14).
 */
const SPRING_K = 0.22;
/** Stop the spring animation when the gap is smaller than this (pps). */
const SETTLE_THRESHOLD_PPS = 0.08;
/**
 * Friction multiplier applied to inertia velocity each frame.
 * 0.88 → ~50% speed after 6 frames (≈100ms deceleration).
 */
const INERTIA_FRICTION = 0.88;
/** Minimum fractional velocity (per frame) below which inertia stops. */
const INERTIA_MIN_VELOCITY = 0.0008;

export interface ZoomAnchor {
  /** Timeline time (seconds) that must stay under the cursor/anchor point. */
  anchorTime: number;
  /** Pixel offset of the anchor from the left edge of the tracks lane. */
  localTimelineX: number;
  /** container.clientWidth at the time the anchor was captured. */
  containerWidth: number;
  /** Total scrollable duration in seconds. */
  viewportEndSeconds: number;
  hasClips: boolean;
}

type SpringMode = "spring" | "inertia" | "idle";

/**
 * Drives timeline zoom smoothly.
 *
 * Usage:
 *   const spring = new TimelineZoomSpring(container);
 *   spring.setTarget(nextPps, anchor);   // from wheel handler
 *   spring.startInertia(vel, anchor);    // from touchend handler
 *   spring.dispose();                    // on effect cleanup
 */
export class TimelineZoomSpring {
  private container: HTMLDivElement;
  private currentPps: number;
  private targetPps: number;
  private anchor: ZoomAnchor | null = null;
  private rafId: number | null = null;
  private mode: SpringMode = "idle";
  private inertiaVelocity = 0;

  constructor(container: HTMLDivElement) {
    this.container = container;
    this.currentPps = useTimelineStore.getState().pixelsPerSecond;
    this.targetPps = this.currentPps;
  }

  /** Current animated PPS (use this as the base when computing the next target). */
  getCurrentPps(): number {
    return this.currentPps;
  }

  /**
   * Set a new target PPS and (re)start the spring animation.
   * Safe to call on every wheel event — will smoothly redirect in-flight animations.
   */
  setTarget(targetPps: number, anchor: ZoomAnchor): void {
    // Sync from store when starting from rest so we animate from the actual current position.
    if (this.mode === "idle") {
      this.currentPps = useTimelineStore.getState().pixelsPerSecond;
    }
    this.targetPps = clampTimelinePixelsPerSecond(targetPps);
    this.anchor = anchor;
    this.inertiaVelocity = 0;
    this.mode = "spring";
    this.scheduleIfNeeded();
  }

  /**
   * Begin a momentum (inertia) deceleration after a pinch gesture ends.
   * velocity is a fractional PPS change per frame (e.g. 0.02 = 2% expansion/frame).
   */
  startInertia(velocity: number, anchor: ZoomAnchor): void {
    if (Math.abs(velocity) < INERTIA_MIN_VELOCITY) return;
    // Sync to current store value so inertia starts from where the pinch left off.
    this.currentPps = useTimelineStore.getState().pixelsPerSecond;
    this.targetPps = this.currentPps;
    this.inertiaVelocity = velocity;
    this.anchor = anchor;
    this.mode = "inertia";
    this.scheduleIfNeeded();
  }

  dispose(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.mode = "idle";
  }

  private scheduleIfNeeded(): void {
    if (this.rafId !== null) return; // already ticking
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    this.rafId = null;
    if (!this.anchor || this.mode === "idle") return;

    if (this.mode === "spring") {
      const diff = this.targetPps - this.currentPps;
      if (Math.abs(diff) < SETTLE_THRESHOLD_PPS) {
        // Snap to target and stop.
        this.currentPps = this.targetPps;
        this.applyFrame();
        this.mode = "idle";
        return;
      }
      this.currentPps += diff * SPRING_K;
      this.applyFrame();
      this.rafId = requestAnimationFrame(() => this.tick());

    } else if (this.mode === "inertia") {
      this.inertiaVelocity *= INERTIA_FRICTION;
      if (Math.abs(this.inertiaVelocity) < INERTIA_MIN_VELOCITY) {
        this.mode = "idle";
        return;
      }
      const nextPps = clampTimelinePixelsPerSecond(this.currentPps * (1 + this.inertiaVelocity));
      if (nextPps === this.currentPps) {
        // Hit PPS boundary — stop inertia.
        this.mode = "idle";
        return;
      }
      this.currentPps = nextPps;
      this.targetPps = nextPps;
      this.applyFrame();
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private applyFrame(): void {
    if (!this.anchor) return;
    const { anchorTime, localTimelineX, containerWidth, viewportEndSeconds, hasClips } = this.anchor;

    useTimelineStore.getState().setPixelsPerSecond(this.currentPps);

    const nextScrollLeft = getAnchoredZoomScrollLeft({
      anchorTime,
      localTimelineX,
      containerWidth,
      viewportEndSeconds,
      nextPixelsPerSecond: this.currentPps,
      hasClips,
    });

    this.container.scrollLeft = nextScrollLeft;
    useTimelineStore.getState().setScrollLeft(nextScrollLeft);
  }
}
