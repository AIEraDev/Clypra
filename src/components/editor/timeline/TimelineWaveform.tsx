import React, { useRef, useEffect, useState } from "react";
import { platform } from "@/core/platform";
import { drawProfessionalWaveform, convertLegacyWaveform, getThemeAccentRgb, hexToRgb } from "@/lib/canvasUtils";
import type { WaveformBucket } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { normalizePathForTauriInvoke } from "@/lib/tauri";

interface TimelineWaveformProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  className?: string;
}

const waveformCache = new Map<string, WaveformBucket[]>();

export const TimelineWaveform: React.FC<TimelineWaveformProps> = ({ audioPath, clipWidthPx, duration, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformBucket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [themeRevision, setThemeRevision] = useState(0);

  // Calculate optimal sample count based on clip width
  // Professional NLE behavior: more zoom = more detail
  const validClipWidth = typeof clipWidthPx === "number" && !isNaN(clipWidthPx) ? clipWidthPx : 300;
  const sampleCount = Math.min(Math.max(Math.floor(validClipWidth / 1.5), 200), 2000);

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

  // Decode audio and generate waveform data
  useEffect(() => {
    const resolvedPath = audioPath.startsWith("asset://") ? audioPath : platform.convertFileSrc(audioPath);

    // Create cache key that includes sample count for zoom-responsive caching
    const cacheKey = `${resolvedPath}:${sampleCount}`;

    // Check cache first
    if (waveformCache.has(cacheKey)) {
      setWaveformData(waveformCache.get(cacheKey)!);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;

    const generateWaveform = async () => {
      try {
        setIsLoading(true);

        // Try Rust backend first (professional peak + RMS extraction)
        try {
          // Convert asset:// protocol back to file path for Rust
          const filePath = normalizePathForTauriInvoke(audioPath);

          const buckets = await invoke<WaveformBucket[]>("extract_waveform_data", {
            path: filePath,
            numBuckets: sampleCount,
          });

          if (!isCancelled && buckets && buckets.length > 0) {
            waveformCache.set(cacheKey, buckets);
            setWaveformData(buckets);
            setIsLoading(false);
            return;
          }
        } catch (rustError) {
          console.warn("[TimelineWaveform] Rust extraction failed, falling back to Web Audio API:", rustError);
        }

        // Fallback: Web Audio API (legacy RMS-only path)
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();

        const response = await fetch(resolvedPath);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        if (isCancelled) {
          audioContext.close();
          return;
        }

        const channelData = audioBuffer.getChannelData(0);
        const samples = sampleCount;
        const blockSize = Math.floor(channelData.length / samples);
        const rmsOnly: number[] = [];

        // Calculate RMS for each block
        for (let i = 0; i < samples; i++) {
          const start = i * blockSize;
          const end = start + blockSize;
          let sum = 0;
          for (let j = start; j < end && j < channelData.length; j++) {
            sum += channelData[j] * channelData[j];
          }
          const rms = Math.sqrt(sum / blockSize);
          rmsOnly.push(rms);
        }

        const max = Math.max(...rmsOnly);
        const normalized = rmsOnly.map((v) => (max > 0 ? v / max : 0));

        // Convert legacy RMS to peak + RMS format
        const buckets = convertLegacyWaveform(normalized);

        if (!isCancelled) {
          waveformCache.set(cacheKey, buckets);
          setWaveformData(buckets);
          setIsLoading(false);
        }

        audioContext.close();
      } catch (error) {
        console.error("[TimelineWaveform] Failed to generate waveform:", error);
        // Generate fallback pattern with peak + RMS
        if (!isCancelled) {
          const fallback: WaveformBucket[] = Array.from({ length: sampleCount }, (_, i) => {
            const seed = Math.sin(i * 0.15) * 0.5 + 0.5;
            const rms = seed * (0.3 + Math.random() * 0.7);
            return {
              rms,
              peak: Math.min(1.0, rms / 0.85),
            };
          });
          waveformCache.set(cacheKey, fallback);
          setWaveformData(fallback);
          setIsLoading(false);
        }
      }
    };

    generateWaveform();

    return () => {
      isCancelled = true;
    };
  }, [audioPath, sampleCount]);

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
