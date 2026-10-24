/**
 * VideoBasicTab.tsx
 *
 * Basic video editing controls within the Video tab.
 * Contains flat inline Transform, Blend, and Canvas Background controls.
 */

import React from "react";
import type { Clip } from "@/types";
import { VideoTransformControls } from "./VideoTransformControls";
import { VideoBlendControls } from "./VideoBlendControls";
import { BackgroundInspectorPanel } from "./BackgroundInspectorPanel";
import { EffectsFiltersSection } from "./EffectsFiltersSection";

interface VideoBasicTabProps {
  selectedClip: Clip;
  isVisualClip: boolean;
  canvasWidth: number;
  canvasHeight: number;
  handleUpdate: (key: string, value: any) => void;
  handleUpdateMultiple: (fields: Record<string, any>) => void;
  handleApplyFit: (fitMode: any) => void;
}

export const VideoBasicTab: React.FC<VideoBasicTabProps> = ({
  selectedClip,
  isVisualClip,
  canvasWidth,
  canvasHeight,
  handleUpdate,
  handleUpdateMultiple,
  handleApplyFit,
}) => {
  return (
    <div className="space-y-6">
      {/* Section 1: Transform Controls */}
      <div>
        <h3 className="text-xs font-semibold text-white/60 mb-3 uppercase tracking-wider">
          Transform
        </h3>
        <VideoTransformControls
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={handleApplyFit}
        />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* Section 2: Blend Controls */}
      <div>
        <h3 className="text-xs font-semibold text-white/60 mb-3 uppercase tracking-wider">
          Blend
        </h3>
        <VideoBlendControls
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* Section 3: Canvas Background (from EmptyPropertiesState) */}
      <div>
        <h3 className="text-xs font-semibold text-white/60 mb-3 uppercase tracking-wider">
          Canvas Background
        </h3>
        <BackgroundInspectorPanel />
      </div>

      {/* Collapsible Sections */}
      {/* <div className="space-y-1.5">
        <EffectsFiltersSection
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      </div> */}
    </div>
  );
};
