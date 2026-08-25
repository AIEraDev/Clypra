import React, { useState, useRef } from "react";
import { LayoutGrid, Check } from "lucide-react";
import { useSettingsStore, type LayoutPreset } from "@/store/settingsStore";
import { useClickOutside } from "@/hooks";

interface PresetOption {
  id: LayoutPreset;
  title: string;
  description: string;
  renderIcon: () => React.ReactNode;
}

export const LayoutPresetMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const layoutPreset = useSettingsStore((s) => s.layoutPreset);
  const setLayoutPreset = useSettingsStore((s) => s.setLayoutPreset);

  useClickOutside(menuRef, () => setIsOpen(false), { enabled: isOpen });

  const presets: PresetOption[] = [
    {
      id: "default",
      title: "Default",
      description: "Balanced 3-column top row with full-width timeline",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Top row: 3 columns */}
          <rect
            x="2"
            y="2"
            width="7"
            height="9"
            rx="1"
            className="fill-accent/40"
          />
          <rect
            x="10"
            y="2"
            width="12"
            height="9"
            rx="1"
            className="fill-white/20"
          />
          <rect
            x="23"
            y="2"
            width="7"
            height="9"
            rx="1"
            className="fill-accent/40"
          />
          {/* Bottom row: Timeline */}
          <rect
            x="2"
            y="13"
            width="28"
            height="9"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
    {
      id: "tall-player-right",
      title: "Right Player",
      description: "Tall full-height player on right, media & timeline on left",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Left top: Media & Props */}
          <rect
            x="2"
            y="2"
            width="9"
            height="9"
            rx="1"
            className="fill-accent/40"
          />
          <rect
            x="12"
            y="2"
            width="6"
            height="9"
            rx="1"
            className="fill-accent/40"
          />
          {/* Left bottom: Timeline */}
          <rect
            x="2"
            y="13"
            width="16"
            height="9"
            rx="1"
            className="fill-accent/70"
          />
          {/* Right column: Full height preview */}
          <rect
            x="20"
            y="2"
            width="10"
            height="20"
            rx="1"
            className="fill-white/30 stroke-accent/40"
          />
        </svg>
      ),
    },
    {
      id: "tall-player-left",
      title: "Left Player",
      description: "Tall full-height player on left, editing panels on right",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Left column: Full height preview */}
          <rect
            x="2"
            y="2"
            width="10"
            height="20"
            rx="1"
            className="fill-white/30 stroke-accent/40"
          />
          {/* Right top: Media & Props */}
          <rect
            x="14"
            y="2"
            width="9"
            height="9"
            rx="1"
            className="fill-accent/40"
          />
          <rect
            x="24"
            y="2"
            width="6"
            height="9"
            rx="1"
            className="fill-accent/40"
          />
          {/* Right bottom: Timeline */}
          <rect
            x="14"
            y="13"
            width="16"
            height="9"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
    {
      id: "timeline-focus",
      title: "Timeline Focus",
      description: "Deep timeline for complex multitrack audio & effects",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Top row: Compact panels */}
          <rect
            x="2"
            y="2"
            width="8"
            height="5"
            rx="1"
            className="fill-accent/40"
          />
          <rect
            x="11"
            y="2"
            width="10"
            height="5"
            rx="1"
            className="fill-white/20"
          />
          <rect
            x="22"
            y="2"
            width="8"
            height="5"
            rx="1"
            className="fill-accent/40"
          />
          {/* Bottom row: Deep timeline */}
          <rect
            x="2"
            y="9"
            width="28"
            height="13"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
    {
      id: "dual-player",
      title: "Dual Player",
      description: "Side-by-side Source & Program monitors for footage review",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Media rail */}
          <rect
            x="2"
            y="2"
            width="4"
            height="10"
            rx="1"
            className="fill-accent/40"
          />
          {/* Source Monitor */}
          <rect
            x="7"
            y="2"
            width="9"
            height="10"
            rx="1"
            className="fill-white/25 stroke-accent/40"
          />
          {/* Program Monitor */}
          <rect
            x="17"
            y="2"
            width="9"
            height="10"
            rx="1"
            className="fill-white/25 stroke-accent/40"
          />
          {/* Props rail */}
          <rect
            x="27"
            y="2"
            width="3"
            height="10"
            rx="1"
            className="fill-accent/40"
          />
          {/* Timeline */}
          <rect
            x="2"
            y="14"
            width="28"
            height="8"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
    {
      id: "cinema-preview",
      title: "Cinema Preview",
      description: "Maximized preview monitor for color grading & screening",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Big Preview Monitor */}
          <rect
            x="2"
            y="2"
            width="28"
            height="15"
            rx="1"
            className="fill-white/30 stroke-accent/40"
          />
          {/* Compact Bottom Timeline */}
          <rect
            x="2"
            y="19"
            width="28"
            height="3"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
    {
      id: "vertical-shorts",
      title: "Vertical / Shorts",
      description: "Optimized for TikTok, Reels, and YouTube Shorts",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Left Media */}
          <rect
            x="2"
            y="2"
            width="8"
            height="10"
            rx="1"
            className="fill-accent/40"
          />
          {/* Center 9:16 Portrait Monitor */}
          <rect
            x="12"
            y="2"
            width="8"
            height="10"
            rx="1"
            className="fill-white/35 stroke-accent/40"
          />
          {/* Right Text/Captions */}
          <rect
            x="22"
            y="2"
            width="8"
            height="10"
            rx="1"
            className="fill-accent/40"
          />
          {/* Timeline */}
          <rect
            x="2"
            y="14"
            width="28"
            height="8"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
    {
      id: "inspector-focus",
      title: "Inspector Focus",
      description: "Wide properties panel for keyframing, color, and effects",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-white/15 bg-surface-raised/60 p-0.5"
          fill="none"
        >
          {/* Left Preview */}
          <rect
            x="2"
            y="2"
            width="12"
            height="10"
            rx="1"
            className="fill-white/20"
          />
          {/* Right Wide Inspector */}
          <rect
            x="15"
            y="2"
            width="15"
            height="10"
            rx="1"
            className="fill-accent/50 stroke-accent/60"
          />
          {/* Timeline */}
          <rect
            x="2"
            y="14"
            width="28"
            height="8"
            rx="1"
            className="fill-accent/70"
          />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 h-6 px-2 text-xs rounded font-medium border transition-colors cursor-pointer ${
          isOpen
            ? "bg-accent/20 border-accent/40 text-accent"
            : "bg-surface-raised/60 border-white/10 text-text-muted hover:text-text-primary hover:border-white/20 hover:bg-surface-raised"
        }`}
        title="Switch Workspace Layout (CapCut views)"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-[11px]">Layout</span>
      </button>

      {isOpen && (
        <>
          {/* Global click-outside overlay */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
            onPointerDown={() => setIsOpen(false)}
          />

          {/* Modal dropdown panel */}
          <div className="absolute right-0 top-full mt-1.5 z-50 w-80 max-h-[85vh] overflow-y-auto scrollbar-thin rounded-xl bg-surface-floating/95 border border-border shadow-2xl backdrop-blur-xl p-2 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-2 py-1.5 border-b border-white/6 mb-1">
              <div className="text-[11px] font-semibold text-text-primary uppercase tracking-wider">
                Workspace Layouts
              </div>
              <div className="text-[10px] text-text-muted">
                Choose your preferred editing workspace
              </div>
            </div>

            <div className="space-y-1">
              {presets.map((preset) => {
                const isSelected = layoutPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setLayoutPreset(preset.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-accent/15 border border-accent/30 text-accent"
                        : "hover:bg-white/5 text-text-primary border border-transparent"
                    }`}
                  >
                    <div className="shrink-0">{preset.renderIcon()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold flex items-center justify-between">
                        <span
                          className={
                            isSelected ? "text-accent" : "text-text-primary"
                          }
                        >
                          {preset.title}
                        </span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted truncate mt-0.5">
                        {preset.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
