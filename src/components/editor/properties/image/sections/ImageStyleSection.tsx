/**
 * ImageStyleSection.tsx
 *
 * Root section for image-clip property editing when Image tab is active.
 *
 * Responsibilities:
 * - Sub-tab switcher (Basic / Remove BG / Mask / Retouch)
 * - Organize image editing features by category
 * - Mirrors VideoStyleSection exactly — image clips share the same editing
 *   capabilities as video clips minus audio and speed.
 */

import React, { useState } from "react";
import type { Clip } from "@/types";
import { useI18n } from "@/i18n";
import { VideoBasicTab } from "../../video/tabs/VideoBasicTab";

interface ImageStyleSectionProps {
  selectedClip: Clip;
  isVisualClip: boolean;
  canvasWidth: number;
  canvasHeight: number;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyFit: (fitMode: any) => void;
}

export const ImageStyleSection: React.FC<ImageStyleSectionProps> = ({
  selectedClip,
  isVisualClip,
  canvasWidth,
  canvasHeight,
  handleUpdate,
  handleUpdateMultiple,
  handleApplyFit,
}) => {
  const { t } = useI18n();
  const [imageSubTab, setImageSubTab] = useState<
    "basic" | "removebg" | "mask" | "retouch"
  >("basic");

  return (
    <div className="space-y-1.5 select-none text-text-primary relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-surface-panel pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-surface-elevated p-0.5 rounded-md flex gap-1 border border-border-default">
          {(["basic", "removebg", "mask", "retouch"] as const).map((tab) => {
            const isLocked = tab !== "basic"; // Only Basic is unlocked for now
            const labels = {
              basic: t("properties.subtabs.basic"),
              removebg: t("properties.subtabs.removeBg"),
              mask: t("properties.subtabs.mask"),
              retouch: t("properties.subtabs.retouch"),
            };

            return (
              <button
                key={tab}
                type="button"
                onClick={() => !isLocked && setImageSubTab(tab)}
                disabled={isLocked}
                title={isLocked ? t("common.comingSoon") : undefined}
                className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center flex items-center justify-center gap-1 ${
                  isLocked
                    ? "text-text-muted/40 cursor-not-allowed"
                    : imageSubTab === tab
                      ? "bg-accent-primary text-white shadow-sm font-semibold cursor-pointer"
                      : "text-text-muted hover:text-text-primary hover:bg-surface-hover cursor-pointer"
                }`}
              >
                {labels[tab]}
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

      {/* Basic tab: Transform, Blend, Canvas Background */}
      {imageSubTab === "basic" && (
        <VideoBasicTab
          selectedClip={selectedClip}
          isVisualClip={isVisualClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={handleApplyFit}
        />
      )}

      {/* Remove BG tab */}
      {imageSubTab === "removebg" && (
        <div className="p-4 text-center text-text-muted text-sm">
          {t("properties.adjust.removeBgComingSoon")}
        </div>
      )}

      {/* Mask tab */}
      {imageSubTab === "mask" && (
        <div className="p-4 text-center text-text-muted text-sm">
          {t("properties.adjust.maskComingSoon")}
        </div>
      )}

      {/* Retouch tab */}
      {imageSubTab === "retouch" && (
        <div className="p-4 text-center text-text-muted text-sm">
          {t("properties.adjust.retouchComingSoon")}
        </div>
      )}
    </div>
  );
};
