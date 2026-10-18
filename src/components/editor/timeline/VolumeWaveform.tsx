import React, { useEffect, useRef } from "react";
import type { AudioFadeCurve, AudioKeyframe } from "@/types";
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
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/**
 * Produces a centered waveform pipe. A timeline waveform represents source
 * energy, not a level meter: symmetric peaks make quiet and loud regions
 * readable at a glance and remain balanced when the lane grows taller.
 */
export function getWaveformPipeGeometry(
  peak: number,
  rms: number,
  maxPeak: number,
  envelopeVolume: number,
  height: number,
): { top: number; height: number } | null {
  if (envelopeVolume <= 0.001 || height <= 0) return null;
  const normalizedPeak = maxPeak > 0 ? clamp(peak, 0, 1) / maxPeak : 0;
  // RMS gives quiet passages a stable visual body while peak retains transients.
  const sourceAmplitude = Math.max(
    Math.pow(normalizedPeak, 0.58),
    Math.pow(clamp(rms, 0, 1), 0.7) * 0.38,
  );
  const pipeHeight = Math.min(
    height,
    Math.max(envelopeVolume > 0.01 ? 1.25 : 0, sourceAmplitude * envelopeVolume * height * 0.9),
  );
  return { top: (height - pipeHeight) / 2, height: pipeHeight };
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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { waveformData, isLoading, hasError } = useWaveformData({
    audioPath,
    clipWidthPx,
    duration,
    mediaDuration,
    trimIn,
    trimOut,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, clipWidthPx);
    const height = Math.max(8, heightPx);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = getVisibleWaveColor();

    const sortedKeyframes = [...volumeKeyframes].sort(
      (a, b) => a.time - b.time,
    );
    const bucketWidth = width / waveformData.length;
    // Keep each pipe below 1 CSS px where the device pixel ratio allows it.
    // This creates the fine vertical strokes and gaps seen in professional NLEs
    // instead of merging adjacent samples into a filled waveform block.
    const requestedPipeWidth = Math.min(0.75, bucketWidth * 0.4);
    const pipeWidth =
      Math.max(1, Math.round(requestedPipeWidth * dpr)) / dpr;
    // Fit the source shape to the lane. Some native extractors return raw
    // peaks instead of a clip-normalized range, which otherwise makes every
    // pipe occupy only a few pixels even at 100% volume.
    let maxPeak = 0;
    for (const bucket of waveformData) {
      maxPeak = Math.max(maxPeak, clamp(bucket.peak, 0, 1));
    }

    waveformData.forEach((bucket, index) => {
      const time =
        waveformData.length > 1
          ? (index / (waveformData.length - 1)) * Math.max(0, duration)
          : 0;
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
      if (envelopeVolume <= 0.001) return;

      const geometry = getWaveformPipeGeometry(
        bucket.peak,
        bucket.rms,
        maxPeak,
        envelopeVolume,
        height,
      );
      if (!geometry) return;
      const center = index * bucketWidth + bucketWidth / 2;
      // Snap the pipe to the device-pixel grid so it stays sharp at 1x and
      // high-DPI displays alike.
      const x = Math.round((center - pipeWidth / 2) * dpr) / dpr;
      ctx.fillRect(x, geometry.top, pipeWidth, geometry.height);
    });
  }, [
    waveformData,
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
  ]);

  if (hasError) {
    return (
      <div
        className={`h-full w-full bg-surface-raised/30 ${className}`}
        title="Waveform unavailable"
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full items-center">
      {isLoading && (
        <div className="absolute inset-0 animate-pulse bg-clypra-clip-waveform-bg/60" />
      )}
      <canvas
        ref={canvasRef}
        data-testid="volume-waveform-canvas"
        className={`block h-full w-full ${className}`}
        style={{ minHeight: heightPx, opacity: (isLoading && waveformData.length === 0) ? 0 : 1 }}
      />
    </div>
  );
};
