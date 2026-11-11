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
import { AudioFXSection } from "../sections/AudioFXSection";

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
  const hasPrevVolumeKf = volumeKeyframes.some(
    (k) => k.time < localTime - 0.05,
  );
  const hasNextVolumeKf = volumeKeyframes.some(
    (k) => k.time > localTime + 0.05,
  );

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
        time: Math.round(localTime * 100) / 100,
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

  /**
   * Volume change handler — keyframe-aware.
   *
   * When volume keyframes exist on the clip, scrubbing the volume slider updates
   * the keyframe at the current playhead position (creating one if none exists
   * there). Without keyframes the plain `volume` property is written directly.
   */
  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      const clampedVolume = Math.max(0, Math.min(100, newVolume));
      const gain = clampedVolume / 100;

      if (volumeKeyframes.length === 0) {
        // No keyframes – simple update
        handleUpdate("volume", gain);
        return;
      }

      const existingIdx = volumeKeyframes.findIndex(
        (kf) => Math.abs(kf.time - localTime) < 0.08,
      );

      if (existingIdx >= 0) {
        // Update the gain of the existing keyframe at the playhead
        const nextKfs = [...volumeKeyframes];
        nextKfs[existingIdx] = { ...nextKfs[existingIdx], gain };
        handleUpdate("volumeKeyframes", nextKfs);
      } else {
        // Insert a new keyframe at the current playhead
        const nextKfs = [
          ...volumeKeyframes,
          {
            id: `vol-kf-${Date.now()}`,
            time: Math.round(localTime * 100) / 100,
            gain,
          },
        ].sort((a, b) => a.time - b.time);
        handleUpdate("volumeKeyframes", nextKfs);
      }
    },
    [volumeKeyframes, localTime, handleUpdate],
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
    <div className="space-y-4 px-3 py-2">
      {/* Volume */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">Volume</label>
          <button
            type="button"
            onClick={handleResetVolume}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
            title="Reset volume"
            aria-label="Reset volume"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex items-center">
          <SliderTrack
            value={volumePercent}
            min={0}
            max={100}
            step={1}
            propertyId="volume"
            category="audio"
            onChange={handleVolumeChange}
            className="mr-4"
          />
          <NumericControl
            value={volumePercent}
            onChange={handleVolumeChange}
            step={1}
            min={0}
            max={100}
            suffix="%"
            inputWidth="w-8"
            inputPosition="text-right"
            decimals={0}
            ariaLabel="Volume"
            propertyId="volume"
            category="audio"
          />
          <button
            type="button"
            onClick={toggleMute}
            className={`flex items-center justify-center w-6 h-6 rounded transition-all cursor-pointer ml-1 ${
              isMuted
                ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                : "bg-white/5 hover:bg-white/10 text-white/50 hover:text-white"
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
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">Fade in</label>
          <button
            type="button"
            onClick={handleResetFadeIn}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
            title="Reset fade in"
            aria-label="Reset fade in"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex items-center">
          <SliderTrack
            value={fadeIn}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            propertyId="fadeIn"
            category="audio"
            onChange={handleFadeInChange}
            className="mr-4"
          />
          <NumericControl
            value={fadeIn}
            onChange={handleFadeInChange}
            step={0.01}
            min={0}
            max={maxFadeSeconds}
            suffix="s"
            inputWidth="w-6"
            inputPosition="text-right"
            decimals={1}
            ariaLabel="Fade in"
            propertyId="fadeIn"
            category="audio"
          />
          <KeyframeNavControls
            hasKeyframes={false}
            isAtKeyframe={false}
            hasPrev={false}
            hasNext={false}
            onToggleKeyframe={() => {}}
            onPrevKeyframe={() => {}}
            onNextKeyframe={() => {}}
            label="Fade in"
          />
        </div>
      </div>

      {/* Fade out */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">
            Fade out
          </label>
          <button
            type="button"
            onClick={handleResetFadeOut}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
            title="Reset fade out"
            aria-label="Reset fade out"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex items-center">
          <SliderTrack
            value={fadeOut}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            propertyId="fadeOut"
            category="audio"
            onChange={handleFadeOutChange}
            className="mr-4"
          />
          <NumericControl
            value={fadeOut}
            onChange={handleFadeOutChange}
            step={0.01}
            min={0}
            max={maxFadeSeconds}
            suffix="s"
            inputWidth="w-6"
            inputPosition="text-right"
            decimals={1}
            ariaLabel="Fade out"
            propertyId="fadeOut"
            category="audio"
          />
          <KeyframeNavControls
            hasKeyframes={false}
            isAtKeyframe={false}
            hasPrev={false}
            hasNext={false}
            onToggleKeyframe={() => {}}
            onPrevKeyframe={() => {}}
            onNextKeyframe={() => {}}
            label="Fade out"
          />
        </div>
      </div>

      {/* Pan */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">Pan</label>
          <button
            type="button"
            onClick={handleResetPan}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors cursor-pointer"
            title="Reset pan"
            aria-label="Reset pan"
          >
            <RotateCcw className="w-2.5 h-2.5" />
          </button>
        </div>
        <div className="flex items-center">
          <div className="relative flex-1 mr-4">
            <SliderTrack
              value={panPercent}
              min={-100}
              max={100}
              step={1}
              propertyId="pan"
              category="audio"
              snapPoints={[{ value: 0, threshold: 2 }]}
              onChange={(val) => handlePanChange(val / 100)}
            />
            {/* Center tick at pan = 0 */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/40 pointer-events-none"
              style={{ left: "50%" }}
            />
          </div>
          <NumericControl
            value={panPercent}
            onChange={(val) => handlePanChange(val / 100)}
            step={1}
            min={-100}
            max={100}
            suffix="%"
            inputWidth="w-8"
            inputPosition="text-right"
            decimals={0}
            ariaLabel="Pan"
            propertyId="pan"
            category="audio"
          />
          <KeyframeNavControls
            hasKeyframes={false}
            isAtKeyframe={false}
            hasPrev={false}
            hasNext={false}
            onToggleKeyframe={() => {}}
            onPrevKeyframe={() => {}}
            onNextKeyframe={() => {}}
            label="Pan"
          />
        </div>
      </div>

      {/* Audio FX Section */}
      <AudioFXSection selectedClip={selectedClip} handleUpdate={handleUpdate} />
    </div>
  );
};
