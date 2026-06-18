import React, { useCallback } from "react";
import { Volume2, VolumeX, AudioLines } from "lucide-react";
import type { Clip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";

interface AudioSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const AudioSection: React.FC<AudioSectionProps> = ({ selectedClip, handleUpdate }) => {
  const volume = selectedClip.volume ?? 1.0;
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const isMuted = volume === 0;
  const maxFadeSeconds = Math.max(0, Math.min(5, selectedClip.duration));
  const clampFade = useCallback(
    (value: number) => Math.max(0, Math.min(maxFadeSeconds, Number.isFinite(value) ? value : 0)),
    [maxFadeSeconds],
  );
  const fadeIn = clampFade((selectedClip as any).fadeIn ?? 0);
  const fadeOut = clampFade((selectedClip as any).fadeOut ?? 0);

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

  return (
    <div className="space-y-3">
      {/* Volume Section */}
      <PropertySection title="Volume" icon={<Volume2 className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {/* Mute toggle + slider */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggleMute}
              className={`flex items-center justify-center w-7 h-7 rounded-md transition-all cursor-pointer ${
                isMuted
                  ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
                  : "bg-surface-raised hover:bg-white/[0.06] text-accent"
              }`}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <div className="flex-1">
              <PropertySlider
                label="Level"
                value={volumePercent}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={handleVolumePercentChange}
                compact
              />
            </div>
          </div>

          {/* Quick-set presets */}
          <div className="flex items-center gap-1">
            {[
              { label: "0%", value: 0 },
              { label: "50%", value: 0.5 },
              { label: "100%", value: 1.0 },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => handleVolumeChange(preset.value)}
                className={`flex-1 py-1 text-[9px] font-medium rounded transition-all cursor-pointer ${
                  volume === preset.value
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-text-muted hover:text-text-primary hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </PropertySection>

      {/* Fade Section */}
      <PropertySection title="Fade" icon={<AudioLines className="w-3.5 h-3.5" />} defaultCollapsed>
        <div className="space-y-2.5">
          <PropertySlider
            label="Fade In"
            value={fadeIn}
            min={0}
            max={maxFadeSeconds}
            step={0.1}
            suffix="s"
            onChange={(v) => handleUpdate("fadeIn", clampFade(v))}
          />
          <PropertySlider
            label="Fade Out"
            value={fadeOut}
            min={0}
            max={maxFadeSeconds}
            step={0.1}
            suffix="s"
            onChange={(v) => handleUpdate("fadeOut", clampFade(v))}
          />
        </div>
      </PropertySection>
    </div>
  );
};
