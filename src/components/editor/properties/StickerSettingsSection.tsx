import React, { useCallback } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import type { Clip } from "@/types";
import { t } from "@/i18n";
import { PropertySlider } from "./primitives/PropertySlider";
import { PropertySection } from "./primitives/PropertySection";

interface StickerSettingsSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
}

export const StickerSettingsSection: React.FC<StickerSettingsSectionProps> = ({ selectedClip, handleUpdate }) => {
  const stickerSettings = (selectedClip as any).stickerSettings || { speed: 1.0, loop: true };
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
      <PropertySection title={t("properties.sticker.animation")} icon={<Gauge className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {/* Speed slider */}
          <PropertySlider
            label={t("properties.sticker.speed")}
            value={speed}
            min={0.1}
            max={5.0}
            step={0.1}
            suffix="x"
            onChange={handleSpeedChange}
          />

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
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-text-muted hover:text-text-primary hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <hr className="border-border/40" />

          {/* Loop toggle */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-text-muted select-none flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loop ? "animate-spin-slow text-accent" : ""}`} />
              {t("properties.sticker.loopAnimation")}
            </span>
            <button
              onClick={toggleLoop}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                loop
                  ? "bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25"
                  : "bg-surface-raised border border-border/60 text-text-muted hover:text-text-primary hover:bg-white/[0.04]"
              }`}
            >
              {t(loop ? "properties.sticker.enabled" : "properties.sticker.disabled")}
            </button>
          </div>
        </div>
      </PropertySection>
    </div>
  );
};
