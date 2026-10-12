/**
 * PlaybackSection — per-clip time remapping controls.
 *
 * Surfaces the PlaybackMapping model as a set of simple, concrete UI affordances:
 *   • Speed multiplier slider (Normal mapping)
 *   • Reverse toggle (Reverse mapping)
 *   • Freeze Frame toggle (Freeze mapping — holds currentSourceTime)
 *
 * The section is shown for video clips and audio clips.
 * All mutations go through `updateClip` → `playbackMapping` field on Clip.
 */

import React, { useCallback } from "react";
import { Gauge, FlipHorizontal2, Snowflake, RotateCcw } from "lucide-react";
import { useHistoryStore } from "@/store/historyStore";
import { UpdateClipCommand } from "@/core/history/commands";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import type { Clip, PlaybackMapping } from "@/types";
import { resolveClipSourceTime } from "@/core/timeline/sourceTime";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";

interface PlaybackSectionProps {
  selectedClip: Clip;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive the current effective speed scalar (1.0 when absent). */
function effectiveSpeed(clip: Clip): number {
  const m = clip.playbackMapping;
  if (!m) return clip.speed ?? 1;
  if (m.kind === "normal" || m.kind === "reverse") return m.speed;
  if (m.kind === "freeze") return 0; // visually "0×" during a freeze
  // speed_ramp — show the first keyframe speed as the representative value
  if (m.kind === "speed_ramp" && m.keyframes.length > 0) return m.keyframes[0].speed;
  return 1;
}

function isReversed(clip: Clip): boolean {
  return clip.playbackMapping?.kind === "reverse";
}

function isFrozen(clip: Clip): boolean {
  return clip.playbackMapping?.kind === "freeze";
}

// ─── Speed presets ────────────────────────────────────────────────────────────

const SPEED_PRESETS = [
  { label: "0.25×", value: 0.25 },
  { label: "0.5×", value: 0.5 },
  { label: "1×", value: 1 },
  { label: "1.5×", value: 1.5 },
  { label: "2×", value: 2 },
  { label: "4×", value: 4 },
];

// ─── Component ───────────────────────────────────────────────────────────────

export const PlaybackSection: React.FC<PlaybackSectionProps> = ({ selectedClip }) => {
  const speed = effectiveSpeed(selectedClip);
  const reversed = isReversed(selectedClip);
  const frozen = isFrozen(selectedClip);

  const applyMapping = useCallback(
    (mapping: PlaybackMapping) => {
      useHistoryStore.getState().execute(
        new UpdateClipCommand(
          selectedClip.id,
          { playbackMapping: selectedClip.playbackMapping },
          { playbackMapping: mapping },
        ),
      );
    },
    [selectedClip.id, selectedClip.playbackMapping],
  );

  // ── Apply a normal-speed mapping ──────────────────────────────────────────

  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      if (newSpeed <= 0) return;
      const mapping: PlaybackMapping = reversed
        ? { kind: "reverse", speed: newSpeed }
        : { kind: "normal", speed: newSpeed };
      applyMapping(mapping);
    },
    [reversed, applyMapping],
  );

  // ── Toggle reverse ────────────────────────────────────────────────────────

  const handleToggleReverse = useCallback(() => {
    const currentSpeed = frozen
      ? 1 // exit freeze when toggling reverse
      : effectiveSpeed(selectedClip);

    const nextKind = reversed ? "normal" : "reverse";
    const mapping: PlaybackMapping = { kind: nextKind, speed: currentSpeed };
    applyMapping(mapping);
  }, [selectedClip, reversed, frozen, applyMapping]);

  // ── Toggle freeze frame ───────────────────────────────────────────────────

  const handleToggleFreeze = useCallback(() => {
    if (frozen) {
      // Un-freeze: return to normal 1× playback
      const mapping: PlaybackMapping = { kind: "normal", speed: 1 };
      applyMapping(mapping);
      return;
    }

    // Freeze at the current playhead's source time for this clip
    const clock = getPlaybackClock();
    const { sourceTime } = resolveClipSourceTime(selectedClip, clock.time, {
      clampToRange: true,
    });

    const mapping: PlaybackMapping = { kind: "freeze", atSourceTime: sourceTime };
    applyMapping(mapping);
  }, [selectedClip, frozen, applyMapping]);

  // ── Reset to 1× normal ────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    applyMapping({ kind: "normal", speed: 1 });
  }, [applyMapping]);

  const speedLabel = frozen
    ? "Frozen"
    : reversed
    ? `-${speed.toFixed(2)}×`
    : `${speed.toFixed(2)}×`;

  const isSpeedRamp = selectedClip.playbackMapping?.kind === "speed_ramp";

  return (
    <PropertySection
      title="Playback"
      icon={<Gauge className="w-3.5 h-3.5" />}
      defaultCollapsed={false}
    >
      <div className="space-y-3">
        {/* Speed slider — disabled while frozen or using a speed ramp */}
        {!frozen && !isSpeedRamp && (
          <div className="space-y-2">
            <PropertySlider
              label="Speed"
              value={speed}
              min={0.05}
              max={8}
              step={0.05}
              suffix="×"
              decimals={2}
              compact
              onChange={handleSpeedChange}
              icon={<Gauge className="w-3 h-3" />}
            />

            {/* Speed presets */}
            <div className="flex flex-wrap gap-1">
              {SPEED_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => handleSpeedChange(preset.value)}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-md border transition-colors ${
                    Math.abs(speed - preset.value) < 0.01
                      ? "border-accent bg-accent/20 text-accent"
                      : "border-border/50 text-text-muted hover:border-accent/50 hover:text-text-primary"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Speed ramp notice */}
        {isSpeedRamp && (
          <p className="text-[10px] text-text-muted bg-surface-raised/40 rounded-lg px-2.5 py-2">
            Variable speed ramp active — edit keyframes in the timeline.
          </p>
        )}

        {/* Freeze frame active notice */}
        {frozen && (
          <div className="flex items-center gap-2 bg-accent/10 border border-accent/25 rounded-lg px-2.5 py-2">
            <Snowflake className="w-3 h-3 text-accent flex-shrink-0" />
            <span className="text-[10px] text-accent font-medium">
              Frozen at {(selectedClip.playbackMapping as any)?.atSourceTime?.toFixed(3)}s
            </span>
          </div>
        )}

        {/* Current effective speed label */}
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>Effective speed</span>
          <span
            className={`font-mono font-semibold ${
              frozen ? "text-accent" : reversed ? "text-orange-400" : "text-text-primary"
            }`}
          >
            {speedLabel}
          </span>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-1.5">
          {/* Reverse toggle */}
          <button
            type="button"
            onClick={handleToggleReverse}
            disabled={frozen || isSpeedRamp}
            title={reversed ? "Return to normal direction" : "Play in reverse"}
            className={`flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
              reversed
                ? "border-orange-400/50 bg-orange-400/15 text-orange-400"
                : "border-border/50 text-text-muted hover:border-border hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            <FlipHorizontal2 className="w-3 h-3" />
            {reversed ? "Reversed" : "Reverse"}
          </button>

          {/* Freeze frame toggle */}
          <button
            type="button"
            onClick={handleToggleFreeze}
            disabled={isSpeedRamp}
            title={frozen ? "Unfreeze clip" : "Freeze clip at playhead position"}
            className={`flex-1 flex items-center justify-center gap-1.5 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
              frozen
                ? "border-accent/50 bg-accent/15 text-accent"
                : "border-border/50 text-text-muted hover:border-border hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            <Snowflake className="w-3 h-3" />
            {frozen ? "Unfreeze" : "Freeze Frame"}
          </button>

          {/* Reset */}
          <button
            type="button"
            onClick={handleReset}
            title="Reset to normal 1× playback"
            className="flex items-center justify-center w-7 h-7 rounded-lg border border-border/50 text-text-muted hover:border-border hover:text-text-primary transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>
    </PropertySection>
  );
};
