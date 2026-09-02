/**
 * WaveformLodWorker — Off-Thread Audio Waveform LOD Pyramid & Viewport Slicer
 *
 * Compute-heavy audio waveform processing:
 * 1. Takes raw PCM Float32Array (transferred zero-copy)
 * 2. Downmixes multi-channel PCM to mono
 * 3. Builds multi-resolution LOD pyramids (e.g., 100, 1,000, 10,000, 100,000 samples/bucket)
 * 4. Slices visible viewport ranges to exact pixel widths in < 1ms
 * 5. Returns peak & RMS Float32Arrays transferred zero-copy
 */

import type {
  WaveformLodWorkerRequest,
  WaveformBuildRequest,
  WaveformSliceRequest,
  WaveformEvictRequest,
  WaveformBuildReady,
  WaveformSliceResult,
  WorkerErrorResponse,
} from "./types";

interface LodLevel {
  step: number; // Samples per bucket
  peaks: Float32Array;
  rms: Float32Array;
}

interface WaveformPyramid {
  mediaId: string;
  totalSamples: number;
  sampleRate: number;
  durationSeconds: number;
  levels: LodLevel[];
}

const pyramids = new Map<string, WaveformPyramid>();

const DEFAULT_LOD_STEPS = [100, 1_000, 10_000, 100_000];

function downmixToMono(
  pcm: Float32Array,
  channelCount: number,
): Float32Array {
  if (channelCount <= 1) return pcm;

  const totalFrames = Math.floor(pcm.length / channelCount);
  const mono = new Float32Array(totalFrames);

  for (let frame = 0; frame < totalFrames; frame++) {
    let sum = 0;
    const offset = frame * channelCount;
    for (let ch = 0; ch < channelCount; ch++) {
      sum += pcm[offset + ch];
    }
    mono[frame] = sum / channelCount;
  }

  return mono;
}

function buildPyramidLevel(
  monoPcm: Float32Array,
  step: number,
): LodLevel {
  const totalSamples = monoPcm.length;
  const bucketCount = Math.max(1, Math.ceil(totalSamples / step));
  const peaks = new Float32Array(bucketCount);
  const rms = new Float32Array(bucketCount);

  for (let b = 0; b < bucketCount; b++) {
    const start = b * step;
    const end = Math.min(totalSamples, start + step);
    const count = Math.max(1, end - start);

    let peak = 0;
    let sumSquares = 0;

    for (let s = start; s < end; s++) {
      const val = Math.abs(monoPcm[s]);
      if (val > peak) peak = val;
      sumSquares += val * val;
    }

    peaks[b] = peak;
    rms[b] = Math.sqrt(sumSquares / count);
  }

  return { step, peaks, rms };
}

function handleBuildLod(msg: WaveformBuildRequest): void {
  const { mediaId, pcm, sampleRate, channelCount, lodSteps = DEFAULT_LOD_STEPS } = msg;

  const mono = downmixToMono(pcm, channelCount);
  const totalSamples = mono.length;
  const durationSeconds = totalSamples / (sampleRate || 48000);

  // Build sorted LOD levels
  const sortedSteps = [...new Set(lodSteps)].sort((a, b) => a - b);
  const levels: LodLevel[] = sortedSteps.map((step) =>
    buildPyramidLevel(mono, step),
  );

  pyramids.set(mediaId, {
    mediaId,
    totalSamples,
    sampleRate,
    durationSeconds,
    levels,
  });

  const response: WaveformBuildReady = {
    type: "LOD_READY",
    mediaId,
    totalSamples,
    durationSeconds,
  };

  (self as unknown as Worker).postMessage(response);
}

function handleSliceViewport(msg: WaveformSliceRequest): void {
  const { id, mediaId, startSample, endSample, pixelWidth } = msg;

  const targetWidth = Math.max(1, Math.round(pixelWidth));
  const pyramid = pyramids.get(mediaId);

  if (!pyramid || pyramid.levels.length === 0) {
    const emptyPeaks = new Float32Array(targetWidth);
    const emptyRms = new Float32Array(targetWidth);
    const response: WaveformSliceResult = {
      type: "SLICE_RESULT",
      id,
      peaks: emptyPeaks,
      rms: emptyRms,
      samplesPerPixel: 1,
    };
    (self as unknown as Worker).postMessage(response, [
      emptyPeaks.buffer,
      emptyRms.buffer,
    ]);
    return;
  }

  const visibleStart = Math.max(0, startSample);
  const visibleEnd = Math.min(pyramid.totalSamples, Math.max(visibleStart + 1, endSample));
  const visibleDurationSamples = visibleEnd - visibleStart;
  const requestedSamplesPerPixel = visibleDurationSamples / targetWidth;

  // Pick the best LOD level: largest step that is <= requestedSamplesPerPixel,
  // or the lowest available level if all steps are larger.
  let selectedLevel = pyramid.levels[0];
  for (const level of pyramid.levels) {
    if (level.step <= requestedSamplesPerPixel) {
      selectedLevel = level;
    } else {
      break;
    }
  }

  const outPeaks = new Float32Array(targetWidth);
  const outRms = new Float32Array(targetWidth);

  const step = selectedLevel.step;
  const lodBucketCount = selectedLevel.peaks.length;

  for (let px = 0; px < targetWidth; px++) {
    const s0 = visibleStart + (px * visibleDurationSamples) / targetWidth;
    const s1 = visibleStart + ((px + 1) * visibleDurationSamples) / targetWidth;

    const b0 = Math.max(0, Math.min(lodBucketCount - 1, Math.floor(s0 / step)));
    const b1 = Math.max(b0, Math.min(lodBucketCount - 1, Math.floor(s1 / step)));

    let peak = 0;
    let sumRms = 0;
    let count = 0;

    for (let b = b0; b <= b1; b++) {
      const p = selectedLevel.peaks[b];
      if (p > peak) peak = p;
      sumRms += selectedLevel.rms[b];
      count++;
    }

    outPeaks[px] = peak;
    outRms[px] = count > 0 ? sumRms / count : 0;
  }

  // Normalize outputs relative to maximum in view
  let maxPeak = 0;
  let maxRms = 0;
  for (let i = 0; i < targetWidth; i++) {
    if (outPeaks[i] > maxPeak) maxPeak = outPeaks[i];
    if (outRms[i] > maxRms) maxRms = outRms[i];
  }

  if (maxPeak > 0 || maxRms > 0) {
    for (let i = 0; i < targetWidth; i++) {
      if (maxPeak > 0) outPeaks[i] /= maxPeak;
      if (maxRms > 0) outRms[i] /= maxRms;
    }
  }

  const response: WaveformSliceResult = {
    type: "SLICE_RESULT",
    id,
    peaks: outPeaks,
    rms: outRms,
    samplesPerPixel: selectedLevel.step,
  };

  (self as unknown as Worker).postMessage(response, [
    outPeaks.buffer,
    outRms.buffer,
  ]);
}

function handleEvict(msg: WaveformEvictRequest): void {
  pyramids.delete(msg.mediaId);
}

// ─── Worker Event Listener ───────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WaveformLodWorkerRequest>) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  try {
    switch (msg.type) {
      case "BUILD_LOD":
        handleBuildLod(msg);
        break;
      case "SLICE_VIEWPORT":
        handleSliceViewport(msg);
        break;
      case "EVICT":
        handleEvict(msg);
        break;
      case "DISPOSE":
        pyramids.clear();
        break;
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
