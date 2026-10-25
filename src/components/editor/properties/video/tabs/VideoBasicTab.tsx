/**
 * VideoBasicTab.tsx
 *
 * Basic video editing controls within the Video tab.
 * Contains flat inline Transform, Blend, and Canvas Background controls.
 */

import React from "react";
import type { Clip } from "@/types";
import { VideoTransformControls } from "../sections/VideoTransformControls";
import { VideoBlendControls } from "../sections/VideoBlendControls";
import { BackgroundInspectorPanel } from "../../project/BackgroundInspectorPanel";
import { EffectsFiltersSection } from "../../effects/sections/EffectsFiltersSection";
import { PropertySectionHeader } from "../../primitives/PropertySectionHeader";

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
    <div className="">
      {/* Section 1: Transform Controls */}
      <div className="pt-1">
        <VideoTransformControls
          selectedClip={selectedClip}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          handleUpdate={handleUpdate}
          handleUpdateMultiple={handleUpdateMultiple}
          handleApplyFit={handleApplyFit}
        />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5 my-4" />

      {/* Section 2: Blend Controls */}
      <div>
        <VideoBlendControls
          selectedClip={selectedClip}
          handleUpdate={handleUpdate}
        />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5 my-4" />

      {/* Section 3: Canvas Background (from EmptyPropertiesState) */}
      <div>
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
