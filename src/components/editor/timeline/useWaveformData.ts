import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@/core/platform";
import { isWebviewOrExternalUrl } from "@/lib/platform/pathConversion";
import { normalizePathForTauriInvoke } from "@/lib/platform/tauri";
import type { WaveformBucket } from "@/types";

interface UseWaveformDataProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  /** Full source-media duration. Enables one cached peak table per source asset. */
  mediaDuration?: number;
  trimIn?: number;
  trimOut?: number;
}

interface UseWaveformDataResult {
  waveformData: WaveformBucket[];
  isLoading: boolean;
  hasError: boolean;
}

const WAVEFORM_CACHE_MAX = 50;
/** Versioned source-scoped peak cache. Viewport density/trim is sampled from it. */
const WAVEFORM_SOURCE_BUCKETS = 2048;
const waveformCache = new Map<string, WaveformBucket[]>();

function waveformCacheSet(key: string, value: WaveformBucket[]): void {
  waveformCache.delete(key);
  waveformCache.set(key, value);
  if (waveformCache.size > WAVEFORM_CACHE_MAX) {
    const oldest = waveformCache.keys().next().value;
    if (oldest !== undefined) waveformCache.delete(oldest);
  }
}

function waveformCacheGet(key: string): WaveformBucket[] | undefined {
  const value = waveformCache.get(key);
  if (value !== undefined) {
    waveformCache.delete(key);
    waveformCache.set(key, value);
  }
  return value;
}

function quantizeWaveformSampleCount(rawWidthPx: number): number {
  const target = Math.max(rawWidthPx / 1.5, 200);
  if (target <= 256) return 256;
  if (target <= 512) return 512;
  if (target <= 1024) return 1024;
  return 2048;
}

function sampleWaveformRange(
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

export function useWaveformData({
  audioPath,
  clipWidthPx,
  duration,
  mediaDuration,
  trimIn = 0,
  trimOut,
}: UseWaveformDataProps): UseWaveformDataResult {
  const [waveformData, setWaveformData] = useState<WaveformBucket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const validClipWidth =
    typeof clipWidthPx === "number" && !isNaN(clipWidthPx) ? clipWidthPx : 300;
  const sampleCount = quantizeWaveformSampleCount(validClipWidth);
  const sourceStart = Math.max(0, Number.isFinite(trimIn) ? trimIn : 0);
  const visibleSourceDuration = Math.max(
    0,
    Math.min(
      duration,
      (Number.isFinite(trimOut) ? trimOut! : sourceStart + duration) -
        sourceStart,
    ),
  );
  const resolvedPath = isWebviewOrExternalUrl(audioPath)
    ? audioPath
    : platform.convertFileSrc(audioPath);

  useEffect(() => {
    const sourceCacheKey = `waveform-v1:${resolvedPath}:${mediaDuration ?? "unknown"}:source:${WAVEFORM_SOURCE_BUCKETS}`;
    const cacheKey = `${sourceCacheKey}:${sourceStart.toFixed(3)}:${visibleSourceDuration.toFixed(3)}:${sampleCount}`;
    const cached = waveformCacheGet(cacheKey);
    if (cached) {
      setWaveformData(cached);
      setHasError(false);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const generateWaveform = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        try {
          const canUseSourceCache = Number.isFinite(mediaDuration) && mediaDuration! > 0;
          let buckets: WaveformBucket[] = [];
          if (canUseSourceCache) {
            let sourceBuckets = waveformCacheGet(sourceCacheKey);
            if (!sourceBuckets) {
              sourceBuckets = await invoke<WaveformBucket[]>("extract_waveform_data", {
                path: normalizePathForTauriInvoke(audioPath),
                numBuckets: WAVEFORM_SOURCE_BUCKETS,
                startTime: 0,
                duration: mediaDuration,
              });
              if (sourceBuckets?.length) waveformCacheSet(sourceCacheKey, sourceBuckets);
            }
            buckets = sourceBuckets?.length
              ? sampleWaveformRange(sourceBuckets, sourceStart / mediaDuration!, (sourceStart + visibleSourceDuration) / mediaDuration!, sampleCount)
              : [];
          } else {
            buckets = await invoke<WaveformBucket[]>("extract_waveform_data", {
              path: normalizePathForTauriInvoke(audioPath),
              numBuckets: sampleCount,
              startTime: sourceStart,
              duration: visibleSourceDuration || duration,
            });
          }

          if (!isCancelled && buckets && buckets.length > 0) {
            waveformCacheSet(cacheKey, buckets);
            setWaveformData(buckets);
            setIsLoading(false);
            return;
          }
        } catch {}

        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();

        try {
          const response = await fetch(resolvedPath);
          if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          if (isCancelled) return;

          const channelData = audioBuffer.getChannelData(0);
          const sampleRate = audioBuffer.sampleRate;
          const startSample = Math.max(0, Math.floor(sourceStart * sampleRate));
          const endSample = Math.min(
            channelData.length,
            Math.floor((sourceStart + visibleSourceDuration) * sampleRate),
          );
          const visibleChannelData = channelData.subarray(
            startSample,
            endSample,
          );
          const totalSamples = visibleChannelData.length;
          const buckets: WaveformBucket[] = [];

          for (let i = 0; i < sampleCount; i++) {
            const start = Math.floor((i * totalSamples) / sampleCount);
            const end = Math.min(
              totalSamples,
              Math.floor(((i + 1) * totalSamples) / sampleCount),
            );
            let peak = 0;
            let sumSquares = 0;
            const count = Math.max(1, end - start);

            for (let j = start; j < end; j++) {
              const value = Math.abs(visibleChannelData[j]);
              peak = Math.max(peak, value);
              sumSquares += value * value;
            }

            buckets.push({
              peak,
              rms: Math.sqrt(sumSquares / count),
            });
          }

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

          if (!isCancelled) {
            waveformCacheSet(cacheKey, buckets);
            setWaveformData(buckets);
            setIsLoading(false);
          }
        } finally {
          audioContext.close();
        }
      } catch {
        if (!isCancelled) {
          setWaveformData([]);
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    void generateWaveform();
    return () => {
      isCancelled = true;
    };
  }, [resolvedPath, sampleCount, sourceStart, visibleSourceDuration, mediaDuration, duration, audioPath]);

  return { waveformData, isLoading, hasError };
}
