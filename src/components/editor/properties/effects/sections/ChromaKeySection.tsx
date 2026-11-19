// src/components/editor/properties/ChromaKeySection.tsx
import React from "react";
import { Pipette, Sparkles } from "lucide-react";
import type { Clip } from "@/types";
import { useI18n } from "@/i18n";
import { useTimelineStore } from "@/store/timelineStore";
import { useEyedropper } from "@/core/hooks/useEyedropper";
import { defaultChromaKeyConfig } from "@/types/compositor";
import { PropertySection } from "../../primitives/PropertySection";
import { SliderTrack } from "../../primitives/SliderTrack";
import { NumericControl } from "../../primitives/NumericControl";

interface ChromaKeySectionProps {
  selectedClip: Clip;
  surfaceRef?: React.RefObject<any>;
}

export const ChromaKeySection: React.FC<ChromaKeySectionProps> = ({
  selectedClip,
  surfaceRef,
}) => {
  const { t } = useI18n();
  const updateClipChromaKey = useTimelineStore(
    (state) => state.updateClipChromaKey,
  );
  const { pickColor, isPicking } = useEyedropper(
    surfaceRef ?? { current: null },
  );

  const chromaKey = selectedClip.chromaKey ?? defaultChromaKeyConfig;

  const handleToggle = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateClipChromaKey(selectedClip.id, { enabled: e.target.checked });
  };

  const handlePickColor = async () => {
    const color = await pickColor();
    if (color) {
      updateClipChromaKey(selectedClip.id, { keyColor: color, enabled: true });
    }
  };

  const [r, g, b] = chromaKey.keyColor;
  const colorRgbStr = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

  const headerAction = (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={chromaKey.enabled}
        onChange={handleToggle}
        className="sr-only peer"
      />
      <div className="w-7 h-3.5 bg-surface-raised border border-border-default peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-3.5 peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-2.5 after:w-2.5 after:transition-all peer-checked:bg-accent" />
    </label>
  );

  return (
    <PropertySection
      title={t("properties.chromaKey.title")}
      icon={<Sparkles className="w-3.5 h-3.5" />}
      defaultCollapsed={!chromaKey.enabled}
      action={headerAction}
    >
      <div className="space-y-3 pt-1">
        {/* Color picker / Eyedropper row */}
        <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-surface/60 border border-border-default">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded-md border border-border-default shadow-xs shrink-0"
              style={{ backgroundColor: colorRgbStr }}
            />
            <span className="text-[11px] font-mono text-text-secondary">
              {colorRgbStr}
            </span>
          </div>

          <button
            type="button"
            onClick={handlePickColor}
            disabled={!chromaKey.enabled}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md border transition-all cursor-pointer ${
              !chromaKey.enabled
                ? "opacity-40 cursor-not-allowed bg-surface-raised border-border-default text-text-muted"
                : isPicking
                  ? "bg-accent-primary border-accent-primary text-white animate-pulse shadow-xs shadow-accent-primary/30"
                  : "bg-surface-raised hover:bg-surface-hover border-border-default text-text-secondary hover:text-text-primary"
            }`}
          >
            <Pipette className="w-3 h-3" />
            <span>{isPicking ? t("properties.chromaKey.clickCanvas") : t("properties.chromaKey.eyedropper")}</span>
          </button>
        </div>

        {/* Sliders */}
        <div
          className={
            chromaKey.enabled
              ? "space-y-3"
              : "space-y-3 opacity-40 pointer-events-none"
          }
        >
          {/* Tolerance */}
          <div className="space-y-1">
            <span className="text-[11px] text-text-primary select-none block">
              {t("properties.chromaKey.tolerance")}
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={Math.round(chromaKey.tolerance * 100)}
                min={0}
                max={100}
                step={1}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, { tolerance: v / 100 })
                }
              />
              <NumericControl
                value={Math.round(chromaKey.tolerance * 100)}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, { tolerance: v / 100 })
                }
                step={1}
                suffix="%"
                ariaLabel={t("properties.chromaKey.tolerance")}
                min={0}
                max={100}
                inputPosition="text-right"
              />
            </div>
          </div>

          {/* Edge Softness */}
          <div className="space-y-1">
            <span className="text-[11px] text-text-primary select-none block">
              {t("properties.chromaKey.edgeSoftness")}
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={Math.round(chromaKey.smoothness * 100)}
                min={0}
                max={100}
                step={1}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, { smoothness: v / 100 })
                }
              />
              <NumericControl
                value={Math.round(chromaKey.smoothness * 100)}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, { smoothness: v / 100 })
                }
                step={1}
                suffix="%"
                ariaLabel={t("properties.chromaKey.edgeSoftness")}
                min={0}
                max={100}
                inputPosition="text-right"
              />
            </div>
          </div>

          {/* Despill Cleanup */}
          <div className="space-y-1">
            <span className="text-[11px] text-text-primary select-none block">
              {t("properties.chromaKey.despill")}
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={Math.round(chromaKey.despillAmount * 100)}
                min={0}
                max={100}
                step={1}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, {
                    despillAmount: v / 100,
                  })
                }
              />
              <NumericControl
                value={Math.round(chromaKey.despillAmount * 100)}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, {
                    despillAmount: v / 100,
                  })
                }
                step={1}
                suffix="%"
                ariaLabel={t("properties.chromaKey.despill")}
                min={0}
                max={100}
                inputPosition="text-right"
              />
            </div>
          </div>

          {/* Matte Pedestal */}
          <div className="space-y-1">
            <span className="text-[11px] text-text-primary select-none block">
              {t("properties.chromaKey.mattePedestal")}
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={Math.round(chromaKey.mattePedestal * 100)}
                min={0}
                max={50}
                step={1}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, {
                    mattePedestal: v / 100,
                  })
                }
              />
              <NumericControl
                value={Math.round(chromaKey.mattePedestal * 100)}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, {
                    mattePedestal: v / 100,
                  })
                }
                step={1}
                suffix="%"
                ariaLabel={t("properties.chromaKey.mattePedestal")}
                min={0}
                max={50}
                inputPosition="text-right"
              />
            </div>
          </div>

          {/* Matte Highlight */}
          <div className="space-y-1">
            <span className="text-[11px] text-text-primary select-none block">
              {t("properties.chromaKey.matteHighlight")}
            </span>
            <div className="flex items-center gap-2">
              <SliderTrack
                value={Math.round(chromaKey.matteHighlight * 100)}
                min={50}
                max={100}
                step={1}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, {
                    matteHighlight: v / 100,
                  })
                }
              />
              <NumericControl
                value={Math.round(chromaKey.matteHighlight * 100)}
                onChange={(v) =>
                  updateClipChromaKey(selectedClip.id, {
                    matteHighlight: v / 100,
                  })
                }
                step={1}
                suffix="%"
                ariaLabel={t("properties.chromaKey.matteHighlight")}
                min={50}
                max={100}
                inputPosition="text-right"
              />
            </div>
          </div>
        </div>
      </div>
    </PropertySection>
  );
};
