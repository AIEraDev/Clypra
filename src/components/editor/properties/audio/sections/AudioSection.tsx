import React, { useCallback, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { KeyframeNavControls } from "../../primitives/KeyframeNavControls";
import { propertyEditTelemetry } from "@/lib/properties/propertyEditTelemetry";
import { PropertySectionHeader } from "../../primitives";

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
  const audio = getClipAudioProperties(selectedClip);
  const volume = audio.muted ? 0 : dbToLinearGain(audio.gainDb);
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const maxFadeSeconds = Math.max(0, Math.min(5, selectedClip.duration));
  const clampFade = useCallback(
    (value: number) =>
      Math.max(0, Math.min(maxFadeSeconds, Number.isFinite(value) ? value : 0)),
    [maxFadeSeconds],
  );
  const fadeIn = clampFade(audio.fadeIn.duration);
  const fadeOut = clampFade(audio.fadeOut.duration);

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

  return (
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
                  onChange={(db) => {
                    // Below -60 dB → treat as silence (mute)
                    if (db <= -60) {
                      handleVolumeChange(0);
                    } else {
                      handleVolumeChange(dbToLinearGain(db));
                    }
                  }}
                />
                {/* 0 dB reference tick: position = (0 - (-60)) / (20 - (-60)) = 75% */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/40 pointer-events-none"
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
                inputWidth="w-20"
                inputPosition="text-right"
                decimals={1}
                ariaLabel="Volume"
                propertyId="volume"
                category="audio"
                formatDisplay={(v) => (v <= -60 ? "-∞" : v.toFixed(1))}
              />
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
                max={maxFadeSeconds}
                step={0.01}
                propertyId="fadeIn"
                category="audio"
                onChange={(val) => handleUpdate("fadeIn", clampFade(val))}
                className="mr-4"
              />
              <NumericControl
                value={fadeIn}
                onChange={(val) => handleUpdate("fadeIn", clampFade(val))}
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

          {/* Fade Out */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-white/90">
              Fade out
            </label>
            <div className="flex items-center">
              <SliderTrack
                value={fadeOut}
                min={0}
                max={maxFadeSeconds}
                step={0.01}
                propertyId="fadeOut"
                category="audio"
                onChange={(val) => handleUpdate("fadeOut", clampFade(val))}
                className="mr-4"
              />
              <NumericControl
                value={fadeOut}
                onChange={(val) => handleUpdate("fadeOut", clampFade(val))}
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
        </>
      )}
    </div>
  );
};
