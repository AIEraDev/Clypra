/**
 * AudioBasicTab.tsx
 *
 * Basic audio properties for audio clips: Volume, Fade in, Fade out.
 * Uses standard SliderTrack + NumericControl + KeyframeNavControls pattern.
 */

import React, { useState, useCallback } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";

interface AudioBasicTabProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const AudioBasicTab: React.FC<AudioBasicTabProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [volumeKeyframe, setVolumeKeyframe] = useState(false);
  const [fadeInKeyframe, setFadeInKeyframe] = useState(false);
  const [fadeOutKeyframe, setFadeOutKeyframe] = useState(false);

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

  return (
    <div className="space-y-4 p-3">
      {/* Volume */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-white/80 min-w-[80px]">Volume</label>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={volumePercent}
            min={0}
            max={100}
            step={1}
            onChange={handleVolumeChange}
          />
          <NumericControl
            value={volumePercent}
            onChange={handleVolumeChange}
            step={1}
            min={0}
            max={100}
            suffix="dB"
            inputWidth="w-16"
            decimals={0}
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
          >
            {isMuted ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
          </button>
          <KeyframeNavControls
            hasKeyframes={volumeKeyframe}
            isAtKeyframe={volumeKeyframe}
            onToggleKeyframe={() => setVolumeKeyframe(!volumeKeyframe)}
            onPrevKeyframe={() => {}}
            onNextKeyframe={() => {}}
            label="Volume"
          />
        </div>
      </div>

      {/* Fade in */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-white/80 min-w-[80px]">Fade in</label>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={fadeIn}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
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
          />
          <KeyframeNavControls
            hasKeyframes={fadeInKeyframe}
            isAtKeyframe={fadeInKeyframe}
            onToggleKeyframe={() => setFadeInKeyframe(!fadeInKeyframe)}
            onPrevKeyframe={() => {}}
            onNextKeyframe={() => {}}
            label="Fade in"
          />
        </div>
      </div>

      {/* Fade out */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-white/80 min-w-[80px]">Fade out</label>
        <div className="flex-1 flex items-center gap-2">
          <SliderTrack
            value={fadeOut}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
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
          />
          <KeyframeNavControls
            hasKeyframes={fadeOutKeyframe}
            isAtKeyframe={fadeOutKeyframe}
            onToggleKeyframe={() => setFadeOutKeyframe(!fadeOutKeyframe)}
            onPrevKeyframe={() => {}}
            onNextKeyframe={() => {}}
            label="Fade out"
          />
        </div>
      </div>
    </div>
  );
};
