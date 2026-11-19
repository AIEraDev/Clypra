import React, { useState } from "react";
import { useI18n } from "@/i18n";
import type { Clip } from "@/types";
import { AudioSection } from "../../audio/sections/AudioSection";

type AudioSubTab = "basic" | "voice-changer";

interface AudioStyleSectionProps {
  selectedClip: Clip;
  handleUpdate: (key: string, value: any) => void;
  onUnlink?: () => void;
  onRelink?: () => void;
}

export const AudioStyleSection: React.FC<AudioStyleSectionProps> = ({
  selectedClip,
  handleUpdate,
  onUnlink,
  onRelink,
}) => {
  const { t } = useI18n();
  const [activeSubTab, setActiveSubTab] = useState<AudioSubTab>("basic");

  return (
    <div className="space-y-1.5 select-none text-text-primary relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-surface-panel pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-surface-elevated p-0.5 rounded-md flex gap-1 border border-border-default">
          {(["basic", "voice-changer"] as const).map((tab) => {
            const isLocked = tab !== "basic"; // Only Basic is unlocked for now
            const labels = {
              basic: t("properties.text.basicTab"),
              "voice-changer": t("properties.tabs.voiceChanger"),
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

      {/* Basic Tab Content */}
      {activeSubTab === "basic" && (
        <AudioSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
          onUnlink={onUnlink}
          onRelink={onRelink}
        />
      )}
    </div>
  );
};
