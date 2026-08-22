import React, { useCallback } from "react";
import { Volume2, VolumeX, AudioLines } from "lucide-react";
import type { Clip } from "@/types";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";

interface AudioSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const AudioSection: React.FC<AudioSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const volume = selectedClip.volume ?? 1.0;
  const volumePercent = Math.round(Math.max(0, Math.min(1, volume)) * 100);
  const isMuted = volume === 0;
  const maxFadeSeconds = Math.max(0, Math.min(5, selectedClip.duration));
  const clampFade = useCallback(
    (value: number) =>
      Math.max(0, Math.min(maxFadeSeconds, Number.isFinite(value) ? value : 0)),
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
      <PropertySection
        title="Volume"
        icon={<Volume2 className="w-3.5 h-3.5" />}
      >
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
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
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

      {/* Fade Section — open by default so it's visible when a clip is selected */}
      <PropertySection
        title="Fade & Curves"
        icon={<AudioLines className="w-3.5 h-3.5" />}
      >
        <div className="space-y-2.5">
          {/* Fade In: slider + exact numeric input */}
          <div className="space-y-1">
            <PropertySlider
              label="Fade In"
              value={fadeIn}
              min={0}
              max={maxFadeSeconds}
              step={0.01}
              suffix="s"
              onChange={(v) => handleUpdate("fadeIn", clampFade(v))}
            />
            <div className="flex items-center gap-1.5 pl-[52px]">
              <input
                type="number"
                min={0}
                max={maxFadeSeconds}
                step={0.01}
                value={fadeIn.toFixed(2)}
                onChange={(e) =>
                  handleUpdate(
                    "fadeIn",
                    clampFade(parseFloat(e.target.value) || 0),
                  )
                }
                className="w-16 bg-surface-raised border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-text-primary outline-none focus:border-accent text-right"
                aria-label="Fade in duration in seconds"
              />
              <span className="text-[9px] text-text-muted">s</span>
            </div>
          </div>

          {/* Fade Out: slider + exact numeric input */}
          <div className="space-y-1">
            <PropertySlider
              label="Fade Out"
              value={fadeOut}
              min={0}
              max={maxFadeSeconds}
              step={0.01}
              suffix="s"
              onChange={(v) => handleUpdate("fadeOut", clampFade(v))}
            />
            <div className="flex items-center gap-1.5 pl-[52px]">
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
                className="w-16 bg-surface-raised border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-text-primary outline-none focus:border-accent text-right"
                aria-label="Fade out duration in seconds"
              />
              <span className="text-[9px] text-text-muted">s</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <span className="text-[10px] text-text-muted block mb-1">
                In Curve
              </span>
              <select
                value={(selectedClip as any).fadeInCurve || "linear"}
                onChange={(e) => handleUpdate("fadeInCurve", e.target.value)}
                className="w-full bg-surface-raised border border-white/10 rounded px-1.5 py-1 text-[10px] text-text-primary outline-none focus:border-accent"
              >
                <option value="linear">Linear</option>
                <option value="exponential">Exponential</option>
                <option value="logarithmic">Logarithmic</option>
                <option value="s-curve">S-Curve</option>
              </select>
            </div>
            <div>
              <span className="text-[10px] text-text-muted block mb-1">
                Out Curve
              </span>
              <select
                value={(selectedClip as any).fadeOutCurve || "linear"}
                onChange={(e) => handleUpdate("fadeOutCurve", e.target.value)}
                className="w-full bg-surface-raised border border-white/10 rounded px-1.5 py-1 text-[10px] text-text-primary outline-none focus:border-accent"
              >
                <option value="linear">Linear</option>
                <option value="exponential">Exponential</option>
                <option value="logarithmic">Logarithmic</option>
                <option value="s-curve">S-Curve</option>
              </select>
            </div>
          </div>
        </div>
      </PropertySection>

      {/* Audio FX Section (EQ, Pan, Noise Gate) */}
      <PropertySection
        title="Audio FX & Equalizer"
        icon={<AudioLines className="w-3.5 h-3.5" />}
        defaultCollapsed
      >
        <div className="space-y-3">
          {/* Stereo Pan */}
          <PropertySlider
            label="Stereo Pan"
            value={
              selectedClip.audioFX?.pan
                ? Math.round(selectedClip.audioFX.pan * 100)
                : 0
            }
            min={-100}
            max={100}
            step={5}
            suffix="%"
            onChange={(v) =>
              handleUpdate("audioFX", {
                ...(selectedClip.audioFX || {}),
                pan: v / 100,
              })
            }
          />

          {/* 3-Band EQ */}
          <div className="space-y-2 pt-1 border-t border-white/5">
            <span className="text-[10px] font-semibold text-text-secondary block">
              3-Band Equalizer
            </span>
            <PropertySlider
              label="Bass (100Hz)"
              value={selectedClip.audioFX?.eq?.low ?? 0}
              min={-12}
              max={12}
              step={1}
              suffix="dB"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...(selectedClip.audioFX || {}),
                  eq: {
                    ...(selectedClip.audioFX?.eq || {
                      low: 0,
                      mid: 0,
                      high: 0,
                    }),
                    low: v,
                  },
                })
              }
            />
            <PropertySlider
              label="Mid (1kHz)"
              value={selectedClip.audioFX?.eq?.mid ?? 0}
              min={-12}
              max={12}
              step={1}
              suffix="dB"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...(selectedClip.audioFX || {}),
                  eq: {
                    ...(selectedClip.audioFX?.eq || {
                      low: 0,
                      mid: 0,
                      high: 0,
                    }),
                    mid: v,
                  },
                })
              }
            />
            <PropertySlider
              label="Treble (8kHz)"
              value={selectedClip.audioFX?.eq?.high ?? 0}
              min={-12}
              max={12}
              step={1}
              suffix="dB"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...(selectedClip.audioFX || {}),
                  eq: {
                    ...(selectedClip.audioFX?.eq || {
                      low: 0,
                      mid: 0,
                      high: 0,
                    }),
                    high: v,
                  },
                })
              }
            />
          </div>

          {/* Noise Suppression */}
          <div className="pt-1 border-t border-white/5">
            <PropertySlider
              label="Noise Reduction"
              value={Math.round(
                (selectedClip.audioFX?.noiseSuppression ?? 0) * 100,
              )}
              min={0}
              max={100}
              step={5}
              suffix="%"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...(selectedClip.audioFX || {}),
                  noiseSuppression: v / 100,
                })
              }
            />
          </div>
        </div>
      </PropertySection>
    </div>
  );
};
