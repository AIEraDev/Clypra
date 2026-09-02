/**
 * WaveformLodWorkerClient — Main-Thread Client for WaveformLodWorker
 *
 * Built on WorkerBus with automatic transferable list routing and
 * synchronous fallback support for non-Worker environments.
 */

import { WorkerBus, getSharedDomainWorkerBus } from "./workerBus";
import type {
  WaveformLodWorkerRequest,
  WaveformLodWorkerResponse,
  WaveformSliceResult,
  WaveformBuildReady,
} from "@/workers/types";

export class WaveformLodWorkerClient {
  private readonly bus: WorkerBus<
    WaveformLodWorkerRequest,
    WaveformLodWorkerResponse
  >;
  private readonly fallbackPyramids = new Map<
    string,
    { mono: Float32Array; sampleRate: number; totalSamples: number }
  >();

  constructor() {
    this.bus = getSharedDomainWorkerBus(
      "mediaAnalysis",
      () =>
        new Worker(
          new URL("../../workers/mediaAnalysis.worker.ts", import.meta.url),
          { type: "module" },
        ),
      { name: "MediaAnalysisWorker:WaveformLod", autoRestart: true },
    );
  }

  /**
   * Build a multi-LOD pyramid for a media asset.
   * `pcm` is transferred zero-copy to the worker thread.
   */
  async buildLod(
    mediaId: string,
    pcm: Float32Array,
    sampleRate: number,
    channelCount: number,
    lodSteps?: number[],
  ): Promise<WaveformBuildReady> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackBuildLod(mediaId, pcm, sampleRate, channelCount);
    }

    try {
      return await this.bus.send<WaveformBuildReady>(
        {
          type: "BUILD_LOD",
          mediaId,
          pcm,
          sampleRate,
          channelCount,
          lodSteps,
        } as any,
        [pcm.buffer],
      );
    } catch {
      return this.fallbackBuildLod(mediaId, pcm, sampleRate, channelCount);
    }
  }

  /**
   * Query a visible slice from the pre-built LOD pyramid.
   * Returns exact pixel-width typed arrays transferred zero-copy.
   */
  async sliceViewport(
    mediaId: string,
    startSample: number,
    endSample: number,
    pixelWidth: number,
  ): Promise<WaveformSliceResult> {
    if (this.bus.status === "error" || typeof Worker === "undefined") {
      return this.fallbackSliceViewport(
        mediaId,
        startSample,
        endSample,
        pixelWidth,
      );
    }

    try {
      return await this.bus.send<WaveformSliceResult>({
        type: "SLICE_VIEWPORT",
        mediaId,
        startSample,
        endSample,
        pixelWidth,
      } as any);
    } catch {
      return this.fallbackSliceViewport(
        mediaId,
        startSample,
        endSample,
        pixelWidth,
      );
    }
  }

  /**
   * Evict a media asset's pyramid when removed from the project.
   */
  evict(mediaId: string): void {
    this.fallbackPyramids.delete(mediaId);
    this.bus.post({ type: "EVICT", mediaId });
  }

  /**
   * Dispose worker instance and reject any pending requests.
   */
  dispose(): void {
    this.fallbackPyramids.clear();
    this.bus.dispose();
  }

  // ─── Main-Thread Fallbacks (JSDOM / Non-Worker Environments) ───────────────

  private fallbackBuildLod(
    mediaId: string,
    pcm: Float32Array,
    sampleRate: number,
    channelCount: number,
  ): WaveformBuildReady {
    let mono = pcm;
    if (channelCount > 1) {
      const frames = Math.floor(pcm.length / channelCount);
      mono = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        const off = f * channelCount;
        for (let c = 0; c < channelCount; c++) sum += pcm[off + c];
        mono[f] = sum / channelCount;
      }
    }

    this.fallbackPyramids.set(mediaId, {
      mono,
      sampleRate,
      totalSamples: mono.length,
    });

    return {
      type: "LOD_READY",
      mediaId,
      totalSamples: mono.length,
      durationSeconds: mono.length / (sampleRate || 48000),
    };
  }

  private fallbackSliceViewport(
    mediaId: string,
    startSample: number,
    endSample: number,
    pixelWidth: number,
  ): WaveformSliceResult {
    const width = Math.max(1, Math.round(pixelWidth));
    const cached = this.fallbackPyramids.get(mediaId);

    if (!cached || cached.mono.length === 0) {
      return {
        type: "SLICE_RESULT",
        id: "fallback",
        peaks: new Float32Array(width),
        rms: new Float32Array(width),
        samplesPerPixel: 1,
      };
    }

    const { mono, totalSamples } = cached;
    const v0 = Math.max(0, startSample);
    const v1 = Math.min(totalSamples, Math.max(v0 + 1, endSample));
    const duration = v1 - v0;

    const peaks = new Float32Array(width);
    const rms = new Float32Array(width);

    for (let px = 0; px < width; px++) {
      const s0 = Math.floor(v0 + (px * duration) / width);
      const s1 = Math.min(totalSamples, Math.floor(v0 + ((px + 1) * duration) / width));
      const count = Math.max(1, s1 - s0);

      let peak = 0;
      let sumSq = 0;

      for (let s = s0; s < s1; s++) {
        const val = Math.abs(mono[s]);
        if (val > peak) peak = val;
        sumSq += val * val;
      }

      peaks[px] = peak;
      rms[px] = Math.sqrt(sumSq / count);
    }

    return {
      type: "SLICE_RESULT",
      id: "fallback",
      peaks,
      rms,
      samplesPerPixel: Math.max(1, Math.floor(duration / width)),
    };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let clientInstance: WaveformLodWorkerClient | null = null;

export function getWaveformLodWorkerClient(): WaveformLodWorkerClient {
  if (!clientInstance) {
    clientInstance = new WaveformLodWorkerClient();
  }
  return clientInstance;
}
