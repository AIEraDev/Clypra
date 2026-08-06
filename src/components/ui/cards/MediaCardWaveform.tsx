import React, { useRef, useEffect, useState } from "react";
import { drawProfessionalWaveform, convertLegacyWaveform, getThemeAccentRgb } from "@/lib/utils/canvasUtils";
import type { WaveformBucket } from "@/types";

interface MediaCardWaveformProps {
  audioPath: string;
  duration: number;
  className?: string;
}

// Compact waveform visualization for audio files in media cards
// Generates a static waveform preview using Web Audio API
export const MediaCardWaveform: React.FC<MediaCardWaveformProps> = ({ audioPath, duration, className = "" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [waveformData, setWaveformData] = useState<WaveformBucket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [themeRevision, setThemeRevision] = useState(0);

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

  // Generate waveform data from audio file
  useEffect(() => {
    let isCancelled = false;

    const generateWaveform = async () => {
      try {
        setIsLoading(true);
        setHasError(false);

        // Create audio context
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();

        // Fetch and decode audio
        const response = await fetch(audioPath);

        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        if (isCancelled) {
          audioContext.close();
          return;
        }

        // Get channel data (use first channel for mono/stereo)
        const channelData = audioBuffer.getChannelData(0);
        const samples = 100; // Number of bars to display
        const blockSize = Math.floor(channelData.length / samples);
        const waveform: number[] = [];

        // Calculate RMS (Root Mean Square) for each block
        for (let i = 0; i < samples; i++) {
          const start = i * blockSize;
          const end = start + blockSize;
          let sum = 0;

          for (let j = start; j < end && j < channelData.length; j++) {
            sum += channelData[j] * channelData[j];
          }

          const rms = Math.sqrt(sum / blockSize);
          waveform.push(rms);
        }

        // Normalize waveform data
        const max = Math.max(...waveform);
        const normalized = waveform.map((v) => (max > 0 ? v / max : 0));

        // Convert to peak + RMS format
        const buckets = convertLegacyWaveform(normalized);

        if (!isCancelled) {
          setWaveformData(buckets);
          setIsLoading(false);
        }

        audioContext.close();
      } catch (error) {
        console.error("[MediaCardWaveform] Failed to generate waveform for:", audioPath, error);
        // Show flat line pattern to indicate unsupported format (honest UX)
        if (!isCancelled) {
          // Flat line with very minimal variation to clearly indicate "no real data"
          const flatLine = Array.from({ length: 100 }, () => 0.15);
          const buckets = convertLegacyWaveform(flatLine);
          setWaveformData(buckets);
          setHasError(true);
          setIsLoading(false);
        }
      }
    };

    generateWaveform();

    return () => {
      isCancelled = true;
    };
  }, [audioPath]);

  // Draw professional waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Read theme accent color
    const accentRgb = getThemeAccentRgb();
    const color = `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, 0.85)`;

    // Use professional dense bar renderer with logical dimensions
    drawProfessionalWaveform(canvas, waveformData, color, rect.width, rect.height);
  }, [waveformData, themeRevision]);

  return (
    <div className={`relative w-full h-full flex flex-col items-center justify-center ${className}`}>
      {/* Waveform canvas */}
      <canvas ref={canvasRef} className="w-full h-full" style={{ display: isLoading ? "none" : "block" }} />

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="w-1 h-8 bg-cyan-400/30 rounded-full animate-pulse" style={{ animationDelay: `${i * 100}ms` }} />
            ))}
          </div>
        </div>
      )}

      {/* Error indicator - honest signal that waveform is unavailable */}
      {hasError && !isLoading && (
        <div className="absolute bottom-1 left-1 bg-text-muted/20 px-1.5 py-0.5 rounded text-[9px] text-text-muted/70" title="Waveform unavailable for this format">
          No waveform
        </div>
      )}
    </div>
  );
};
