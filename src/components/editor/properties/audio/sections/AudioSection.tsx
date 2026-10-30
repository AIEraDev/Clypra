import React, { useCallback, useState } from "react";
import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";
import type { AudioChannelMode, AudioDownmixMode } from "@/types/audio";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { PropertySelect } from "../../primitives/PropertySelect";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";
import { PropertySectionHeader } from "../../primitives";
import { AudioFXSection } from "./AudioFXSection";

interface AudioSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
  onUnlink?: () => void;
  onRelink?: () => void;
}

export const AudioSection: React.FC<AudioSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  /** True while the volume thumb is magnetically locked to the 0 dB snap point. */
  const [isVolumeSnapping, setIsVolumeSnapping] = useState(false);
  const audio = getClipAudioProperties(selectedClip);
  const volume = audio.muted ? 0 : dbToLinearGain(audio.gainDb);
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);

  // Per-fade dynamic cap — matches the envelope editor's formula exactly:
  //   max(fadeIn)  = min(10, clip.duration - fadeOut)
  //   max(fadeOut) = min(10, clip.duration - fadeIn)
  // This keeps the two sliders in sync with the timeline handles regardless of
  // clip length, and avoids the half-duration mismatch that caused the panel to
  // display a lower value than the timeline during a drag.
  const rawFadeIn = Math.max(
    0,
    Number.isFinite(audio.fadeIn.duration) ? audio.fadeIn.duration : 0,
  );
  const rawFadeOut = Math.max(
    0,
    Number.isFinite(audio.fadeOut.duration) ? audio.fadeOut.duration : 0,
  );
  const maxFadeIn = Math.min(
    10,
    Math.max(0, selectedClip.duration - rawFadeOut),
  );
  const maxFadeOut = Math.min(
    10,
    Math.max(0, selectedClip.duration - rawFadeIn),
  );
  const fadeIn = Math.min(rawFadeIn, maxFadeIn);
  const fadeOut = Math.min(rawFadeOut, maxFadeOut);

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
   * Accepts a linear gain value (0 = silence, 1.0 = unity/0dB, up to ~3.16 for +10dB boost).
   * Writes through the `volume` field which synchronizeClipAudioProperties converts to gainDb.
   */
  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      // Allow up to +20dB boost (linear ≈ 10). Floor at 0 (silence).
      const gain = Math.max(0, Math.min(dbToLinearGain(20), newVolume));

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
    handleVolumeChange(audio.muted ? 1.0 : 0);
  }, [handleVolumeChange, audio.muted]);

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

  const pan = audio.pan ?? 0;

  const handlePanChange = useCallback(
    (val: number) => {
      const clamped = Math.max(-1, Math.min(1, val));
      handleUpdate("audioFX", {
        ...(selectedClip.audioFX ?? {}),
        pan: clamped,
      });
    },
    [selectedClip.audioFX, handleUpdate],
  );

  const handleResetPan = useCallback(() => {
    propertyEditTelemetry.recordButtonAction({
      action: "reset-pan",
      category: "audio",
      property: "pan",
    });
    handlePanChange(0);
  }, [handlePanChange]);

  return (
    <div>
      <div className="space-y-4 px-3 py-2">
        <PropertySectionHeader
          title="Basic"
          onToggleCollapse={() => setIsExpanded(!isExpanded)}
          onReset={() => {}}
          isCollapsed={!isExpanded}
        />

        {isExpanded && (
          <>
            {/* Volume */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-white/90">
                Volume
              </label>
              <div className="flex items-center">
                {/* Slider wrapper — overlays a tick mark at the 0 dB position (75% along the -60→+20 range) */}
                <div className="relative flex-1 mr-4">
                  <SliderTrack
                    value={Math.max(-60, Math.min(20, audio.gainDb))}
                    min={-60}
                    max={20}
                    step={0.1}
                    propertyId="volume"
                    category="audio"
                    snapPoints={[{ value: 0, threshold: 0.5 }]}
                    onSnapChange={setIsVolumeSnapping}
                    onChange={(db) => {
                      // Below -60 dB → treat as silence (mute)
                      if (db <= -60) {
                        handleVolumeChange(0);
                      } else {
                        handleVolumeChange(dbToLinearGain(db));
                      }
                    }}
                  />
                  {/* 0 dB reference tick: position = (0 - (-60)) / (20 - (-60)) = 75%
                    Brightens when the thumb snaps to 0 dB during a drag. */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-75 ${
                      isVolumeSnapping
                        ? "w-[2px] h-3 bg-white/90"
                        : "w-px h-2.5 bg-white/40"
                    }`}
                    style={{ left: "75%" }}
                  />
                </div>
                <NumericControl
                  value={audio.gainDb}
                  onChange={(db) => {
                    if (db <= -60) {
                      handleVolumeChange(0);
                    } else {
                      handleVolumeChange(dbToLinearGain(Math.min(20, db)));
                    }
                  }}
                  step={0.1}
                  min={-60}
                  max={20}
                  suffix="dB"
                  inputWidth="w-8"
                  inputPosition="text-right"
                  decimals={1}
                  ariaLabel="Volume"
                  propertyId="volume"
                  category="audio"
                  formatDisplay={(v) => (v <= -60 ? "-∞" : v.toFixed(1))}
                />
                {/* Mute toggle — mirrors AudioBasicTab pattern */}
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`flex items-center justify-center w-6 h-6 rounded transition-all cursor-pointer ml-1 ${
                    audio.muted
                      ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                      : "bg-white/5 hover:bg-white/10 text-white/50 hover:text-white"
                  }`}
                  title={audio.muted ? "Unmute" : "Mute"}
                  aria-label={audio.muted ? "Unmute" : "Mute"}
                >
                  {audio.muted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
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

            {/* Fade In */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-white/90">
                Fade in
              </label>
              <div className="flex items-center">
                <SliderTrack
                  value={fadeIn}
                  min={0}
                  max={maxFadeIn}
                  step={0.01}
                  propertyId="fadeIn"
                  category="audio"
                  onChange={(val) =>
                    handleUpdate(
                      "fadeIn",
                      Math.max(0, Math.min(maxFadeIn, val)),
                    )
                  }
                  className="mr-4"
                />
                <NumericControl
                  value={fadeIn}
                  onChange={(val) =>
                    handleUpdate(
                      "fadeIn",
                      Math.max(0, Math.min(maxFadeIn, val)),
                    )
                  }
                  step={0.01}
                  min={0}
                  max={maxFadeIn}
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

            {/* Fade Out */}
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-white/90">
                Fade out
              </label>
              <div className="flex items-center">
                <SliderTrack
                  value={fadeOut}
                  min={0}
                  max={maxFadeOut}
                  step={0.01}
                  propertyId="fadeOut"
                  category="audio"
                  onChange={(val) =>
                    handleUpdate(
                      "fadeOut",
                      Math.max(0, Math.min(maxFadeOut, val)),
                    )
                  }
                  className="mr-4"
                />
                <NumericControl
                  value={fadeOut}
                  onChange={(val) =>
                    handleUpdate(
                      "fadeOut",
                      Math.max(0, Math.min(maxFadeOut, val)),
                    )
                  }
                  step={0.01}
                  min={0}
                  max={maxFadeOut}
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

            {/* Pan / Balance — matches AudioBasicTab pattern */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-white/90">
                  Pan
                </label>
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
                {/* Center tick at 50% = pan 0 */}
                <div className="relative flex-1 mr-4">
                  <SliderTrack
                    value={pan}
                    min={-1}
                    max={1}
                    step={0.01}
                    propertyId="pan"
                    category="audio"
                    snapPoints={[{ value: 0, threshold: 0.02 }]}
                    onChange={handlePanChange}
                  />
                  {/* Center tick at pan = 0 (50% of -1→+1) */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/40 pointer-events-none"
                    style={{ left: "50%" }}
                  />
                </div>
                <NumericControl
                  value={Math.round(pan * 100)}
                  onChange={(pct) => handlePanChange(pct / 100)}
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
          </>
        )}
      </div>

      {/* Channel Configuration */}
      {isExpanded && (
        <div className="space-y-4 px-3 pb-2 border-t border-white/5 pt-4">
          <div className="space-y-3">
            <label className="text-[11px] font-medium text-white/90">
              Channel
            </label>
            <PropertySelect
              label="Mode"
              value={audio.channelConfig.mode}
              options={[
                { value: "auto", label: "Auto" },
                { value: "mono", label: "Mono" },
                { value: "stereo", label: "Stereo" },
                { value: "multichannel", label: "Multichannel" },
              ]}
              onChange={(val) =>
                handleUpdate("audio", {
                  ...selectedClip.audio,
                  channelConfig: {
                    ...audio.channelConfig,
                    mode: val as AudioChannelMode,
                  },
                })
              }
            />
            <PropertySelect
              label="Downmix"
              value={audio.channelConfig.downmix}
              options={[
                { value: "auto", label: "Auto" },
                { value: "mono", label: "Mono" },
                { value: "stereo", label: "Stereo" },
              ]}
              onChange={(val) =>
                handleUpdate("audio", {
                  ...selectedClip.audio,
                  channelConfig: {
                    ...audio.channelConfig,
                    downmix: val as AudioDownmixMode,
                  },
                })
              }
            />
          </div>
        </div>
      )}

      <AudioFXSection selectedClip={selectedClip} handleUpdate={handleUpdate} />
    </div>
  );
};
