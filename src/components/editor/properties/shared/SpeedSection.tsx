import React, { useState, useCallback } from "react";
import type { Clip, PlaybackMapping } from "@/types";
import { useHistoryStore } from "@/store/historyStore";
import { UpdateClipCommand } from "@/core/history/commands";
import { SpeedSliderTrack } from "../primitives/SpeedSliderTrack";
import { NumericControl } from "../primitives/NumericControl";
import { KeyframeNavControls } from "../primitives/KeyframeNavControls";

type SpeedSubTab = "standard" | "curve" | "velocity";

interface SpeedStyleSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
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

export const SpeedStyleSection: React.FC<SpeedStyleSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SpeedSubTab>("standard");
  const [keyframe, setKeyframe] = useState(false);
  const speed = effectiveSpeed(selectedClip);
  const duration = selectedClip.duration / speed;
  const preservePitch = selectedClip.audio?.speed?.preservePitch ?? true;

  const applyMapping = useCallback(
    (mapping: PlaybackMapping) => {
      useHistoryStore
        .getState()
        .execute(
          new UpdateClipCommand(
            selectedClip.id,
            { playbackMapping: selectedClip.playbackMapping },
            { playbackMapping: mapping },
          ),
        );
    },
    [selectedClip.id, selectedClip.playbackMapping],
  );

  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      if (newSpeed <= 0) return;
      const mapping: PlaybackMapping = { kind: "normal", speed: newSpeed };
      applyMapping(mapping);
    },
    [applyMapping],
  );

  const handlePreservePitchToggle = useCallback(() => {
    handleUpdate("audio", {
      ...selectedClip.audio,
      speed: {
        preservePitch: !preservePitch,
      },
    });
  }, [selectedClip.audio, preservePitch, handleUpdate]);

  return (
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-(--color-gray-900) pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
          {(["standard", "curve", "velocity"] as const).map((tab) => {
            const isLocked = tab !== "standard"; // Only Standard is unlocked for now
            const labels = {
              standard: "Standard",
              curve: "Curve",
              velocity: "Velocity effects",
            };

            return (
              <button
                key={tab}
                type="button"
                onClick={() => !isLocked && setActiveSubTab(tab)}
                disabled={isLocked}
                title={isLocked ? "Coming soon" : undefined}
                className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center flex items-center justify-center gap-1 ${
                  isLocked
                    ? "text-[#8e8e93]/50 cursor-not-allowed"
                    : activeSubTab === tab
                      ? "bg-[#38383e] text-white shadow-sm font-semibold cursor-pointer"
                      : "text-[#8e8e93] hover:text-white cursor-pointer"
                }`}
              >
                {labels[tab]}
                {tab === "curve" && !isLocked && (
                  <svg
                    className="w-3 h-3 text-purple-400"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 2L2 12l10 10 10-10L12 2z" />
                  </svg>
                )}
                {isLocked && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-2.5 h-2.5 shrink-0"
                  >
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Standard tab content */}
      {activeSubTab === "standard" && (
        <div className="space-y-4 p-3">
          {/* Speed - Using SpeedSliderTrack with tick marks + NumericControl + KeyframeNavControls */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-white/80 min-w-[80px]">Speed</label>
            <div className="flex-1 flex items-center gap-2">
              <SpeedSliderTrack
                value={speed}
                min={0.1}
                max={10}
                step={0.01}
                onChange={handleSpeedChange}
              />
              <NumericControl
                value={speed}
                onChange={handleSpeedChange}
                step={0.01}
                min={0.1}
                max={10}
                suffix="x"
                inputWidth="w-16"
                decimals={2}
              />
              <KeyframeNavControls
                hasKeyframes={keyframe}
                isAtKeyframe={keyframe}
                onToggleKeyframe={() => setKeyframe(!keyframe)}
                onPrevKeyframe={() => {}}
                onNextKeyframe={() => {}}
                label="Speed"
              />
            </div>
          </div>

          {/* Duration (read-only visual indicator) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm text-white/80">Duration</label>
              <span className="text-[11px] text-white/60 font-mono">
                {duration.toFixed(1)}s
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full relative overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full bg-white/10"
                  style={{
                    width: `${Math.min(100, (duration / selectedClip.duration) * 100)}%`,
                  }}
                />
              </div>
              <div className="w-16 px-2 py-1 text-[11px] text-white/40 bg-[#1a1a1e] border border-white/5 rounded text-right">
                {duration.toFixed(1)}s
              </div>
            </div>
          </div>

          {/* Change audio pitch toggle */}
          <div className="flex items-center justify-between py-2 border-t border-white/5">
            <label className="text-sm text-white/80">Change audio pitch</label>
            <button
              type="button"
              onClick={handlePreservePitchToggle}
              className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                preservePitch ? "bg-white/10" : "bg-cyan-500"
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

      {/* Curve tab (locked) */}
      {activeSubTab === "curve" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Speed curve feature coming soon
        </div>
      )}

      {/* Velocity effects tab (locked) */}
      {activeSubTab === "velocity" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Velocity effects coming soon
        </div>
      )}
    </div>
  );
};
