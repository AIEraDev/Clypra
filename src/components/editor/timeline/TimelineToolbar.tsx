import React, { useState } from "react";
import { Plus, MousePointer2, Scissors, Magnet, Link2, Mic, Search, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/Tooltip";
import { useTimelineStore } from "../../../store/timelineStore";

export const TimelineToolbar: React.FC = () => {
  const { zoomLevel, setZoom, addTrack } = useTimelineStore();
  const [snapMode, setSnapMode] = useState(true);
  const [splitMode, setSplitMode] = useState(false);
  const [linkMode, setLinkMode] = useState(true);

  const handleZoomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setZoom(Number(e.target.value));
  };

  const toolButton = "text-text-muted hover:text-text-primary hover:bg-surface-raised/80";
  const activeButton = "bg-cyan-500/15 text-cyan-300 border-cyan-400/40 hover:bg-cyan-500/20";

  const Tool = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider>
      <div className="h-12 border-b border-[#2c2f34] flex items-center px-3 gap-2">
        <div className="flex items-center gap-1">
          <Tool label="Add video track">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => addTrack("video")}>
              <Plus className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Swap Clips">
            <Button variant="ghost" size="icon-sm" className={toolButton}>
              <MousePointer2 className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Select tool">
            <Button variant="ghost" size="icon-sm" className={toolButton}>
              <MousePointer2 className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Cut tool">
            <Button variant="ghost" size="icon-sm" className={splitMode ? activeButton : toolButton} onClick={() => setSplitMode(!splitMode)}>
              <Scissors className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Link clips">
            <Button variant="ghost" size="icon-sm" className={linkMode ? activeButton : toolButton} onClick={() => setLinkMode(!linkMode)}>
              <Link2 className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Snap">
            <Button variant="ghost" size="icon-sm" className={snapMode ? activeButton : toolButton} onClick={() => setSnapMode(!snapMode)}>
              <Magnet className="w-4 h-4" />
            </Button>
          </Tool>
          <div className="w-px h-6 bg-[#30343a] mx-1" />
          <Tool label="Record audio">
            <Button variant="ghost" size="icon-sm" className={toolButton}>
              <Mic className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Search in timeline">
            <Button variant="ghost" size="icon-sm" className={toolButton}>
              <Search className="w-4 h-4" />
            </Button>
          </Tool>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Tool label="Zoom out">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => setZoom(Math.max(0.5, zoomLevel - 0.1))}>
              <ZoomOut className="w-4 h-4" />
            </Button>
          </Tool>

          <input type="range" min="0.5" max="5" step="0.1" value={zoomLevel} onChange={handleZoomChange} className="w-36 accent-cyan-400" />

          <Tool label="Zoom in">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => setZoom(Math.min(5, zoomLevel + 0.1))}>
              <ZoomIn className="w-4 h-4" />
            </Button>
          </Tool>
          <span className="text-xs text-[#99a2ad] w-10 text-right">{zoomLevel.toFixed(1)}x</span>
        </div>
      </div>
    </TooltipProvider>
  );
};
