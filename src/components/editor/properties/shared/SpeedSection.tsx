import React, { useState, useCallback } from "react";
import { FlipHorizontal2, Snowflake } from "lucide-react";
import type { Clip, PlaybackMapping } from "@/types";
import { useI18n } from "@/i18n";
import { UpdateClipCommand } from "@/core/history/commands";
import { useHistoryStore } from "@/store/historyStore";
import { useTimelineStore } from "@/store/timelineStore";
import { SpeedSliderTrack } from "../primitives/SpeedSliderTrack";
import { NumericControl } from "../primitives/NumericControl";
import { resolveClipSourceTime } from "@/core/timeline/sourceTime";
import { getPlaybackClock } from "@/hooks/usePlaybackClock";
import type { Command } from "@/core/history/Command";

type SpeedSubTab = "standard" | "curve" | "velocity";

interface SpeedStyleSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
  /**
   * Coordinator-aware command executor from PropertyPanelBody.
   * Falls back to historyStore when absent (tests, Storybook).
   */
  executeCommand?: (command: Command) => void;
  /** When false the Standard/Curve/Velocity sub-tab switcher is hidden.
   * Audio clips only need the Standard content without navigation overhead. */
  showTabs?: boolean;
}

/** Derive the current effective speed scalar (1.0 when absent). */
function effectiveSpeed(clip: Clip): number {
  const m = clip.playbackMapping;
  if (!m) return clip.speed ?? 1;
  if (m.kind === "normal" || m.kind === "reverse") return m.speed;
  if (m.kind === "freeze") return 0;
  if (m.kind === "speed_ramp" && m.keyframes.length > 0)
    return m.keyframes[0].speed;
  return 1;
}

/**
 * Timeline duration formula:  timeline duration = source duration / speed
 * "Source duration" is the span of media consumed: trimOut − trimIn.
 */
function durationFromSpeed(clip: Clip, speed: number): number {
  const sourceDuration = clip.trimOut - clip.trimIn;
  return sourceDuration / Math.max(0.001, speed);
}

export const SpeedStyleSection: React.FC<SpeedStyleSectionProps> = ({
  selectedClip,
  handleUpdate,
  executeCommand,
  showTabs = true,
}) => {
  const { t } = useI18n();
  const [activeSubTab, setActiveSubTab] = useState<SpeedSubTab>("standard");

  const kind = selectedClip.playbackMapping?.kind ?? "normal";
  const isReversed = kind === "reverse";
  const isFrozen = kind === "freeze";
  const speed = effectiveSpeed(selectedClip);

  const dispatchCommand = useCallback(
    (command: Command) => {
      if (executeCommand) {
        executeCommand(command);
      } else {
        useHistoryStore.getState().execute(command);
      }
    },
    [executeCommand],
  );

  /**
   * Central mutation point. Atomically updates playbackMapping, legacy speed
   * scalar, and timeline duration so every downstream system stays consistent.
   */
  const applyMapping = useCallback(
    (mapping: PlaybackMapping, newSpeed: number) => {
      const newDuration = durationFromSpeed(selectedClip, newSpeed);
      const oldDuration = selectedClip.duration;
      dispatchCommand(
        new UpdateClipCommand(
          selectedClip.id,
          {
            playbackMapping: selectedClip.playbackMapping,
            speed: selectedClip.speed,
            duration: oldDuration,
          },
          {
            playbackMapping: mapping,
            speed: newSpeed,
            duration: newDuration,
          },
        ),
      );
      // Ripple downstream clips on the same track when enabled
      const delta = newDuration - oldDuration;
      if (Math.abs(delta) > 0.001) {
        const { rippleEditEnabled, clips } = useTimelineStore.getState();
        if (rippleEditEnabled) {
          const clipEnd = selectedClip.startTime + oldDuration;
          const downstream = clips
            .filter(
              (c) =>
                c.id !== selectedClip.id &&
                c.trackId === selectedClip.trackId &&
                c.startTime >= clipEnd - 0.001,
            )
            .sort((a, b) => a.startTime - b.startTime);
          for (const c of downstream) {
            dispatchCommand(
              new UpdateClipCommand(
                c.id,
                { startTime: c.startTime },
                { startTime: c.startTime + delta },
              ),
            );
          }
        }
      }
    },
    [selectedClip, dispatchCommand],
  );

  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      if (newSpeed <= 0) return;
      // Preserve reverse direction when adjusting speed on a reversed clip
      const nextKind = isReversed ? "reverse" : "normal";
      applyMapping({ kind: nextKind, speed: newSpeed }, newSpeed);
    },
    [applyMapping, isReversed],
  );

  const handleToggleReverse = useCallback(() => {
    const currentSpeed =
      selectedClip.playbackMapping?.kind === "normal" ||
      selectedClip.playbackMapping?.kind === "reverse"
        ? selectedClip.playbackMapping.speed
        : (selectedClip.speed ?? 1);
    const nextKind = isReversed ? "normal" : "reverse";
    applyMapping({ kind: nextKind, speed: currentSpeed }, currentSpeed);
  }, [selectedClip, isReversed, applyMapping]);

  // Freeze uses the resolved source time at the playhead, not a speed.
  // Duration stays the same (a frozen clip occupies its full timeline footprint).
  const handleToggleFreeze = useCallback(() => {
    if (isFrozen) {
      // Unfreeze → restore normal 1× playback
      dispatchCommand(
        new UpdateClipCommand(
          selectedClip.id,
          { playbackMapping: selectedClip.playbackMapping },
          { playbackMapping: { kind: "normal", speed: 1 } },
        ),
      );
      return;
    }
    const clock = getPlaybackClock();
    const { sourceTime } = resolveClipSourceTime(selectedClip, clock.time, {
      clampToRange: true,
    });
    dispatchCommand(
      new UpdateClipCommand(
        selectedClip.id,
        { playbackMapping: selectedClip.playbackMapping },
        { playbackMapping: { kind: "freeze", atSourceTime: sourceTime } },
      ),
    );
  }, [selectedClip, isFrozen, dispatchCommand]);

  // Freeze is only available when the playhead is inside the clip
  const clock = getPlaybackClock();
  const playheadInsideClip =
    clock.time >= selectedClip.startTime &&
    clock.time < selectedClip.startTime + selectedClip.duration;

  const preservePitch = selectedClip.audio?.speed?.preservePitch ?? true;

  const handlePreservePitchToggle = useCallback(() => {
    handleUpdate("audio", {
      ...selectedClip.audio,
      speed: { preservePitch: !preservePitch },
    });
  }, [selectedClip.audio, preservePitch, handleUpdate]);

  // ── Shared icon-button style ───────────────────────────────────────────────
  const iconBtn = (active: boolean, disabled?: boolean) =>
    [
      "flex items-center justify-center w-7 h-7 rounded transition-all cursor-pointer select-none",
      active
        ? "bg-accent/15 text-accent border border-accent/40"
        : "bg-surface-elevated text-text-muted border border-border-default hover:bg-surface-hover hover:text-text-primary",
      disabled ? "opacity-40 pointer-events-none" : "",
    ].join(" ");

  return (
    <div className="space-y-1.5 select-none text-text-primary relative p-2 pt-0">
      {/* Sub-tab switcher */}
      {showTabs && (
      <div className="bg-surface-panel pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-surface-elevated p-0.5 rounded-md flex gap-1 border border-border-default">
          {(["standard", "curve", "velocity"] as const).map((tab) => {
            const isLocked = tab !== "standard";
            const labels = {
              standard: t("properties.speed.standard"),
              curve: t("properties.speed.curve"),
              velocity: t("properties.speed.velocity"),
            };
            return (
              <button
                key={tab}
                type="button"
                onClick={() => !isLocked && setActiveSubTab(tab)}
                disabled={isLocked}
                title={isLocked ? t("common.comingSoon") : undefined}
                className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center flex items-center justify-center gap-1 ${
                  isLocked
                    ? "text-text-muted/50 cursor-not-allowed"
                    : activeSubTab === tab
                      ? "bg-accent-primary text-white shadow-sm font-semibold cursor-pointer"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-hover cursor-pointer"
                }`}
              >
                {labels[tab]}
                {isLocked &&
                  // prettier-ignore
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 shrink-0"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {activeSubTab === "standard" && (
        <div className="space-y-4">
          {/* ── Speed ──────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-text-primary">
              {t("properties.tabs.speed")}
            </label>
            {isFrozen ? (
              /* Frozen state — speed slider replaced with a read-only badge */
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded bg-surface-elevated border border-border-default">
                  <Snowflake className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                  <span className="text-[11px] text-text-secondary">{t("properties.speed.frozen")}</span>
                  <span className="ml-auto text-[11px] text-text-muted font-mono tabular-nums">
                    {(
                      selectedClip.playbackMapping as {
                        kind: "freeze";
                        atSourceTime: number;
                      }
                    ).atSourceTime.toFixed(3)}
                    s
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center">
                <SpeedSliderTrack
                  value={speed}
                  min={0.1}
                  max={100}
                  step={0.01}
                  onChange={handleSpeedChange}
                  className="mr-4"
                />
                <NumericControl
                  value={speed}
                  onChange={handleSpeedChange}
                  step={0.01}
                  min={0.1}
                  max={100}
                  suffix="x"
                  inputWidth="w-10"
                  decimals={2}
                />
              </div>
            )}
          </div>

          {/* ── Duration ───────────────────────────────────────────────────── */}
          {!isFrozen && (
            <div className="space-y-2">
              <label className="text-[11px] font-medium text-text-primary">
                {t("properties.speed.duration")}
              </label>
              <div className="flex items-center">
                <div className="flex-1 h-[3px] bg-white/5 rounded-full relative overflow-hidden mr-4">
                  <div
                    className="absolute left-0 top-0 h-full bg-white/20 rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        (selectedClip.duration /
                          (selectedClip.trimOut - selectedClip.trimIn)) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <NumericControl
                  value={Number(selectedClip.duration.toFixed(2))}
                  onChange={(newDuration) => {
                    if (newDuration <= 0) return;
                    const sourceDuration =
                      selectedClip.trimOut - selectedClip.trimIn;
                    const derivedSpeed = Math.max(
                      0.1,
                      Math.min(100, sourceDuration / newDuration),
                    );
                    handleSpeedChange(derivedSpeed);
                  }}
                  step={0.01}
                  min={0.01}
                  max={Number(
                    (
                      (selectedClip.trimOut - selectedClip.trimIn) /
                      0.1
                    ).toFixed(2),
                  )}
                  suffix="s"
                  inputWidth="w-10"
                  decimals={2}
                />
              </div>
            </div>
          )}

          {/* ── Playback mode buttons (Reverse / Freeze) ───────────────────── */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-text-primary">
              {t("properties.speed.playback")}
            </label>
            <div className="flex items-center gap-2">
              {/* Reverse toggle */}
              <button
                type="button"
                title={isReversed ? t("properties.speed.unreverseClip") : t("properties.speed.reverseClip")}
                aria-label={isReversed ? t("properties.speed.unreverseClip") : t("properties.speed.reverseClip")}
                onClick={handleToggleReverse}
                disabled={isFrozen}
                className={iconBtn(isReversed, isFrozen)}
              >
                <FlipHorizontal2 className="w-3.5 h-3.5" />
              </button>
              <span className="text-[11px] text-text-muted">
                {isReversed ? t("properties.speed.reversed") : t("properties.speed.reverse")}
              </span>

              <div className="flex-1" />

              {/* Freeze Frame toggle */}
              <span
                className="text-[11px] text-text-muted"
                title={
                  !playheadInsideClip && !isFrozen
                    ? t("properties.speed.movePlayheadToFreeze")
                    : undefined
                }
              >
                {isFrozen ? t("properties.speed.frozen") : t("properties.speed.freeze")}
              </span>
              <button
                type="button"
                title={
                  isFrozen
                    ? t("properties.speed.unfreezeClip")
                    : playheadInsideClip
                      ? t("properties.speed.freezeFrameAtPlayhead")
                      : t("properties.speed.movePlayheadToFreeze")
                }
                aria-label={
                  isFrozen ? t("properties.speed.unfreezeClip") : t("properties.speed.freezeFrameAtPlayhead")
                }
                onClick={handleToggleFreeze}
                disabled={!isFrozen && !playheadInsideClip}
                className={iconBtn(isFrozen, !isFrozen && !playheadInsideClip)}
              >
                <Snowflake className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── Change audio pitch toggle ───────────────────────────────────── */}
          <div className="flex items-center justify-between py-2 border-t border-border-default">
            <label className="text-sm text-text-primary">{t("properties.speed.changeAudioPitch")}</label>
            <button
              type="button"
              onClick={handlePreservePitchToggle}
              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                preservePitch ? "bg-white/10" : "bg-accent-primary"
              }`}
            >
              <div
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
                  preservePitch ? "left-0.5" : "left-5"
                }`}
              />
            </button>
          </div>
        </div>
      )}

      {activeSubTab === "curve" && (
        <div className="p-4 text-center text-text-muted text-sm">
          {t("properties.speed.curveComingSoon")}
        </div>
      )}

      {activeSubTab === "velocity" && (
        <div className="p-4 text-center text-text-muted text-sm">
          {t("properties.speed.velocityComingSoon")}
        </div>
      )}
    </div>
  );
};
