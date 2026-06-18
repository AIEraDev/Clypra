import React, { useRef, useEffect, useState } from "react";
import { platform } from "@/core/platform";
import { drawProfessionalWaveform, getThemeAccentRgb } from "@/lib/utils/canvasUtils";
import { traceStart, traceEnd } from "@/lib/debug/performanceTrace";
import type { WaveformBucket } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { normalizePathForTauriInvoke } from "@/lib/platform/tauri";

interface TimelineWaveformProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  trimIn?: number;
  trimOut?: number;
  className?: string;
}

const waveformCache = new Map<string, WaveformBucket[]>();

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

  // Watch for theme changes on document element and trigger redraw
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeRevision((r) => r + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => observer.disconnect();
  }, []);

  // Decode audio and generate waveform data - SIMPLE SYNCHRONOUS APPROACH (same as MediaCardWaveform)
  useEffect(() => {
    // Create cache key that includes sample count for zoom-responsive caching
    const cacheKey = `${resolvedPath}:${sourceStart.toFixed(3)}:${sourceDuration.toFixed(3)}:${sampleCount}`;

    // Check cache first
    if (waveformCache.has(cacheKey)) {
      setWaveformData(waveformCache.get(cacheKey)!);
      setHasError(false);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const generateWaveform = async () => {
      try {
        traceStart("waveform-generation", {
          path: audioPath,
          sampleCount,
          duration: sourceDuration,
        });

        setIsLoading(true);
        setHasError(false);

        // Try Rust backend first (professional peak + RMS extraction)
        let rustTraceStarted = false;
        try {
          traceStart("waveform-rust-extract");
          rustTraceStarted = true;
          const filePath = normalizePathForTauriInvoke(audioPath);

          const buckets = await invoke<WaveformBucket[]>("extract_waveform_data", {
            path: filePath,
            numBuckets: sampleCount,
            startTime: sourceStart,
            duration: sourceDuration || duration,
          });

          traceEnd("waveform-rust-extract", { bucketCount: buckets?.length || 0 });

          if (!isCancelled && buckets && buckets.length > 0) {
            waveformCache.set(cacheKey, buckets);
            setWaveformData(buckets);
            setIsLoading(false);
            traceEnd("waveform-generation", { backend: "rust", success: true });
            return;
          }
        } catch (rustError) {
          if (rustTraceStarted) {
            traceEnd("waveform-rust-extract", { error: true });
          }
          console.warn("[TimelineWaveform] Rust extraction failed, using Web Audio API fallback:", rustError);
        }

        // ✅ FALLBACK: Simple Web Audio API (same as MediaCardWaveform - NO WORKER)
        traceStart("waveform-webaudio-decode");
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();

        const response = await fetch(resolvedPath);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        if (isCancelled) {
          audioContext.close();
          traceEnd("waveform-webaudio-decode", { cancelled: true });
          return;
        }

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

        // Normalize
        const maxPeak = Math.max(...buckets.map((b) => b.peak));
        const maxRms = Math.max(...buckets.map((b) => b.rms));

        if (maxPeak > 0) {
          buckets.forEach((bucket) => {
            bucket.peak = bucket.peak / maxPeak;
          });
        }

        if (maxRms > 0) {
          buckets.forEach((bucket) => {
            bucket.rms = bucket.rms / maxRms;
          });
        }

        audioContext.close();
        traceEnd("waveform-webaudio-decode", { bucketCount: buckets.length });

        if (!isCancelled) {
          waveformCache.set(cacheKey, buckets);
          setWaveformData(buckets);
          setIsLoading(false);
        }

        traceEnd("waveform-generation", { backend: "webaudio", success: true });
      } catch (error) {
        console.error("[TimelineWaveform] Failed to generate waveform:", error);
        if (!isCancelled) {
          setWaveformData([]);
          setHasError(true);
          setIsLoading(false);
        }
        traceEnd("waveform-generation", { error: true });
      }
    };

    generateWaveform();

    return () => {
      isCancelled = true;
    };
  }, [resolvedPath, sampleCount, sourceStart, sourceDuration, duration, audioPath]);

  // Draw professional waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Read theme accent color
    const accentRgb = getThemeAccentRgb();
    const color = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.95)`;

    // Use professional dense bar renderer with logical dimensions
    drawProfessionalWaveform(canvas, waveformData, color, rect.width, rect.height);
  }, [waveformData, themeRevision]);

  if (hasError) {
    return <div className={`w-full h-full rounded-[2px] border border-border/30 bg-surface-raised/30 ${className}`} title="Waveform unavailable" />;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full block ${className}`}
      style={{
        opacity: isLoading ? 0.3 : 1,
        transition: "opacity 150ms ease",
      }}
    />
  );
};
