import React from "react";
import { Zap, Sparkles, Gem } from "lucide-react";
import { t, type MessageKey } from "@/i18n";

export type ExportPreset = "1080p-fast" | "1080p-quality" | "720p-fast" | "4k-quality" | "prores-422hq";

export interface PresetConfig {
  labelKey: MessageKey;
  shortLabel: string;
  resolution: string;
  codec: string;
  codecLabel: string;
  tier: "fast" | "quality" | "pro";
  tierLabelKey: MessageKey;
  width: number;
  height: number;
  codecValue: "h264" | "h265" | "prores";
  preset: "ultrafast" | "fast" | "medium" | "slow" | "veryslow";
  crf: number;
  pixelFormat: "yuv420p" | "yuv444p" | "yuv422p10le";
  estimatedBitrateMbps: number;
}

interface ExportPresetCardProps {
  presetKey: ExportPreset;
  config: PresetConfig;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function TierIcon({ tier, className }: { tier: "fast" | "quality" | "pro"; className?: string }) {
  switch (tier) {
    case "fast":
      return <Zap className={className} />;
    case "quality":
      return <Sparkles className={className} />;
    case "pro":
      return <Gem className={className} />;
  }
}

export const ExportPresetCard: React.FC<ExportPresetCardProps> = ({ config, selected, disabled, onSelect }) => {
  const tierColors = {
    fast: "text-emerald-400",
    quality: "text-amber-400",
    pro: "text-violet-400",
  };

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={t(config.labelKey)}
      className={`
        group relative w-full md:w-full min-w-[150px] shrink-0 text-left rounded-xl p-3 transition-all duration-200 outline-none
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${selected ? "bg-accent/10 border border-accent/40 ring-1 ring-accent/20" : "bg-white/2 border border-white/6 hover:bg-white/4 hover:border-white/10"}
      `}
    >
      {/* Selected indicator dot */}
      {selected && <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />}

      {/* Resolution badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`text-[13px] font-bold tracking-tight ${selected ? "text-accent" : "text-text-primary"}`}>{config.shortLabel}</span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${selected ? "bg-accent/15 text-accent" : "bg-white/6 text-text-muted"}`}>{config.codecLabel}</span>
      </div>

      {/* Tier label */}
      <div className="flex items-center gap-1.5">
        <TierIcon tier={config.tier} className={`w-3 h-3 ${tierColors[config.tier]}`} />
        <span className={`text-[11px] font-medium ${tierColors[config.tier]}`}>{t(config.tierLabelKey)}</span>
        <span className="text-[10px] text-text-muted ml-auto">{config.resolution}</span>
      </div>
    </button>
  );
};
