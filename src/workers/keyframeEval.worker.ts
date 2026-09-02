/**
 * KeyframeEvalWorker — Off-Thread Cubic Bézier Curve & Animation Solver
 *
 * Evaluates high-frequency keyframe animation values off the main thread:
 * • Solves cubic Bézier equations via Newton-Raphson / binary subdivision
 * • Evaluates multi-track visual (x, y, width, height, rotation, opacity) and audio gain curves
 * • Packs results into a compact transferable Float32Array buffer
 */

import type {
  KeyframeEvalRequest,
  KeyframeEvalResult,
  SerializedVisualKeyframe,
  SerializedVolumeKeyframe,
  WorkerErrorResponse,
} from "./types";
import { VISUAL_PROP_INDEX, VOLUME_PROP_INDEX } from "./types";

// ─── Cubic Bézier Root Solver ─────────────────────────────────────────────────

function sampleCurveX(t: number, x1: number, x2: number): number {
  return ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t * t + 3 * x1 * t;
}

function sampleCurveY(t: number, y1: number, y2: number): number {
  return ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t * t + 3 * y1 * t;
}

function sampleCurveDerivativeX(t: number, x1: number, x2: number): number {
  return (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;
}

function solveCubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  // Newton-Raphson iteration
  let t = progress;
  for (let i = 0; i < 8; i++) {
    const x = sampleCurveX(t, x1, x2) - progress;
    if (Math.abs(x) < 1e-5) return sampleCurveY(t, y1, y2);
    const d = sampleCurveDerivativeX(t, x1, x2);
    if (Math.abs(d) < 1e-5) break;
    t -= x / d;
  }

  // Fallback to binary subdivision
  let t0 = 0.0;
  let t1 = 1.0;
  t = progress;

  for (let i = 0; i < 12; i++) {
    const x = sampleCurveX(t, x1, x2);
    if (Math.abs(x - progress) < 1e-5) break;
    if (progress > x) t0 = t;
    else t1 = t;
    t = (t1 + t0) * 0.5;
  }

  return sampleCurveY(t, y1, y2);
}

function interpolateVisualKeyframes(
  keyframes: SerializedVisualKeyframe[],
  clipRelativeTime: number,
): number | null {
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) return keyframes[0].value;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (clipRelativeTime <= sorted[0].time) return sorted[0].value;
  if (clipRelativeTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];

    if (clipRelativeTime >= k0.time && clipRelativeTime <= k1.time) {
      const span = k1.time - k0.time;
      if (span <= 1e-5) return k0.value;
      const progress = (clipRelativeTime - k0.time) / span;

      if (k0.easing) {
        const [x1, y1, x2, y2] = k0.easing;
        const eased = solveCubicBezier(progress, x1, y1, x2, y2);
        return k0.value + eased * (k1.value - k0.value);
      } else {
        return k0.value + progress * (k1.value - k0.value);
      }
    }
  }

  return sorted[sorted.length - 1].value;
}

function interpolateVolumeKeyframes(
  keyframes: SerializedVolumeKeyframe[],
  clipRelativeTime: number,
): number | null {
  if (keyframes.length === 0) return null;
  if (keyframes.length === 1) return keyframes[0].gain;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (clipRelativeTime <= sorted[0].time) return sorted[0].gain;
  if (clipRelativeTime >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].gain;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];

    if (clipRelativeTime >= k0.time && clipRelativeTime <= k1.time) {
      const span = k1.time - k0.time;
      if (span <= 1e-5) return k0.gain;
      const progress = (clipRelativeTime - k0.time) / span;

      let eased = progress;
      if (k0.easing === "ease-in") {
        eased = solveCubicBezier(progress, 0.42, 0.0, 1.0, 1.0);
      } else if (k0.easing === "ease-out") {
        eased = solveCubicBezier(progress, 0.0, 0.0, 0.58, 1.0);
      } else if (k0.easing === "ease-in-out") {
        eased = solveCubicBezier(progress, 0.42, 0.0, 0.58, 1.0);
      }

      return k0.gain + eased * (k1.gain - k0.gain);
    }
  }

  return sorted[sorted.length - 1].gain;
}

// ─── Main Request Handler ─────────────────────────────────────────────────────

function handleEvaluate(msg: KeyframeEvalRequest): void {
  const start = performance.now();
  const { id, time, clips } = msg;

  const triplets: number[] = [];

  for (let clipIdx = 0; clipIdx < clips.length; clipIdx++) {
    const clip = clips[clipIdx];
    const clipStart = clip.startTime;
    const clipEnd = clip.startTime + clip.duration;

    if (time < clipStart || time > clipEnd) continue;
    const clipRelativeTime = time - clipStart;

    // 1. Visual Keyframes
    if (clip.visualKeyframes && clip.visualKeyframes.length > 0) {
      const propGroups = new Map<string, SerializedVisualKeyframe[]>();
      for (const kf of clip.visualKeyframes) {
        if (!propGroups.has(kf.property)) propGroups.set(kf.property, []);
        propGroups.get(kf.property)!.push(kf);
      }

      for (const [prop, kfs] of propGroups) {
        const val = interpolateVisualKeyframes(kfs, clipRelativeTime);
        if (val !== null && prop in VISUAL_PROP_INDEX) {
          const propIdx = VISUAL_PROP_INDEX[prop as keyof typeof VISUAL_PROP_INDEX];
          triplets.push(clipIdx, propIdx, val);
        }
      }
    }

    // 2. Volume Keyframes
    if (clip.volumeKeyframes && clip.volumeKeyframes.length > 0) {
      const gain = interpolateVolumeKeyframes(clip.volumeKeyframes, clipRelativeTime);
      if (gain !== null) {
        triplets.push(clipIdx, VOLUME_PROP_INDEX, gain);
      }
    }
  }

  const results = new Float32Array(triplets);
  const evalMs = performance.now() - start;

  const response: KeyframeEvalResult = {
    type: "EVAL_RESULT",
    id,
    results,
    evalMs,
  };

  (self as unknown as Worker).postMessage(response, [results.buffer]);
}

// ─── Worker Event Listener ───────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<KeyframeEvalRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  try {
    if (msg.type === "EVALUATE") {
      handleEvaluate(msg);
    }
  } catch (error) {
    const errorResponse: WorkerErrorResponse = {
      type: "ERROR",
      id: "id" in msg ? msg.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
    (self as unknown as Worker).postMessage(errorResponse);
  }
};
