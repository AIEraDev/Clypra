import React, { useCallback } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import type { Clip } from "@/types";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";
import { PropertySection } from "../../primitives/PropertySection";

interface StickerSettingsSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const StickerSettingsSection: React.FC<StickerSettingsSectionProps> = ({
  selectedClip,
  handleUpdate,
}) => {
  const { t } = useI18n();
  const stickerSettings = (selectedClip as any).stickerSettings || {
    speed: 1.0,
    loop: true,
  };
  const speed = stickerSettings.speed ?? 1.0;
  const loop = stickerSettings.loop ?? true;

  const handleSpeedChange = useCallback(
    (newSpeed: number) => {
      handleUpdate("stickerSettings", {
        ...stickerSettings,
        speed: newSpeed,
      });
    },
    [handleUpdate, stickerSettings],
  );

  const toggleLoop = useCallback(() => {
    handleUpdate("stickerSettings", {
      ...stickerSettings,
      loop: !loop,
    });
  }, [handleUpdate, stickerSettings, loop]);

  return (
    <div className="space-y-3">
      <PropertySection
        title={t("properties.sticker.animation")}
        icon={<Gauge className="w-3.5 h-3.5" />}
      >
        <div className="space-y-3">
          {/* Speed slider */}
          <div className="space-y-1">
            <span className="text-[11px] text-text-primary select-none block">
              {t("common.labels.speed")}
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={speed}
                min={0.1}
                max={5.0}
                step={0.1}
                onChange={handleSpeedChange}
              />
              <NumericControl
                value={speed}
                onChange={handleSpeedChange}
                step={0.1}
                suffix="x"
                ariaLabel={t("common.labels.speed")}
                min={0.1}
                max={5.0}
                inputPosition="text-right"
              />
            </div>
          </div>

          {/* Quick-set speed presets */}
          <div className="flex items-center gap-1">
            {[
              { label: "0.5x", value: 0.5 },
              { label: "1.0x", value: 1.0 },
              { label: "1.5x", value: 1.5 },
              { label: "2.0x", value: 2.0 },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => handleSpeedChange(preset.value)}
                className={`flex-1 py-1.5 text-[10px] font-medium rounded transition-all cursor-pointer ${
                  Math.abs(speed - preset.value) < 0.05
                    ? "bg-accent-primary/15 text-accent-primary border border-accent-primary/30"
                    : "text-text-muted hover:text-text-primary hover:bg-surface-hover border border-transparent"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <hr className="border-border-default" />

          {/* Loop toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-text-muted select-none flex items-center gap-1.5">
              <RefreshCw
                className={`w-3.5 h-3.5 ${loop ? "animate-spin-slow text-accent-primary" : ""}`}
              />
              {t("properties.sticker.loopAnimation")}
            </span>
            <button
              onClick={toggleLoop}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                loop
                  ? "bg-accent-primary/15 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/25"
                  : "bg-surface-elevated border border-border-default text-text-muted hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              {loop ? t("common.status.enabled") : t("common.status.disabled")}
            </button>
          </div>
        </div>
      </PropertySection>
    </div>
  );
};
