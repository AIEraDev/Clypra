import React from "react";
import { useTranslation } from "react-i18next";
import type { Clip } from "@/types";
import { type ClipFitModeExtended } from "@/lib/timelineClip";

interface TransformSectionProps {
  selectedClip: Clip;
  isVisualClip: boolean;
  handleUpdate: (key: string, value: any) => void;
  handleApplyFit: (fitMode: ClipFitModeExtended) => void;
}

export const TransformSection: React.FC<TransformSectionProps> = ({ selectedClip, isVisualClip, handleUpdate, handleApplyFit }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      {/* Transform Properties */}
      <div>
        <h4 className="text-sm font-semibold text-text-primary mb-3">{t("properties.transform.title")}</h4>
        <div className="space-y-2">
          {isVisualClip && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-text-muted block mb-1">{t("properties.transform.fitMode")}</label>
                <select value={selectedClip.fitMode ?? "cover"} onChange={(e) => handleApplyFit(e.target.value as ClipFitModeExtended)} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary outline-none">
                  <option value="contain">{t("properties.transform.fit.contain")}</option>
                  <option value="cover">{t("properties.transform.fit.cover")}</option>
                  <option value="fill">{t("properties.transform.fit.fill")}</option>
                  <option value="stretch">{t("properties.transform.fit.stretch")}</option>
                  <option value="original">{t("properties.transform.fit.original")}</option>
                </select>
              </div>
              <div className="flex items-end">
                <button type="button" onClick={() => handleApplyFit(selectedClip.fitMode ?? "cover")} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary hover:bg-white/6 transition-all active:scale-[0.97]">
                  {t("properties.transform.resetFit")}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-muted block mb-1">{t("properties.transform.xPosition")}</label>
              <input type="number" value={Math.round(selectedClip.x)} onChange={(e) => handleUpdate("x", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary outline-none" />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">{t("properties.transform.yPosition")}</label>
              <input type="number" value={Math.round(selectedClip.y)} onChange={(e) => handleUpdate("y", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-muted block mb-1">{t("properties.transform.width")}</label>
              <input type="number" value={Math.round(selectedClip.width)} onChange={(e) => handleUpdate("width", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary outline-none" />
            </div>
            <div>
              <label className="text-xs text-text-muted block mb-1">{t("properties.transform.height")}</label>
              <input type="number" value={Math.round(selectedClip.height)} onChange={(e) => handleUpdate("height", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2 py-1 text-xs text-text-primary outline-none" />
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">{t("properties.transform.rotation")}</label>
            <div className="flex items-center gap-2">
              <input type="range" min="-180" max="180" value={selectedClip.rotation} onChange={(e) => handleUpdate("rotation", Number(e.target.value))} className="grow accent-accent" />
              <input type="number" value={Math.round(selectedClip.rotation)} onChange={(e) => handleUpdate("rotation", Number(e.target.value))} className="w-12 bg-surface-raised border border-border rounded px-2 py-0.5 text-xs text-text-primary text-center outline-none" />
            </div>
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">{t("properties.transform.opacity")}</label>
            <div className="flex items-center gap-2">
              <input type="range" min="0" max="100" value={selectedClip.opacity * 100} onChange={(e) => handleUpdate("opacity", Number(e.target.value) / 100)} className="grow accent-accent" />
              <span className="text-xs text-text-primary w-8 text-right">{Math.round(selectedClip.opacity * 100)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Clip Timing properties */}
      <div className="border-t border-border/40 pt-4">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-text-primary">{t("properties.timing.title")}</h4>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-text-muted block mb-1">{t("properties.timing.trimIn")}</label>
            <input type="number" value={selectedClip.trimIn.toFixed(2)} onChange={(e) => handleUpdate("trimIn", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2.5 py-1 text-xs text-text-primary outline-none" />
          </div>

          <div>
            <label className="text-xs text-text-muted block mb-1">{t("properties.timing.trimOut")}</label>
            <input type="number" value={selectedClip.trimOut.toFixed(2)} onChange={(e) => handleUpdate("trimOut", Number(e.target.value))} className="w-full bg-surface-raised border border-border rounded px-2.5 py-1 text-xs text-text-primary outline-none" />
          </div>
        </div>
      </div>
    </div>
  );
};
