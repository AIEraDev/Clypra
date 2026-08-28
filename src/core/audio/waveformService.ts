import { invoke } from "@tauri-apps/api/core";
import type { WaveformBucket } from "@/types";

const WAVEFORM_CACHE_MAX = 50;

/**
 * Shared source/viewport waveform cache.
 *
 * The in-flight map is as important as the completed cache: two waveform
 * layers can mount in the same render pass and otherwise both start ffmpeg
 * before either one has had a chance to populate the cache.
 */
const waveformCache = new Map<string, WaveformBucket[]>();
const waveformRequests = new Map<string, Promise<WaveformBucket[]>>();
const browserWaveformRequests = new Map<string, Promise<WaveformBucket[]>>();

export interface NativeWaveformRequest {
  path: string;
  numBuckets: number;
  startTime?: number;
  duration?: number;
}

export interface BrowserWaveformRequest {
  url: string;
  sourceStart: number;
  visibleDuration: number;
  bucketCount: number;
  sourceDuration?: number;
  sourceBucketCount?: number;
}

function waveformCacheSet(key: string, value: WaveformBucket[]): void {
  waveformCache.delete(key);
  waveformCache.set(key, value);
  if (waveformCache.size > WAVEFORM_CACHE_MAX) {
    const oldest = waveformCache.keys().next().value;
    if (oldest !== undefined) waveformCache.delete(oldest);
  }
}

export function cacheWaveformData(key: string, value: WaveformBucket[]): void {
  if (value.length > 0) waveformCacheSet(key, value);
}

function waveformCacheGet(key: string): WaveformBucket[] | undefined {
  const value = waveformCache.get(key);
  if (value !== undefined) {
    waveformCache.delete(key);
    waveformCache.set(key, value);
  }
  return value;
}

/**
 * Gets native waveform data while coalescing concurrent requests for the
 * same cache key. A rejected request is removed from the in-flight map so a
 * later render can retry and fall back normally.
 */
export function getNativeWaveformData(
  cacheKey: string,
  request: NativeWaveformRequest,
): Promise<WaveformBucket[]> {
  const cached = waveformCacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);

  const existing = waveformRequests.get(cacheKey);
  if (existing) return existing;

  const pending = invoke<WaveformBucket[]>("extract_waveform_data", {
    path: request.path,
    numBuckets: request.numBuckets,
    startTime: request.startTime,
    duration: request.duration,
  })
    .then((buckets) => {
      const result = buckets ?? [];
      cacheWaveformData(cacheKey, result);
      return result;
    })
    .finally(() => {
      waveformRequests.delete(cacheKey);
    });

  waveformRequests.set(cacheKey, pending);
  return pending;
}

function computeWaveformBuckets(
  channelData: Float32Array,
  startSample: number,
  endSample: number,
  bucketCount: number,
): WaveformBucket[] {
  const visibleChannelData = channelData.subarray(
    Math.max(0, startSample),
    Math.max(startSample, Math.min(channelData.length, endSample)),
  );
  const totalSamples = visibleChannelData.length;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor((index * totalSamples) / bucketCount);
    const end = Math.min(
      totalSamples,
      Math.floor(((index + 1) * totalSamples) / bucketCount),
    );
    let peak = 0;
    let sumSquares = 0;
    const count = Math.max(1, end - start);

    for (let sample = start; sample < end; sample += 1) {
      const value = Math.abs(visibleChannelData[sample]);
      peak = Math.max(peak, value);
      sumSquares += value * value;
    }

    return { peak, rms: Math.sqrt(sumSquares / count) };
  });

  let maxPeak = 0;
  let maxRms = 0;
  for (const bucket of buckets) {
    maxPeak = Math.max(maxPeak, bucket.peak);
    maxRms = Math.max(maxRms, bucket.rms);
  }
  if (maxPeak > 0 || maxRms > 0) {
    for (const bucket of buckets) {
      if (maxPeak > 0) bucket.peak /= maxPeak;
      if (maxRms > 0) bucket.rms /= maxRms;
    }
  }

  return buckets;
}

/** Browser fallback with the same source-scoped in-flight deduplication as native extraction. */
export function getBrowserWaveformData(
  cacheKey: string,
  request: BrowserWaveformRequest,
): Promise<WaveformBucket[]> {
  const cached = waveformCacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);

  const existing = browserWaveformRequests.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    const response = await fetch(request.url);
    if (!response.ok) throw new Error(`Failed to fetch audio: ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio is unavailable");

    const audioContext = new AudioContextClass();
    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const sourceDuration = Number.isFinite(request.sourceDuration) && request.sourceDuration! > 0
        ? request.sourceDuration!
        : undefined;

      if (sourceDuration) {
        const sourceBuckets = computeWaveformBuckets(
          channelData,
          0,
          channelData.length,
          request.sourceBucketCount ?? 2048,
        );
        return sampleWaveformRange(
          sourceBuckets,
          request.sourceStart / sourceDuration,
          (request.sourceStart + request.visibleDuration) / sourceDuration,
          request.bucketCount,
        );
      }

      return computeWaveformBuckets(
        channelData,
        Math.floor(Math.max(0, request.sourceStart) * sampleRate),
        Math.floor(Math.max(0, request.sourceStart + request.visibleDuration) * sampleRate),
        request.bucketCount,
      );
    } finally {
      await audioContext.close();
    }
  })()
    .then((buckets) => {
      cacheWaveformData(cacheKey, buckets);
      return buckets;
    })
    .finally(() => {
      browserWaveformRequests.delete(cacheKey);
    });

  browserWaveformRequests.set(cacheKey, pending);
  return pending;
}

export function sampleWaveformRange(
  source: WaveformBucket[],
  startFraction: number,
  endFraction: number,
  bucketCount: number,
): WaveformBucket[] {
  if (!source.length) return [];
  const start = Math.max(0, Math.min(source.length, Math.floor(startFraction * source.length)));
  const end = Math.max(start + 1, Math.min(source.length, Math.ceil(endFraction * source.length)));
  const range = source.slice(start, end);
  return Array.from({ length: bucketCount }, (_, index) => {
    const from = Math.floor((index * range.length) / bucketCount);
    const to = Math.max(from + 1, Math.floor(((index + 1) * range.length) / bucketCount));
    const group = range.slice(from, to);
    return group.reduce<WaveformBucket>((result, bucket) => ({
      peak: Math.max(result.peak, bucket.peak),
      rms: Math.max(result.rms, bucket.rms),
    }), { peak: 0, rms: 0 });
  });
}

export interface WaveformThumbnailOptions {
  width?: number;
  height?: number;
  barCount?: number;
  barColor?: string;
  backgroundColor?: string;
  barGap?: number;
  trimIn?: number;
  trimOut?: number;
}

/**
 * Draws an array of waveform buckets onto an HTML canvas and returns a base64 PNG data URL.
 */
export function renderWaveformBucketsToDataUrl(
  buckets: WaveformBucket[],
  options: WaveformThumbnailOptions = {},
): string {
  const {
    width = 160,
    height = 90,
    barCount = 32,
    barColor = "#22d3ee",
    backgroundColor = "#1e293b",
    barGap = 0.2,
  } = options;

  if (typeof document === "undefined" || !document.createElement) {
    return "";
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const effectiveBuckets = buckets.length > 0
    ? (buckets.length === barCount ? buckets : sampleWaveformRange(buckets, 0, 1, barCount))
    : [];

  const maxPeak = Math.max(...effectiveBuckets.map((b) => b.peak), 0.001);
  const barWidth = width / barCount;
  const actualBarWidth = barWidth * (1 - barGap);
  const barGapPx = barWidth * barGap;

  ctx.fillStyle = barColor;

  for (let i = 0; i < barCount; i++) {
    const bucket = effectiveBuckets[i];
    const rawVal = bucket ? bucket.peak / maxPeak : Math.sin(i * 0.5) * 0.5 + 0.5;
    const minHeight = 2;
    const maxHeight = height * 0.8;
    const barHeight = Math.max(minHeight, rawVal * maxHeight);

    const x = i * barWidth + barGapPx / 2;
    const y = (height - barHeight) / 2;

    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, actualBarWidth, barHeight, 1);
    } else {
      ctx.rect(x, y, actualBarWidth, barHeight);
    }
    ctx.fill();
  }

  return canvas.toDataURL("image/png");
}

/**
 * Generates an audio waveform thumbnail data URL by leveraging cached waveform buckets.
 */
export async function generateAudioWaveformThumbnail(
  audioPath: string,
  options: WaveformThumbnailOptions = {},
): Promise<string> {
  const barCount = options.barCount ?? 32;
  const trimIn = options.trimIn ?? 0;
  const trimOut = options.trimOut;
  const visibleDuration = trimOut !== undefined ? Math.max(0.1, trimOut - trimIn) : 10;

  try {
    const cacheKey = `browser-thumb:${audioPath}:${trimIn}:${visibleDuration}:${barCount}`;
    const buckets = await getBrowserWaveformData(cacheKey, {
      url: audioPath,
      sourceStart: trimIn,
      visibleDuration,
      bucketCount: barCount,
    });
    return renderWaveformBucketsToDataUrl(buckets, options);
  } catch {
    return renderWaveformBucketsToDataUrl([], options);
  }
}

/** Test-only reset hook; no production caller should need to clear this cache. */
export function clearWaveformServiceCache(): void {
  waveformCache.clear();
  waveformRequests.clear();
  browserWaveformRequests.clear();
}
