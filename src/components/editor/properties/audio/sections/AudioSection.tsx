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
import { getPlaybackClock } from "@/hooks/usePlaybackClock";

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
  const pan = audio.pan ?? 0;
  const panPercent = Math.round(pan * 100);

  // Keyframe calculations
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

  const handlePanChange = useCallback(
    (val: number) => {
      const clamped = Math.max(-1, Math.min(1, val));
      handleUpdate("pan", clamped);
    },
    [handleUpdate],
  );

  const handleResetVolume = useCallback(() => {
    handleVolumeChange(1.0);
  }, [handleVolumeChange]);

  const handleResetFadeIn = useCallback(() => {
    handleUpdate("fadeIn", 0);
  }, [handleUpdate]);

  const handleResetFadeOut = useCallback(() => {
    handleUpdate("fadeOut", 0);
  }, [handleUpdate]);

  const handleResetPan = useCallback(() => {
    handlePanChange(0);
  }, [handlePanChange]);

  // Keyframe control component
  interface KeyframeControlsProps {
    onReset?: () => void;
    hasKeyframes?: boolean;
    isAtKeyframe?: boolean;
    hasPrev?: boolean;
    hasNext?: boolean;
    onToggleKeyframe?: () => void;
    onPrevKeyframe?: () => void;
    onNextKeyframe?: () => void;
    resetTitle?: string;
  }

  const KeyframeControls: React.FC<KeyframeControlsProps> = ({
    onReset,
    hasKeyframes = false,
    isAtKeyframe = false,
    hasPrev = false,
    hasNext = false,
    onToggleKeyframe,
    onPrevKeyframe,
    onNextKeyframe,
    resetTitle = "Reset to default",
  }) => (
    <div className="flex items-center gap-0.5">
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
          title={resetTitle}
          aria-label={resetTitle}
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
      {onPrevKeyframe && (
        <button
          type="button"
          onClick={onPrevKeyframe}
          disabled={!hasPrev}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
            hasPrev
              ? "hover:bg-white/5 text-white/60 hover:text-white cursor-pointer"
              : "text-white/20 cursor-not-allowed"
          }`}
          title="Previous keyframe"
          aria-label="Previous keyframe"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
      )}
      {onToggleKeyframe && (
        <button
          type="button"
          onClick={onToggleKeyframe}
          className={`w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 transition-colors cursor-pointer ${
            isAtKeyframe ? "text-cyan-400" : "text-white/40 hover:text-white/60"
          }`}
          title={isAtKeyframe ? "Remove keyframe" : "Add keyframe"}
          aria-label={isAtKeyframe ? "Remove keyframe" : "Add keyframe"}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 12l10 10 10-10L12 2z" />
          </svg>
        </button>
      )}
      {onNextKeyframe && (
        <button
          type="button"
          onClick={onNextKeyframe}
          disabled={!hasNext}
          className={`w-5 h-5 flex items-center justify-center rounded transition-colors ${
            hasNext
              ? "hover:bg-white/5 text-white/60 hover:text-white cursor-pointer"
              : "text-white/20 cursor-not-allowed"
          }`}
          title="Next keyframe"
          aria-label="Next keyframe"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
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
            <KeyframeControls
              onReset={handleResetVolume}
              resetTitle="Reset volume"
              hasKeyframes={volumeKeyframes.length > 0}
              isAtKeyframe={isAtVolumeKf}
              hasPrev={hasPrevVolumeKf}
              hasNext={hasNextVolumeKf}
              onToggleKeyframe={handleToggleVolumeKeyframe}
              onPrevKeyframe={() => handleJumpToVolumeKeyframe("prev")}
              onNextKeyframe={() => handleJumpToVolumeKeyframe("next")}
            />
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
            <KeyframeControls
              onReset={handleResetFadeIn}
              resetTitle="Reset fade in"
            />
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
            <KeyframeControls
              onReset={handleResetFadeOut}
              resetTitle="Reset fade out"
            />
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

      {/* Pan / Balance */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-white/90">
            Pan / Balance
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60 font-mono">
              {pan === 0
                ? "Center"
                : pan < 0
                  ? `L ${Math.abs(panPercent)}%`
                  : `R ${panPercent}%`}
            </span>
            <KeyframeControls
              onReset={handleResetPan}
              resetTitle="Reset pan"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            value={panPercent}
            onChange={(e) => handlePanChange(Number(e.target.value) / 100)}
            className="flex-1 h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-cyan-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full 
              [&::-moz-range-thumb]:bg-cyan-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
          />
          <input
            type="number"
            min={-100}
            max={100}
            step={1}
            value={panPercent}
            aria-label="Pan"
            onChange={(e) =>
              handlePanChange((parseInt(e.target.value, 10) || 0) / 100)
            }
            className="w-16 px-2 py-1 text-[11px] text-white bg-[#2a2a2e] border border-white/10 rounded focus:outline-none focus:border-cyan-500/50 text-right"
          />
        </div>
      </div>
    </div>
  );
};
