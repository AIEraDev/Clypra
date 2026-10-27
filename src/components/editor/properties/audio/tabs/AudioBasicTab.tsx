/**
 * AudioBasicTab.tsx
 *
 * Basic audio properties for audio clips: Volume, Fade in, Fade out, and Pan/Balance.
 * Uses standard SliderTrack + NumericControl + KeyframeNavControls pattern.
 */

import React, { useCallback } from "react";
import { Volume2, VolumeX, RotateCcw } from "lucide-react";
import type { Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";

interface AudioBasicTabProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const AudioBasicTab: React.FC<AudioBasicTabProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const audio = getClipAudioProperties(selectedClip);
  const volume = audio.muted ? 0 : dbToLinearGain(audio.gainDb);
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const isMuted = audio.muted;

  const maxFadeSeconds = Math.max(0, Math.min(5, selectedClip.duration));
  const clampFade = useCallback(
    (value: number) =>
      Math.max(0, Math.min(maxFadeSeconds, Number.isFinite(value) ? value : 0)),
    [maxFadeSeconds],
  );

  const fadeIn = clampFade(audio.fadeIn.duration);
  const fadeOut = clampFade(audio.fadeOut.duration);
  const pan = audio.pan ?? 0;
  const panPercent = Math.round(pan * 100);

  // ── Volume Keyframe State & Handlers ─────────────────────────────────────
  const volumeKeyframes = audio.volumeKeyframes || [];
  const currentTime = getPlaybackClock().time;
  const localTime = Math.max(
    0,
    Math.min(selectedClip.duration, currentTime - selectedClip.startTime),
  );

  const isAtVolumeKf = volumeKeyframes.some(
    (k) => Math.abs(k.time - localTime) < 0.08,
  );
  const hasPrevVolumeKf = volumeKeyframes.some((k) => k.time < localTime - 0.05);
  const hasNextVolumeKf = volumeKeyframes.some((k) => k.time > localTime + 0.05);

  const handleToggleVolumeKeyframe = useCallback(() => {
    const existing = volumeKeyframes.find(
      (k) => Math.abs(k.time - localTime) < 0.08,
    );
    if (existing) {
      const updated = volumeKeyframes.filter((k) => k.id !== existing.id);
      handleUpdate("volumeKeyframes", updated);
    } else {
      const newKf = {
        id: `vol-kf-${Date.now()}`,
        time: localTime,
        gain: volume,
      };
      const updated = [...volumeKeyframes, newKf].sort(
        (a, b) => a.time - b.time,
      );
      handleUpdate("volumeKeyframes", updated);
    }
  }, [volumeKeyframes, localTime, volume, handleUpdate]);

  const handleJumpToVolumeKeyframe = useCallback(
    (direction: "prev" | "next") => {
      const sorted = [...volumeKeyframes].sort((a, b) => a.time - b.time);
      let target: number | undefined;
      if (direction === "prev") {
        const candidates = sorted.filter((k) => k.time < localTime - 0.05);
        target =
          candidates.length > 0
            ? candidates[candidates.length - 1].time
            : undefined;
      } else {
        const candidates = sorted.filter((k) => k.time > localTime + 0.05);
        target = candidates.length > 0 ? candidates[0].time : undefined;
      }
      if (target !== undefined) {
        getPlaybackClock().seek(selectedClip.startTime + target);
      }
    },
    [volumeKeyframes, localTime, selectedClip.startTime],
  );

  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      const clampedVolume = Math.max(0, Math.min(100, newVolume));
      handleUpdate("volume", clampedVolume / 100);
    },
    [handleUpdate],
  );

  const toggleMute = useCallback(() => {
    handleUpdate("volume", isMuted ? 1.0 : 0);
  }, [handleUpdate, isMuted]);

  const handleFadeInChange = useCallback(
    (value: number) => {
      handleUpdate("fadeIn", clampFade(value));
    },
    [handleUpdate, clampFade],
  );

  const handleFadeOutChange = useCallback(
    (value: number) => {
      handleUpdate("fadeOut", clampFade(value));
    },
    [handleUpdate, clampFade],
  );

  const handlePanChange = useCallback(
    (val: number) => {
      const clamped = Math.max(-1, Math.min(1, val));
      handleUpdate("pan", clamped);
    },
    [handleUpdate],
  );

  const handleResetVolume = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "reset-volume",
      category: "audio",
      property: "volume",
    });
    handleUpdate("volume", 1.0);
  }, [handleUpdate]);

  const handleResetFadeIn = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "reset-fade-in",
      category: "audio",
      property: "fadeIn",
    });
    handleUpdate("fadeIn", 0);
  }, [handleUpdate]);

  const handleResetFadeOut = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "reset-fade-out",
      category: "audio",
      property: "fadeOut",
    });
    handleUpdate("fadeOut", 0);
  }, [handleUpdate]);

  const handleResetPan = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "reset-pan",
      category: "audio",
      property: "pan",
    });
    handlePanChange(0);
  }, [handlePanChange]);

  return (
    <div className="space-y-4 p-3">
      {/* Volume */}
      <div className="flex items-center gap-3">
        <div className="min-w-[80px] flex items-center justify-between">
          <label className="text-sm text-white/80">Volume</label>
          <button
            type="button"
            onClick={handleResetVolume}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer mr-1"
            title="Reset volume"
            aria-label="Reset volume"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={volumePercent}
            min={0}
            max={100}
            step={1}
            propertyId="volume"
            category="audio"
            onChange={handleVolumeChange}
          />
          <NumericControl
            value={volumePercent}
            onChange={handleVolumeChange}
            step={1}
            min={0}
            max={100}
            suffix="%"
            inputWidth="w-16"
            decimals={0}
            ariaLabel="Volume"
            propertyId="volume"
            category="audio"
          />
          <button
            type="button"
            onClick={toggleMute}
            className={`flex items-center justify-center w-6 h-6 rounded transition-all cursor-pointer ${
              isMuted
                ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                : "bg-white/5 hover:bg-white/10 text-cyan-400"
            }`}
            title={isMuted ? "Unmute" : "Mute"}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
          <KeyframeNavControls
            hasKeyframes={volumeKeyframes.length > 0}
            isAtKeyframe={isAtVolumeKf}
            onToggleKeyframe={handleToggleVolumeKeyframe}
            onPrevKeyframe={() => handleJumpToVolumeKeyframe("prev")}
            onNextKeyframe={() => handleJumpToVolumeKeyframe("next")}
            hasPrev={hasPrevVolumeKf}
            hasNext={hasNextVolumeKf}
            label="Volume"
          />
        </div>
      </div>

      {/* Fade in */}
      <div className="flex items-center gap-3">
        <div className="min-w-[80px] flex items-center justify-between">
          <label className="text-sm text-white/80">Fade in</label>
          <button
            type="button"
            onClick={handleResetFadeIn}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer mr-1"
            title="Reset fade in"
            aria-label="Reset fade in"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={fadeIn}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            propertyId="fadeIn"
            category="audio"
            onChange={handleFadeInChange}
          />
          <NumericControl
            value={fadeIn}
            onChange={handleFadeInChange}
            step={0.01}
            min={0}
            max={maxFadeSeconds}
            suffix="s"
            inputWidth="w-16"
            decimals={2}
            ariaLabel="Fade in"
            propertyId="fadeIn"
            category="audio"
          />
        </div>
      </div>

      {/* Fade out */}
      <div className="flex items-center gap-3">
        <div className="min-w-[80px] flex items-center justify-between">
          <label className="text-sm text-white/80">Fade out</label>
          <button
            type="button"
            onClick={handleResetFadeOut}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer mr-1"
            title="Reset fade out"
            aria-label="Reset fade out"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={fadeOut}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            propertyId="fadeOut"
            category="audio"
            onChange={handleFadeOutChange}
          />
          <NumericControl
            value={fadeOut}
            onChange={handleFadeOutChange}
            step={0.01}
            min={0}
            max={maxFadeSeconds}
            suffix="s"
            inputWidth="w-16"
            decimals={2}
            ariaLabel="Fade out"
            propertyId="fadeOut"
            category="audio"
          />
        </div>
      </div>

      {/* Pan / Balance */}
      <div className="flex items-center gap-3">
        <div className="min-w-[80px] flex items-center justify-between">
          <label className="text-sm text-white/80">Pan</label>
          <button
            type="button"
            onClick={handleResetPan}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer mr-1"
            title="Reset pan"
            aria-label="Reset pan"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={panPercent}
            min={-100}
            max={100}
            step={1}
            propertyId="pan"
            category="audio"
            onChange={(val) => handlePanChange(val / 100)}
          />
          <NumericControl
            value={panPercent}
            onChange={(val) => handlePanChange(val / 100)}
            step={1}
            min={-100}
            max={100}
            suffix="%"
            inputWidth="w-16"
            decimals={0}
            ariaLabel="Pan"
            propertyId="pan"
            category="audio"
          />
        </div>
      </div>
    </div>
  );
};
