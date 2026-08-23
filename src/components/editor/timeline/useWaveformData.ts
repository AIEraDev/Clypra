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
  trimIn?: number;
  trimOut?: number;
}

interface UseWaveformDataResult {
  waveformData: WaveformBucket[];
  isLoading: boolean;
  hasError: boolean;
}

const WAVEFORM_CACHE_MAX = 50;
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

export function useWaveformData({
  audioPath,
  clipWidthPx,
  duration,
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
  const sourceDuration = Math.max(
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
    const cacheKey = `${resolvedPath}:${sourceStart.toFixed(3)}:${sourceDuration.toFixed(3)}:${sampleCount}`;
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
          const buckets = await invoke<WaveformBucket[]>(
            "extract_waveform_data",
            {
              path: normalizePathForTauriInvoke(audioPath),
              numBuckets: sampleCount,
              startTime: sourceStart,
              duration: sourceDuration || duration,
            },
          );

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
            Math.floor((sourceStart + sourceDuration) * sampleRate),
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
  }, [resolvedPath, sampleCount, sourceStart, sourceDuration, duration, audioPath]);

  return { waveformData, isLoading, hasError };
}
