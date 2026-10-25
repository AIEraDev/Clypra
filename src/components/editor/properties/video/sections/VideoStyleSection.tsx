/**
 * VideoStyleSection.tsx
 *
 * Root section for video-clip property editing when Video tab is active.
 *
 * Responsibilities:
 * - Sub-tab switcher (Basic / Remove BG / Mask / Retouch)
 * - Organize video editing features by category
 * - Match TextStyleSection's design pattern
 */

import React, { useState } from "react";
import type { Clip } from "@/types";
import { VideoBasicTab } from "../tabs/VideoBasicTab";

interface VideoStyleSectionProps {
  selectedClip: Clip;
  isVisualClip: boolean;
  canvasWidth: number;
  canvasHeight: number;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyFit: (fitMode: any) => void;
}

export const VideoStyleSection: React.FC<VideoStyleSectionProps> = ({
  selectedClip,
  isVisualClip,
  canvasWidth,
  canvasHeight,
  handleUpdate,
  handleUpdateMultiple,
  handleApplyFit,
}) => {
  const [videoSubTab, setVideoSubTab] = useState<
    "basic" | "removebg" | "mask" | "retouch"
  >("basic");

  return (
    <div className="space-y-1.5 select-none text-white relative p-2 pt-0">
      {/* Sticky header: sub-tab switcher */}
      <div className="bg-(--color-gray-900) pt-2 sticky top-0 z-10 space-y-1.5">
        <div className="bg-panel p-0.5 rounded-sm flex gap-1 border border-white/5">
          {(["basic", "removebg", "mask", "retouch"] as const).map((tab) => {
            const isLocked = tab !== "basic"; // Only Basic is unlocked for now
            const labels = {
              basic: "Basic",
              removebg: "Remove BG",
              mask: "Mask",
              retouch: "Retouch",
            };

            return (
              <button
                key={tab}
                type="button"
                onClick={() => !isLocked && setVideoSubTab(tab)}
                disabled={isLocked}
                title={isLocked ? "Coming soon" : undefined}
                className={`flex-1 py-0.5 text-xs rounded-sm transition-all text-center flex items-center justify-center gap-1 ${
                  isLocked
                    ? "text-[#8e8e93]/50 cursor-not-allowed"
                    : videoSubTab === tab
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

      {/* Basic tab: Transform, Adjustments, ChromaKey, Effects */}
      {videoSubTab === "basic" && (
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
      {videoSubTab === "removebg" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Remove Background feature coming soon
        </div>
      )}

      {/* Mask tab */}
      {videoSubTab === "mask" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Mask feature coming soon
        </div>
      )}

      {/* Retouch tab */}
      {videoSubTab === "retouch" && (
        <div className="p-4 text-center text-text-muted text-sm">
          Retouch feature coming soon
        </div>
      )}
    </div>
  );
};
