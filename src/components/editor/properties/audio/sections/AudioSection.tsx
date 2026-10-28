import React, { useCallback } from "react";
import { Volume2, VolumeX, RotateCcw } from "lucide-react";
import type { Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";

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
   * When volume keyframes exist on the clip, moving the slider updates the
   * keyframe at the current playhead position (creates one if none exists
   * there). Without keyframes the plain clip volume property is written.
   */
  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      const gain = Math.max(0, Math.min(1, newVolume));

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
    propertyEditTelemetry.recordButtonAction({
      action: "reset-volume",
      category: "audio",
      property: "volume",
    });
    handleVolumeChange(1.0);
  }, [handleVolumeChange]);

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
          <label className="text-[11px] font-medium text-white/90">
            Volume
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60 font-mono">
              {audio.gainDb.toFixed(1)}dB
            </span>
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
            <button
              type="button"
              onClick={handleResetVolume}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
              title="Reset volume"
              aria-label="Reset volume"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
            <KeyframeNavControls
              hasKeyframes={volumeKeyframes.length > 0}
              isAtKeyframe={isAtVolumeKf}
              hasPrev={hasPrevVolumeKf}
              hasNext={hasNextVolumeKf}
              onToggleKeyframe={handleToggleVolumeKeyframe}
              onPrevKeyframe={() => handleJumpToVolumeKeyframe("prev")}
              onNextKeyframe={() => handleJumpToVolumeKeyframe("next")}
              label="Volume"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SliderTrack
            value={volumePercent}
            min={0}
            max={100}
            step={1}
            propertyId="volume"
            category="audio"
            onChange={handleVolumePercentChange}
          />
          <NumericControl
            value={volumePercent}
            onChange={handleVolumePercentChange}
            step={1}
            min={0}
            max={100}
            suffix="%"
            inputWidth="w-16"
            inputPosition="text-right"
            decimals={0}
            ariaLabel="Volume"
            propertyId="volume"
            category="audio"
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
            <button
              type="button"
              onClick={handleResetFadeIn}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
              title="Reset fade in"
              aria-label="Reset fade in"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SliderTrack
            value={fadeIn}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            propertyId="fadeIn"
            category="audio"
            onChange={(val) => handleUpdate("fadeIn", clampFade(val))}
          />
          <NumericControl
            value={fadeIn}
            onChange={(val) => handleUpdate("fadeIn", clampFade(val))}
            step={0.01}
            min={0}
            max={maxFadeSeconds}
            suffix="s"
            inputWidth="w-16"
            inputPosition="text-right"
            decimals={2}
            ariaLabel="Fade in"
            propertyId="fadeIn"
            category="audio"
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
            <button
              type="button"
              onClick={handleResetFadeOut}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
              title="Reset fade out"
              aria-label="Reset fade out"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SliderTrack
            value={fadeOut}
            min={0}
            max={maxFadeSeconds}
            step={0.01}
            propertyId="fadeOut"
            category="audio"
            onChange={(val) => handleUpdate("fadeOut", clampFade(val))}
          />
          <NumericControl
            value={fadeOut}
            onChange={(val) => handleUpdate("fadeOut", clampFade(val))}
            step={0.01}
            min={0}
            max={maxFadeSeconds}
            suffix="s"
            inputWidth="w-16"
            inputPosition="text-right"
            decimals={2}
            ariaLabel="Fade out"
            propertyId="fadeOut"
            category="audio"
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
            <button
              type="button"
              onClick={handleResetPan}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 text-white/40 hover:text-white/60 transition-colors cursor-pointer"
              title="Reset pan"
              aria-label="Reset pan"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
            inputPosition="text-right"
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
