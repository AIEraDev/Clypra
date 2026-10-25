import React, { useEffect, useRef } from "react";
import type { AudioFadeCurve, AudioKeyframe, WaveformBucket } from "@/types";
import { evaluateAudioKeyframes, evaluateFadeCurve } from "@/core/audio/effectiveAudioState";
import { useWaveformData } from "./useWaveformData";

interface VolumeWaveformProps {
  audioPath: string;
  clipWidthPx: number;
  duration: number;
  mediaDuration?: number;
  trimIn?: number;
  trimOut?: number;
  volume?: number;
  volumeKeyframes?: AudioKeyframe[];
  fadeIn?: number;
  fadeOut?: number;
  fadeInCurve?: AudioFadeCurve;
  fadeOutCurve?: AudioFadeCurve;
  /** Keep the source waveform stable; the fade is rendered by the overlay. */
  applyFadeToWaveform?: boolean;
  heightPx?: number;
  className?: string;
  /** Alignment of waveform pipes: 'center' (symmetric) or 'bottom' (unidirectional from baseline). Defaults to 'bottom'. */
  alignment?: "center" | "bottom";
  /** Maximum fraction of height the tallest pipe can reach (e.g. 0.65 leaves 35% headroom). */
  maxHeightFraction?: number;
  /** Optional wave fill color override. Defaults to --clypra-clip-audio-wave. */
  waveColor?: string;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Produces waveform pipe geometry.
 * Supports symmetric centered pipes and bottom-anchored unidirectional bars.
 */
export function getWaveformPipeGeometry(
  peak: number,
  rms: number,
  maxPeak: number,
  envelopeVolume: number,
  height: number,
  alignment: "center" | "bottom" = "bottom",
  maxHeightFraction?: number,
): { top: number; height: number } | null {
  if (envelopeVolume <= 0.001 || height <= 0) return null;
  const normalizedPeak = maxPeak > 0 ? clamp(peak, 0, 1) / maxPeak : 0;
  // RMS gives quiet passages a stable visual body while peak retains transients.
  const sourceAmplitude = Math.max(
    Math.pow(normalizedPeak, 0.58),
    Math.pow(clamp(rms, 0, 1), 0.7) * 0.38,
  );
  const fraction =
    maxHeightFraction ?? (alignment === "bottom" ? (height <= 24 ? 0.85 : 0.65) : 0.9);
  const maxAvailableHeight = height * fraction;
  const pipeHeight = Math.min(
    maxAvailableHeight,
    Math.max(
      envelopeVolume > 0.01 ? 1.25 : 0,
      sourceAmplitude * envelopeVolume * maxAvailableHeight,
    ),
  );
  const top =
    alignment === "bottom"
      ? Math.max(0, height - pipeHeight - 1)
      : (height - pipeHeight) / 2;
  return { top, height: pipeHeight };
}

function getVisibleWaveColor(): string {
  if (typeof document !== "undefined") {
    const waveColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--clypra-clip-audio-wave")
      .trim();
    if (waveColor) return waveColor;
  }
  return "transparent";
}

export function getKeyframedVolume(
  keyframes: AudioKeyframe[],
  time: number,
  defaultVolume: number,
): number {
  return evaluateAudioKeyframes(keyframes, time, defaultVolume);
}

export function getEnvelopeVolume(
  time: number,
  duration: number,
  volume: number,
  keyframes: AudioKeyframe[],
  fadeIn: number,
  fadeOut: number,
  fadeInCurve: AudioFadeCurve = "linear",
  fadeOutCurve: AudioFadeCurve = "linear",
): number {
  let result = getKeyframedVolume(keyframes, time, volume);
  if (fadeIn > 0) result *= evaluateFadeCurve(time / fadeIn, fadeInCurve);
  if (fadeOut > 0) result *= evaluateFadeCurve((duration - time) / fadeOut, fadeOutCurve);
  return clamp(result, 0, 1);
}

/**
 * Compact, centered clip waveform whose height follows the current volume
 * envelope and source energy. Unlike a bottom-anchored level meter, it stays
 * visually balanced in both the small video-audio lane and full audio clips.
 */
export const VolumeWaveform: React.FC<VolumeWaveformProps> = ({
  audioPath,
  clipWidthPx,
  duration,
  mediaDuration,
  trimIn = 0,
  trimOut,
  volume = 1,
  volumeKeyframes = [],
  fadeIn = 0,
  fadeOut = 0,
  fadeInCurve = "linear",
  fadeOutCurve = "linear",
  applyFadeToWaveform = false,
  heightPx = 16,
  className = "",
  alignment = "bottom",
  maxHeightFraction,
  waveColor,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Filmstrip-tile pattern: retain previously committed waveform data so the
  // visual wave never flashes empty or disappears during zoom transitions or
  // background LOD queries.
  const committedWaveformRef = useRef<WaveformBucket[]>([]);
  const { waveformData, isLoading, hasError } = useWaveformData({
    audioPath,
    clipWidthPx,
    duration,
    mediaDuration,
    trimIn,
    trimOut,
  });

  if (waveformData && waveformData.length > 0) {
    committedWaveformRef.current = waveformData;
  }
  const activeData =
    waveformData.length > 0 ? waveformData : committedWaveformRef.current;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, clipWidthPx);
    const height = Math.max(8, heightPx);
    // Guard against GPU texture/canvas allocation limits at extreme zoom
    const maxDimension = 16384;
    const canvasWidth = Math.min(maxDimension, Math.ceil(width * dpr));
    const canvasHeight = Math.min(maxDimension, Math.ceil(height * dpr));
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const scaleX = canvasWidth / width;
    const scaleY = canvasHeight / height;
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = waveColor || getVisibleWaveColor();

    const sortedKeyframes = [...volumeKeyframes].sort(
      (a, b) => a.time - b.time,
    );

    // Modern NLE uniform visual frequency (CapCut standard):
    // Maintains clean ~2.8px bar pitch (1.8px bar + 1.0px gap) across any zoom level,
    // and ~2.0px pitch in mini centered lanes.
    const barPitchPx = alignment === "bottom" ? 2.8 : 2.0;
    const barWidthPx = alignment === "bottom" ? 1.8 : 1.0;
    const totalBars = Math.max(1, Math.round(width / barPitchPx));
    const actualBucketWidth = width / totalBars;
    const pipeWidth = Math.max(1, Math.round(barWidthPx * dpr)) / dpr;

    let maxPeak = 0;
    for (const bucket of activeData) {
      maxPeak = Math.max(maxPeak, clamp(bucket.peak, 0, 1));
    }

    for (let barIdx = 0; barIdx < totalBars; barIdx++) {
      const barFraction = totalBars > 1 ? barIdx / (totalBars - 1) : 0;
      const time = barFraction * Math.max(0, duration);
      const envelopeVolume = applyFadeToWaveform
        ? getEnvelopeVolume(
            time,
            duration,
            volume,
            sortedKeyframes,
            fadeIn,
            fadeOut,
            fadeInCurve,
            fadeOutCurve,
          )
        : getKeyframedVolume(sortedKeyframes, time, volume);
      if (envelopeVolume <= 0.001) continue;

      // Sample peak and RMS from activeData with smooth linear interpolation
      const dataPos = barFraction * (activeData.length - 1);
      const i0 = Math.floor(dataPos);
      const i1 = Math.min(activeData.length - 1, i0 + 1);
      const t = dataPos - i0;
      const b0 = activeData[i0] || { peak: 0, rms: 0 };
      const b1 = activeData[i1] || b0;
      const peak = (1 - t) * b0.peak + t * b1.peak;
      const rms = (1 - t) * b0.rms + t * b1.rms;

      const geometry = getWaveformPipeGeometry(
        peak,
        rms,
        maxPeak,
        envelopeVolume,
        height,
        alignment,
        maxHeightFraction,
      );
      if (!geometry) continue;

      const center = barIdx * actualBucketWidth + actualBucketWidth / 2;
      // Snap the pipe to the device-pixel grid so it stays sharp at 1x and
      // high-DPI displays alike.
      const x = Math.round((center - pipeWidth / 2) * dpr) / dpr;
      ctx.fillRect(x, geometry.top, pipeWidth, geometry.height);
    }
  }, [
    activeData,
    clipWidthPx,
    heightPx,
    volume,
    volumeKeyframes,
    fadeIn,
    fadeOut,
    fadeInCurve,
    fadeOutCurve,
    applyFadeToWaveform,
    duration,
    alignment,
    maxHeightFraction,
    waveColor,
  ]);

  if (hasError) {
    return (
      <div
        data-testid="clip-audio-empty"
        className={`h-full w-full opacity-35 flex items-center justify-center select-none pointer-events-none ${className}`}
        title="No audio"
        aria-label="No audio"
      >
        <div className="w-full h-px border-b border-dashed border-clypra-clip-fg/25" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full items-center">
      {isLoading && activeData.length === 0 && (
        <div
          data-testid="volume-waveform-loading"
          className="absolute inset-0 animate-pulse bg-clypra-clip-waveform-bg/80 flex items-center justify-center pointer-events-none"
        >
          <div className="w-full h-px bg-clypra-clip-waveform-border/60 animate-pulse" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        data-testid="volume-waveform-canvas"
        className={`block h-full w-full ${className}`}
        style={{ minHeight: heightPx, opacity: (isLoading && activeData.length === 0) ? 0 : 1 }}
      />
    </div>
  );
};
