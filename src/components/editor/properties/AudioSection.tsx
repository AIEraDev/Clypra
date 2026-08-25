import React, { useCallback } from "react";
import { Volume2, VolumeX, AudioLines, Plus, Trash2 } from "lucide-react";
import type { AudioChannelMode, AudioDownmixMode, Clip } from "@/types";
import { dbToLinearGain, getClipAudioProperties } from "@/types/audio";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";

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
  const effects = audio.effects ?? selectedClip.audioFX ?? {};
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
  const keyframes = audio.volumeKeyframes;
  const channelMapText = audio.channelConfig.channelMap?.join(", ") ?? "";

  const updateKeyframes = useCallback(
    (next: typeof keyframes) => handleUpdate("volumeKeyframes", [...next].sort((a, b) => a.time - b.time)),
    [handleUpdate],
  );

  const addKeyframe = useCallback(() => {
    const time = Math.round((selectedClip.duration / 2) * 100) / 100;
    const gain = keyframes.length > 0
      ? keyframes[keyframes.length - 1].gain
      : 1;
    updateKeyframes([...keyframes, { id: `audio-kf-${Date.now()}`, time, gain, easing: "linear" }]);
  }, [keyframes, selectedClip.duration, updateKeyframes]);

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
                value={audio.fadeIn.curve}
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
                value={audio.fadeOut.curve}
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

      {(onUnlink || onRelink) && (
        <PropertySection title="Audio Link" icon={<AudioLines className="w-3.5 h-3.5" />}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-muted">
              {audio.linkState === "unlinked" ? "Temporarily unlinked — move audio for a J/L cut." : "Linked audio follows its video clip."}
            </span>
            {audio.linkState === "unlinked" ? (
              <button onClick={onRelink} className="rounded bg-accent/15 px-2 py-1 text-[10px] font-medium text-accent hover:bg-accent/25">Relink</button>
            ) : (
              <button onClick={onUnlink} className="rounded bg-surface-raised px-2 py-1 text-[10px] font-medium text-text-primary hover:bg-white/10">Unlink</button>
            )}
          </div>
        </PropertySection>
      )}

      <PropertySection
        title="Volume Automation"
        icon={<AudioLines className="w-3.5 h-3.5" />}
        defaultCollapsed
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{keyframes.length ? `${keyframes.length} keyframe${keyframes.length === 1 ? "" : "s"}` : "No keyframes"}</span>
            <button
              onClick={addKeyframe}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-accent hover:bg-accent/10"
              title="Add a volume keyframe at the clip midpoint"
            >
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          {keyframes.map((keyframe) => (
            <div key={keyframe.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-1.5">
              <label className="text-[9px] text-text-muted">
                Time
                <input
                  aria-label={`Keyframe ${keyframe.id} time`}
                  type="number"
                  min={0}
                  max={selectedClip.duration}
                  step={0.01}
                  value={keyframe.time}
                  onChange={(event) => updateKeyframes(keyframes.map((point) => point.id === keyframe.id ? { ...point, time: Math.max(0, Math.min(selectedClip.duration, Number(event.target.value) || 0)) } : point))}
                  className="mt-0.5 w-full bg-surface-raised border border-white/10 rounded px-1 py-0.5 text-[10px] text-text-primary outline-none focus:border-accent"
                />
              </label>
              <label className="text-[9px] text-text-muted">
                Level
                <input
                  aria-label={`Keyframe ${keyframe.id} level`}
                  type="number"
                  min={0}
                  max={300}
                  step={1}
                  value={Math.round(keyframe.gain * 100)}
                  onChange={(event) => updateKeyframes(keyframes.map((point) => point.id === keyframe.id ? { ...point, gain: Math.max(0, Math.min(3, (Number(event.target.value) || 0) / 100)) } : point))}
                  className="mt-0.5 w-full bg-surface-raised border border-white/10 rounded px-1 py-0.5 text-[10px] text-text-primary outline-none focus:border-accent"
                />
              </label>
              <button
                onClick={() => updateKeyframes(keyframes.filter((point) => point.id !== keyframe.id))}
                className="mt-3 rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-400"
                aria-label={`Remove keyframe ${keyframe.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </PropertySection>

      <PropertySection
        title="Channel & Speed"
        icon={<AudioLines className="w-3.5 h-3.5" />}
        defaultCollapsed
      >
        <div className="space-y-2.5">
          <label className="block text-[10px] text-text-muted">
            Channel mode
            <select
              aria-label="Channel mode"
              value={audio.channelConfig.mode}
              onChange={(event) => handleUpdate("audio", {
                channelConfig: { ...audio.channelConfig, mode: event.target.value as AudioChannelMode },
              })}
              className="mt-1 w-full bg-surface-raised border border-white/10 rounded px-1.5 py-1 text-[10px] text-text-primary outline-none focus:border-accent"
            >
              <option value="auto">Auto (source layout)</option>
              <option value="mono">Mono</option>
              <option value="stereo">Stereo</option>
              <option value="multichannel">Multichannel</option>
            </select>
          </label>
          <label className="block text-[10px] text-text-muted">
            Downmix
            <select
              aria-label="Channel downmix"
              value={audio.channelConfig.downmix}
              onChange={(event) => handleUpdate("audio", {
                channelConfig: { ...audio.channelConfig, downmix: event.target.value as AudioDownmixMode },
              })}
              className="mt-1 w-full bg-surface-raised border border-white/10 rounded px-1.5 py-1 text-[10px] text-text-primary outline-none focus:border-accent"
            >
              <option value="auto">Auto</option>
              <option value="mono">Mono (dual mono output)</option>
              <option value="stereo">Stereo</option>
            </select>
          </label>
          <label className="block text-[10px] text-text-muted">
            Channel map
            <input
              aria-label="Channel map"
              value={channelMapText}
              placeholder="e.g. 1, 0 to swap L/R"
              onChange={(event) => {
                const values = event.target.value.trim() === ""
                  ? undefined
                  : event.target.value.split(",").map((part) => Number(part.trim())).filter((value) => Number.isInteger(value) && value >= 0);
                handleUpdate("audio", { channelConfig: { ...audio.channelConfig, channelMap: values } });
              }}
              className="mt-1 w-full bg-surface-raised border border-white/10 rounded px-1.5 py-1 text-[10px] text-text-primary outline-none focus:border-accent"
            />
            <span className="mt-0.5 block text-[9px] text-text-muted">Source channel for each output channel. “1, 0” swaps stereo.</span>
          </label>
          <label className="flex items-center justify-between gap-3 border-t border-white/5 pt-2 text-[10px] text-text-secondary">
            <span><span className="block font-medium text-text-primary">Preserve pitch</span><span className="text-[9px] text-text-muted">When the playback speed changes</span></span>
            <input
              aria-label="Preserve pitch"
              type="checkbox"
              checked={audio.speed.preservePitch}
              onChange={(event) => handleUpdate("audio", { speed: { preservePitch: event.target.checked } })}
              className="h-3.5 w-3.5 accent-accent"
            />
          </label>
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
            value={Math.round(audio.pan * 100)}
            min={-100}
            max={100}
            step={5}
            suffix="%"
            onChange={(v) =>
              handleUpdate("audioFX", {
                ...effects,
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
              value={effects.eq?.low ?? 0}
              min={-12}
              max={12}
              step={1}
              suffix="dB"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...effects,
                  eq: {
                    ...(effects.eq || {
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
              value={effects.eq?.mid ?? 0}
              min={-12}
              max={12}
              step={1}
              suffix="dB"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...effects,
                  eq: {
                    ...(effects.eq || {
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
              value={effects.eq?.high ?? 0}
              min={-12}
              max={12}
              step={1}
              suffix="dB"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...effects,
                  eq: {
                    ...(effects.eq || {
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
                (effects.noiseSuppression ?? 0) * 100,
              )}
              min={0}
              max={100}
              step={5}
              suffix="%"
              onChange={(v) =>
                handleUpdate("audioFX", {
                  ...effects,
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
