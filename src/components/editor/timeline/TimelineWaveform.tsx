import React, { useRef, useEffect, useState } from "react";
import { platform } from "@/core/platform";
import { drawProfessionalWaveform, getThemeAccentRgb } from "@/lib/utils/canvasUtils";
import type { WaveformBucket } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { normalizePathForTauriInvoke } from "@/lib/platform/tauri";
import { t } from "@/i18n";

interface TimelineWaveformProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  trimIn?: number;
  trimOut?: number;
  className?: string;
}

// ── LRU waveform cache (BUG-1 fix: bounded eviction prevents memory leak) ──
const WAVEFORM_CACHE_MAX = 50;
const waveformCache = new Map<string, WaveformBucket[]>();

function waveformCacheSet(key: string, value: WaveformBucket[]): void {
  // Delete-then-set to move key to the "newest" position
  waveformCache.delete(key);
  waveformCache.set(key, value);
  // Evict oldest entries (Map iteration order = insertion order)
  if (waveformCache.size > WAVEFORM_CACHE_MAX) {
    const oldest = waveformCache.keys().next().value;
    if (oldest !== undefined) waveformCache.delete(oldest);
  }
}

function waveformCacheGet(key: string): WaveformBucket[] | undefined {
  const value = waveformCache.get(key);
  if (value !== undefined) {
    // Move to newest position on access (LRU)
    waveformCache.delete(key);
    waveformCache.set(key, value);
  }
  return value;
}

// ── Shared theme-change observer (PERF-7 fix: single observer, not N per clip) ──
type ThemeListener = () => void;
const themeListeners = new Set<ThemeListener>();
let sharedThemeObserver: MutationObserver | null = null;

function subscribeToThemeChanges(listener: ThemeListener): () => void {
  themeListeners.add(listener);
  if (!sharedThemeObserver) {
    sharedThemeObserver = new MutationObserver(() => {
      themeListeners.forEach((fn) => fn());
    });
    sharedThemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0 && sharedThemeObserver) {
      sharedThemeObserver.disconnect();
      sharedThemeObserver = null;
    }
  };
}

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({ audioPath, clipWidthPx, duration, trimIn = 0, trimOut, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformBucket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [themeRevision, setThemeRevision] = useState(0);

  // Calculate optimal sample count based on clip width
  // Professional NLE behavior: more zoom = more detail
  const validClipWidth = typeof clipWidthPx === "number" && !isNaN(clipWidthPx) ? clipWidthPx : 300;
  const sampleCount = Math.min(Math.max(Math.floor(validClipWidth / 1.5), 200), 2000);
  const sourceStart = Math.max(0, Number.isFinite(trimIn) ? trimIn : 0);
  const sourceDuration = Math.max(0, Math.min(duration, (Number.isFinite(trimOut) ? trimOut! : sourceStart + duration) - sourceStart));

  // Resolve path once
  const resolvedPath = audioPath.startsWith("asset://") ? audioPath : platform.convertFileSrc(audioPath);

  // Watch for theme changes via shared observer (PERF-7 fix)
  useEffect(() => {
    return subscribeToThemeChanges(() => setThemeRevision((r) => r + 1));
  }, []);

  // Decode audio and generate waveform data - SIMPLE SYNCHRONOUS APPROACH (same as MediaCardWaveform)
  useEffect(() => {
    // Create cache key that includes sample count for zoom-responsive caching
    const cacheKey = `${resolvedPath}:${sourceStart.toFixed(3)}:${sourceDuration.toFixed(3)}:${sampleCount}`;

    // Check LRU cache first
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

        // Try Rust backend first (professional peak + RMS extraction)
        let rustTraceStarted = false;
        try {
          rustTraceStarted = true;
          const filePath = normalizePathForTauriInvoke(audioPath);

          const buckets = await invoke<WaveformBucket[]>("extract_waveform_data", {
            path: filePath,
            numBuckets: sampleCount,
            startTime: sourceStart,
            duration: sourceDuration || duration,
          });

          if (!isCancelled && buckets && buckets.length > 0) {
            waveformCacheSet(cacheKey, buckets);
            setWaveformData(buckets);
            setIsLoading(false);
            return;
          }
        } catch (rustError) {
          console.warn("[TimelineWaveform] Rust extraction failed, using Web Audio API fallback:", rustError);
        }

        // ✅ FALLBACK: Simple Web Audio API (same as MediaCardWaveform - NO WORKER)
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();

        // BUG-2 fix: ensure AudioContext is always closed, even on error
        try {
          const response = await fetch(resolvedPath);
          if (!response.ok) {
            throw new Error(`Failed to fetch audio: ${response.status}`);
          }

          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          if (isCancelled) return;

          // Extract channel data
          const channelData = audioBuffer.getChannelData(0);
          const sampleRate = audioBuffer.sampleRate;

          // Calculate sample range
          const startSample = Math.max(0, Math.floor(sourceStart * sampleRate));
          const endSample = Math.min(channelData.length, Math.floor((sourceStart + sourceDuration) * sampleRate));
          const visibleChannelData = channelData.subarray(startSample, endSample);

          // Generate waveform buckets
          const blockSize = Math.max(1, Math.floor(visibleChannelData.length / sampleCount));
          const buckets: WaveformBucket[] = [];

          for (let i = 0; i < sampleCount; i++) {
            const start = i * blockSize;
            const end = start + blockSize;

            let peak = 0;
            let sumSquares = 0;

            for (let j = start; j < end && j < visibleChannelData.length; j++) {
              const value = Math.abs(visibleChannelData[j]);
              peak = Math.max(peak, value);
              sumSquares += visibleChannelData[j] * visibleChannelData[j];
            }

            const rms = Math.sqrt(sumSquares / blockSize);
            buckets.push({ peak, rms });
          }

          // PERF-1 fix: single-pass normalization (avoids stack overflow from Math.max(...2000))
          let maxPeak = 0;
          let maxRms = 0;
          for (const b of buckets) {
            if (b.peak > maxPeak) maxPeak = b.peak;
            if (b.rms > maxRms) maxRms = b.rms;
          }
          if (maxPeak > 0 || maxRms > 0) {
            for (const b of buckets) {
              if (maxPeak > 0) b.peak /= maxPeak;
              if (maxRms > 0) b.rms /= maxRms;
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
      } catch (error) {
        console.error("[TimelineWaveform] Failed to generate waveform:", error);
        if (!isCancelled) {
          setWaveformData([]);
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    generateWaveform();

    return () => {
      isCancelled = true;
    };
  }, [resolvedPath, sampleCount, sourceStart, sourceDuration, duration, audioPath]);

  // Draw professional waveform on canvas
  // PERF-6 fix: use clipWidthPx instead of getBoundingClientRect to avoid forced reflow
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const logicalW = Math.max(1, validClipWidth);
    const logicalH = 40; // Match strip height
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    ctx.scale(dpr, dpr);

    // Read theme accent color
    const accentRgb = getThemeAccentRgb();
    const color = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.95)`;

    // Use professional dense bar renderer with logical dimensions
    drawProfessionalWaveform(canvas, waveformData, color, logicalW, logicalH);
  }, [waveformData, themeRevision, validClipWidth]);

  if (hasError) {
    return <div className={`w-full h-full rounded-[2px] border border-border/30 bg-surface-raised/30 ${className}`} title={t("timeline.waveform.unavailable")} />;
  }

  return (
    <div className="relative w-full h-full min-h-[36px] flex items-center">
      {isLoading && <div className={`absolute inset-0 rounded-[2px] bg-accent/10 animate-pulse border border-accent/20 ${className}`} />}
      <canvas
        ref={canvasRef}
        className={`w-full h-full block ${className}`}
        style={{
          opacity: isLoading ? 0 : 1,
          transition: "opacity 300ms ease-out",
        }}
      />
    </div>
  );
};
