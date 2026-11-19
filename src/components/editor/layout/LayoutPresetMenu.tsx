import React, { useState, useEffect, useRef, useCallback } from "react";
import { LayoutGrid, Check } from "lucide-react";
import { useSettingsStore, type LayoutPreset } from "@/store/settingsStore";
import { useClickOutside } from "@/hooks";
import { hideNativeSurfaceWhenIdle } from "@/core/runtime/nativeSurfaceLifecycle";
import { forceRepaintNativeProgramPreview } from "@/core/preview/previewRepaintCoordinator";
import { useI18n } from "@/i18n";

interface PresetOption {
  id: LayoutPreset;
  titleKey: string;
  descKey: string;
  renderIcon: () => React.ReactNode;
}

export const LayoutPresetMenu: React.FC = () => {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const layoutPreset = useSettingsStore((s) => s.layoutPreset);
  const setLayoutPreset = useSettingsStore((s) => s.setLayoutPreset);

  // Calculate fixed position from button bounding rect so the dropdown
  // escapes all parent overflow:hidden / stacking contexts.
  const openMenu = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    setIsOpen(true);
  }, []);

  useClickOutside(menuRef, () => setIsOpen(false), { enabled: isOpen });

  useEffect(() => {
    if (isOpen) {
      void hideNativeSurfaceWhenIdle().catch(() => undefined);
    } else {
      // Menu closed — repaint the canvas so the current frame is visible again.
      forceRepaintNativeProgramPreview();
    }
  }, [isOpen]);

  const presets: PresetOption[] = [
    {
      id: "default",
      titleKey: "layout.presets.default.title",
      descKey: "layout.presets.default.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Top row: 3 columns */}
          <rect
            x="2"
            y="2"
            width="7"
            height="9"
            rx="1"
            className="fill-accent-primary/40"
          />
          <rect
            x="10"
            y="2"
            width="12"
            height="9"
            rx="1"
            className="fill-text-primary/20"
          />
          <rect
            x="23"
            y="2"
            width="7"
            height="9"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Bottom row: Timeline */}
          <rect
            x="2"
            y="13"
            width="28"
            height="9"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
    {
      id: "tall-player-right",
      titleKey: "layout.presets.tallPlayerRight.title",
      descKey: "layout.presets.tallPlayerRight.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Left top: Media & Props */}
          <rect
            x="2"
            y="2"
            width="9"
            height="9"
            rx="1"
            className="fill-accent-primary/40"
          />
          <rect
            x="12"
            y="2"
            width="6"
            height="9"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Left bottom: Timeline */}
          <rect
            x="2"
            y="13"
            width="16"
            height="9"
            rx="1"
            className="fill-accent-primary/70"
          />
          {/* Right column: Full height preview */}
          <rect
            x="20"
            y="2"
            width="10"
            height="20"
            rx="1"
            className="fill-text-primary/25 stroke-accent-primary/50"
          />
        </svg>
      ),
    },
    {
      id: "tall-player-left",
      titleKey: "layout.presets.tallPlayerLeft.title",
      descKey: "layout.presets.tallPlayerLeft.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Left column: Full height preview */}
          <rect
            x="2"
            y="2"
            width="10"
            height="20"
            rx="1"
            className="fill-text-primary/25 stroke-accent-primary/50"
          />
          {/* Right top: Media & Props */}
          <rect
            x="14"
            y="2"
            width="9"
            height="9"
            rx="1"
            className="fill-accent-primary/40"
          />
          <rect
            x="24"
            y="2"
            width="6"
            height="9"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Right bottom: Timeline */}
          <rect
            x="14"
            y="13"
            width="16"
            height="9"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
    {
      id: "timeline-focus",
      titleKey: "layout.presets.timelineFocus.title",
      descKey: "layout.presets.timelineFocus.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Top row: Compact panels */}
          <rect
            x="2"
            y="2"
            width="8"
            height="5"
            rx="1"
            className="fill-accent-primary/40"
          />
          <rect
            x="11"
            y="2"
            width="10"
            height="5"
            rx="1"
            className="fill-text-primary/20"
          />
          <rect
            x="22"
            y="2"
            width="8"
            height="5"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Bottom row: Deep timeline */}
          <rect
            x="2"
            y="9"
            width="28"
            height="13"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
    {
      id: "dual-player",
      titleKey: "layout.presets.dualPlayer.title",
      descKey: "layout.presets.dualPlayer.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Media rail */}
          <rect
            x="2"
            y="2"
            width="4"
            height="10"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Source Monitor */}
          <rect
            x="7"
            y="2"
            width="9"
            height="10"
            rx="1"
            className="fill-text-primary/25 stroke-accent-primary/50"
          />
          {/* Program Monitor */}
          <rect
            x="17"
            y="2"
            width="9"
            height="10"
            rx="1"
            className="fill-text-primary/25 stroke-accent-primary/50"
          />
          {/* Props rail */}
          <rect
            x="27"
            y="2"
            width="3"
            height="10"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Timeline */}
          <rect
            x="2"
            y="14"
            width="28"
            height="8"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
    {
      id: "cinema-preview",
      titleKey: "layout.presets.cinemaPreview.title",
      descKey: "layout.presets.cinemaPreview.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Big Preview Monitor */}
          <rect
            x="2"
            y="2"
            width="28"
            height="15"
            rx="1"
            className="fill-text-primary/25 stroke-accent-primary/50"
          />
          {/* Compact Bottom Timeline */}
          <rect
            x="2"
            y="19"
            width="28"
            height="3"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
    {
      id: "vertical-shorts",
      titleKey: "layout.presets.verticalShorts.title",
      descKey: "layout.presets.verticalShorts.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Left Media */}
          <rect
            x="2"
            y="2"
            width="8"
            height="10"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Center 9:16 Portrait Monitor */}
          <rect
            x="12"
            y="2"
            width="8"
            height="10"
            rx="1"
            className="fill-text-primary/25 stroke-accent-primary/50"
          />
          {/* Right Text/Captions */}
          <rect
            x="22"
            y="2"
            width="8"
            height="10"
            rx="1"
            className="fill-accent-primary/40"
          />
          {/* Timeline */}
          <rect
            x="2"
            y="14"
            width="28"
            height="8"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
    {
      id: "inspector-focus",
      titleKey: "layout.presets.inspectorFocus.title",
      descKey: "layout.presets.inspectorFocus.desc",
      renderIcon: () => (
        <svg
          viewBox="0 0 32 24"
          className="w-8 h-6 rounded border border-border-default bg-surface-elevated p-0.5"
          fill="none"
        >
          {/* Left Preview */}
          <rect
            x="2"
            y="2"
            width="12"
            height="10"
            rx="1"
            className="fill-text-primary/20"
          />
          {/* Right Wide Inspector */}
          <rect
            x="15"
            y="2"
            width="15"
            height="10"
            rx="1"
            className="fill-accent-primary/50 stroke-accent-primary/70"
          />
          {/* Timeline */}
          <rect
            x="2"
            y="14"
            width="28"
            height="8"
            rx="1"
            className="fill-accent-primary/70"
          />
        </svg>
      ),
    },
  ];

  return (
    <div ref={menuRef}>
      <button
        ref={buttonRef}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        className={`flex items-center gap-1.5 h-6 px-2 text-xs rounded font-medium border transition-colors cursor-pointer ${
          isOpen
            ? "bg-accent-primary/20 border-accent-primary/40 text-accent-primary"
            : "bg-surface-elevated border-border-default text-text-secondary hover:text-text-primary hover:border-border-hover hover:bg-surface-hover"
        }`}
        title={t("layout.presets.switchWorkspace")}
        aria-label={t("layout.presets.switchWorkspace")}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-[11px]">
          {t("layout.presets.label")}
        </span>
      </button>

      {isOpen && dropdownPos && (
        <>
          {/* Global click-outside overlay */}
          <div
            className="fixed inset-0 z-[200]"
            onClick={() => setIsOpen(false)}
            onPointerDown={() => setIsOpen(false)}
          />

          {/* Fixed-position dropdown — escapes all parent overflow:hidden stacking contexts */}
          <div
            className="fixed z-[201] w-80 max-h-[85vh] overflow-y-auto scrollbar-thin rounded-xl bg-surface-floating border border-border-default shadow-2xl backdrop-blur-xl p-2 animate-in fade-in zoom-in-95 duration-150"
            style={{ top: dropdownPos.top, right: dropdownPos.right }}
          >
            <div className="px-2 py-1.5 border-b border-border-default/60 mb-1">
              <div className="text-[11px] font-semibold text-text-primary uppercase tracking-wider">
                {t("layout.presets.title")}
              </div>
              <div className="text-[10px] text-text-muted">
                {t("layout.presets.subtitle")}
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
                        ? "bg-accent-primary/10 border border-accent-primary/30 text-accent-primary"
                        : "hover:bg-surface-hover text-text-primary border border-transparent"
                    }`}
                  >
                    <div className="shrink-0">{preset.renderIcon()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold flex items-center justify-between">
                        <span
                          className={
                            isSelected
                              ? "text-accent-primary"
                              : "text-text-primary"
                          }
                        >
                          {t(preset.titleKey)}
                        </span>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted truncate mt-0.5">
                        {t(preset.descKey)}
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
