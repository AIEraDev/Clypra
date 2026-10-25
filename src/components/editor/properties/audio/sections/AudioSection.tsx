import React, { useCallback } from "react";
import {
  Volume2,
  VolumeX,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";

interface AudioSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
  onUnlink?: () => void;
  onRelink?: () => void;
}

export const AudioSection: React.FC<AudioSectionProps> = ({
  selectedClip,
  handleUpdate,
  onUnlink,
  onRelink,
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

  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      const clampedVolume = Math.max(0, Math.min(1, newVolume));
      handleUpdate("volume", clampedVolume);
    },
    [handleUpdate],
  );

  const handleVolumePercentChange = useCallback(
    (percent: number) => {
      handleVolumeChange(percent / 100);
    },
    [handleVolumeChange],
  );

  const toggleMute = useCallback(() => {
    handleVolumeChange(isMuted ? 1.0 : 0);
  }, [handleVolumeChange, isMuted]);

  // Keyframe control component
  const KeyframeControls = () => (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
        title="Reset to default"
      >
        <RotateCcw className="w-3 h-3" />
      </button>
      <button
        type="button"
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
        title="Previous keyframe"
      >
        <ChevronLeft className="w-3 h-3" />
      </button>
      <button
        type="button"
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-cyan-400 transition-colors cursor-pointer"
        title="Add keyframe"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 12l10 10 10-10L12 2z" />
        </svg>
      </button>
      <button
        type="button"
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
        title="Next keyframe"
      >
        <ChevronRight className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div className="space-y-4 px-3 py-2">
      {/* Volume */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">
            Volume
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60 font-mono">
              {audio.gainDb.toFixed(1)}dB
            </span>
            <button
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
            <KeyframeControls />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            onChange={(e) => handleVolumePercentChange(Number(e.target.value))}
            className="flex-1 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full 
              [&::-moz-range-thumb]:bg-cyan-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            onChange={(e) => handleVolumePercentChange(Number(e.target.value))}
            className="w-16 px-2 py-1 text-[11px] text-white bg-[#2a2a2e] border border-white/10 rounded focus:outline-none focus:border-cyan-500/50 text-right"
          />
        </div>
      </div>

      {/* Fade In */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">
            Fade in
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60 font-mono">
              {fadeIn.toFixed(2)}s
            </span>
            <KeyframeControls />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            value={fadeIn}
            onChange={(e) =>
              handleUpdate("fadeIn", clampFade(Number(e.target.value)))
            }
            className="flex-1 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full 
              [&::-moz-range-thumb]:bg-cyan-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
          <input
            type="number"
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            value={fadeIn.toFixed(2)}
            onChange={(e) =>
              handleUpdate("fadeIn", clampFade(parseFloat(e.target.value) || 0))
            }
            className="w-16 px-2 py-1 text-[11px] text-white bg-[#2a2a2e] border border-white/10 rounded focus:outline-none focus:border-cyan-500/50 text-right"
          />
        </div>
      </div>

      {/* Fade Out */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">
            Fade out
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60 font-mono">
              {fadeOut.toFixed(2)}s
            </span>
            <KeyframeControls />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            value={fadeOut}
            onChange={(e) =>
              handleUpdate("fadeOut", clampFade(Number(e.target.value)))
            }
            className="flex-1 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full 
              [&::-moz-range-thumb]:bg-cyan-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
          <input
            type="number"
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            value={fadeOut.toFixed(2)}
            onChange={(e) =>
              handleUpdate(
                "fadeOut",
                clampFade(parseFloat(e.target.value) || 0),
              )
            }
            className="w-16 px-2 py-1 text-[11px] text-white bg-[#2a2a2e] border border-white/10 rounded focus:outline-none focus:border-cyan-500/50 text-right"
          />
        </div>
      </div>
    </div>
  );
};
