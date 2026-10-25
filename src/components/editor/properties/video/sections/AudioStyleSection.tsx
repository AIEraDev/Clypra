import React, { useState } from "react";
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
  const [activeSubTab, setActiveSubTab] = useState<AudioSubTab>("basic");

  return (
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-(--color-gray-900) pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
          {(["basic", "voice-changer"] as const).map((tab) => {
            const isLocked = tab !== "basic"; // Only Basic is unlocked for now
            const labels = {
              basic: "Basic",
              "voice-changer": "Voice changer",
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
