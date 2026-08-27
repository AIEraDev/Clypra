import { useEffect, useState } from "react";
import { platform } from "@/core/platform";
import {
  getBrowserWaveformData,
  getNativeWaveformData,
  sampleWaveformRange,
} from "@/core/audio/waveformService";
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

/** Versioned source-scoped peak cache. Viewport density/trim is sampled from it. */
const WAVEFORM_SOURCE_BUCKETS = 2048;

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
    let isCancelled = false;

    const generateWaveform = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        try {
          const canUseSourceCache = Number.isFinite(mediaDuration) && mediaDuration! > 0;
          let buckets: WaveformBucket[] = [];
          if (canUseSourceCache) {
            const sourceBuckets = await getNativeWaveformData(sourceCacheKey, {
              path: normalizePathForTauriInvoke(audioPath),
              numBuckets: WAVEFORM_SOURCE_BUCKETS,
              startTime: 0,
              duration: mediaDuration,
            });
            buckets = sourceBuckets?.length
              ? sampleWaveformRange(sourceBuckets, sourceStart / mediaDuration!, (sourceStart + visibleSourceDuration) / mediaDuration!, sampleCount)
              : [];
          } else {
            buckets = await getNativeWaveformData(cacheKey, {
              path: normalizePathForTauriInvoke(audioPath),
              numBuckets: sampleCount,
              startTime: sourceStart,
              duration: visibleSourceDuration || duration,
            });
          }

          if (!isCancelled && buckets && buckets.length > 0) {
            setWaveformData(buckets);
            setIsLoading(false);
            return;
          }
        } catch {}

        try {
          const canUseSourceCache = Number.isFinite(mediaDuration) && mediaDuration! > 0;
          const browserCacheKey = canUseSourceCache ? sourceCacheKey : cacheKey;
          const buckets = await getBrowserWaveformData(browserCacheKey, {
            url: resolvedPath,
            sourceStart,
            visibleDuration: visibleSourceDuration,
            bucketCount: sampleCount,
            sourceDuration: canUseSourceCache ? mediaDuration : undefined,
            sourceBucketCount: WAVEFORM_SOURCE_BUCKETS,
          });

          if (!isCancelled) {
            setWaveformData(buckets);
            setIsLoading(false);
          }
        } catch {
          throw new Error("Browser waveform fallback failed");
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
