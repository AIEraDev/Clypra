/**
 * KeyframeEvalWorkerClient — Main-Thread Client for KeyframeEvalWorker
 *
 * Provides off-thread cubic Bézier curve evaluation and animation interpolation
 * via WorkerBus with typed unpacking and synchronous fallbacks.
 */

import { WorkerBus } from "./workerBus";
import type {
  KeyframeEvalRequest,
  KeyframeEvalResult,
  SerializedKeyframeClip,
  AnimatedVisualProperty,
  WorkerErrorResponse,
} from "@/workers/types";
import { VISUAL_PROP_INDEX, VOLUME_PROP_INDEX } from "@/workers/types";

const INDEX_TO_VISUAL_PROP: Record<number, AnimatedVisualProperty> = {
  0: "x",
  1: "y",
  2: "width",
  3: "height",
  4: "rotation",
  5: "opacity",
};

export type EvaluatedClipProperties = {
  visual?: Partial<Record<AnimatedVisualProperty, number>>;
  gain?: number;
};

export class KeyframeEvalWorkerClient {
  private readonly bus: WorkerBus<
    KeyframeEvalRequest,
    KeyframeEvalResult | WorkerErrorResponse
  >;

  constructor() {
    this.bus = new WorkerBus(
      () =>
        new Worker(
          new URL("../../workers/keyframeEval.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "KeyframeEvalWorker", autoRestart: true },
    );
  }

  /**
   * Evaluate all visual and volume keyframe properties for the given clips at time t.
   */
  async evaluateKeyframes(
    time: number,
    clips: SerializedKeyframeClip[],
    frameRate = 30,
  ): Promise<Map<string, EvaluatedClipProperties>> {
    if (this.bus.status === "error" || typeof Worker === "undefined" || clips.length === 0) {
      return this.fallbackEvaluate(time, clips);
    }

    try {
      const response = await this.bus.send<KeyframeEvalResult>({
        type: "EVALUATE",
        time,
        frameRate,
        clips,
      } as any);

      return this.unpackResults(response.results, clips);
    } catch {
      return this.fallbackEvaluate(time, clips);
    }
  }

  private unpackResults(
    results: Float32Array,
    clips: SerializedKeyframeClip[],
  ): Map<string, EvaluatedClipProperties> {
    const map = new Map<string, EvaluatedClipProperties>();

    for (let i = 0; i < results.length; i += 3) {
      const clipIdx = Math.round(results[i]);
      const propIdx = Math.round(results[i + 1]);
      const value = results[i + 2];

      const clip = clips[clipIdx];
      if (!clip) continue;

      if (!map.has(clip.clipId)) {
        map.set(clip.clipId, { visual: {} });
      }

      const entry = map.get(clip.clipId)!;

      if (propIdx === VOLUME_PROP_INDEX) {
        entry.gain = value;
      } else if (propIdx in INDEX_TO_VISUAL_PROP) {
        const propName = INDEX_TO_VISUAL_PROP[propIdx];
        if (!entry.visual) entry.visual = {};
        entry.visual[propName] = value;
      }
    }

    return map;
  }

  dispose(): void {
    this.bus.dispose();
  }

  // ─── Main-Thread Fallback ───────────────────────────────────────────────────

  private fallbackEvaluate(
    time: number,
    clips: SerializedKeyframeClip[],
  ): Map<string, EvaluatedClipProperties> {
    const map = new Map<string, EvaluatedClipProperties>();

    for (const clip of clips) {
      const clipStart = clip.startTime;
      const clipEnd = clip.startTime + clip.duration;

      if (time < clipStart || time > clipEnd) continue;
      const clipRelativeTime = time - clipStart;

      const evalProps: EvaluatedClipProperties = { visual: {} };

      if (clip.visualKeyframes && clip.visualKeyframes.length > 0) {
        const propGroups = new Map<string, typeof clip.visualKeyframes>();
        for (const kf of clip.visualKeyframes) {
          if (!propGroups.has(kf.property)) propGroups.set(kf.property, []);
          propGroups.get(kf.property)!.push(kf);
        }

        for (const [prop, kfs] of propGroups) {
          const sorted = [...kfs].sort((a, b) => a.time - b.time);
          let val = sorted[0].value;

          if (clipRelativeTime <= sorted[0].time) {
            val = sorted[0].value;
          } else if (clipRelativeTime >= sorted[sorted.length - 1].time) {
            val = sorted[sorted.length - 1].value;
          } else {
            for (let i = 0; i < sorted.length - 1; i++) {
              const k0 = sorted[i];
              const k1 = sorted[i + 1];
              if (clipRelativeTime >= k0.time && clipRelativeTime <= k1.time) {
                const span = k1.time - k0.time;
                const progress = span > 0 ? (clipRelativeTime - k0.time) / span : 0;
                val = k0.value + progress * (k1.value - k0.value);
                break;
              }
            }
          }

          evalProps.visual![prop as AnimatedVisualProperty] = val;
        }
      }

      if (clip.volumeKeyframes && clip.volumeKeyframes.length > 0) {
        const sorted = [...clip.volumeKeyframes].sort((a, b) => a.time - b.time);
        let gain = sorted[0].gain;

        if (clipRelativeTime <= sorted[0].time) {
          gain = sorted[0].gain;
        } else if (clipRelativeTime >= sorted[sorted.length - 1].time) {
          gain = sorted[sorted.length - 1].gain;
        } else {
          for (let i = 0; i < sorted.length - 1; i++) {
            const k0 = sorted[i];
            const k1 = sorted[i + 1];
            if (clipRelativeTime >= k0.time && clipRelativeTime <= k1.time) {
              const span = k1.time - k0.time;
              const progress = span > 0 ? (clipRelativeTime - k0.time) / span : 0;
              gain = k0.gain + progress * (k1.gain - k0.gain);
              break;
            }
          }
        }

        evalProps.gain = gain;
      }

      map.set(clip.clipId, evalProps);
    }

    return map;
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let clientInstance: KeyframeEvalWorkerClient | null = null;

export function getKeyframeEvalWorkerClient(): KeyframeEvalWorkerClient {
  if (!clientInstance) {
    clientInstance = new KeyframeEvalWorkerClient();
  }
  return clientInstance;
}
