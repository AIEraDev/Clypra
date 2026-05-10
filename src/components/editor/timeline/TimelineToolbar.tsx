import React, { useRef, useState } from "react";
import { Plus, MousePointer2, Scissors, Magnet, Link2, Mic, Search, ZoomIn, ZoomOut, ArrowLeftRight, Waves } from "lucide-react";
import { Button } from "../../ui/Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/Tooltip";
import { useTimelineStore } from "../../../store/timelineStore";
import { useUIStore } from "../../../store/uiStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { SuccessToast } from "../../ui/SuccessToast";
import { DEFAULT_SRP_CONFIG, SpatialTier } from "../../../lib/renderEngine/types";
import { clampTimelineZoom, formatCadenceSeconds, getSrpTierForZoom, getTimelineTemporalDetail, getZoomFromRatio, getZoomRatio, snapTimelineZoomToTierAnchors, TIMELINE_TIER_LABELS, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_STEP } from "../../../lib/timelineZoom";

export const TimelineToolbar: React.FC = () => {
  const { zoomLevel, pixelsPerSecond, setZoom, addTrack, swapClips, rippleEditEnabled, toggleRippleEdit } = useTimelineStore();
  const { selectedClipIds } = useUIStore();
  const { snapToGrid, setSnapToGrid } = useSettingsStore();
  const [splitMode, setSplitMode] = useState(false);
  const [linkMode, setLinkMode] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const zoomRailRef = useRef<HTMLDivElement>(null);

  const ZOOM_THUMB_SIZE_PX = 22;
  const ZOOM_RAIL_WIDTH_PX = 176; // w-44
  const zoomRatio = getZoomRatio(zoomLevel);
  const zoomProgress = zoomRatio * 100;
  const zoomThumbLeftPx = ZOOM_THUMB_SIZE_PX / 2 + zoomRatio * (ZOOM_RAIL_WIDTH_PX - ZOOM_THUMB_SIZE_PX);
  const currentSrpTier = getSrpTierForZoom(zoomLevel);
  const currentTierLabel = TIMELINE_TIER_LABELS[currentSrpTier];
  const temporalDetail = getTimelineTemporalDetail(pixelsPerSecond);
  const cadenceLabel = formatCadenceSeconds(temporalDetail.baseInterval);
  const snapZoom = (value: number) => {
    const stepped = Number((Math.round(value / TIMELINE_ZOOM_STEP) * TIMELINE_ZOOM_STEP).toFixed(2));
    return snapTimelineZoomToTierAnchors(stepped);
  };
  const tierSegments = ([SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3] as const).map((tier) => {
    const boundary = DEFAULT_SRP_CONFIG[tier];
    const left = getZoomRatio(boundary.min) * 100;
    const width = (getZoomRatio(boundary.max) - getZoomRatio(boundary.min)) * 100;
    return { tier, left, width };
  });
  const tierBandClass: Record<SpatialTier, string> = {
    [SpatialTier.L0]: "bg-accent/20",
    [SpatialTier.L1]: "bg-accent/35",
    [SpatialTier.L2]: "bg-accent/50",
    [SpatialTier.L3]: "bg-accent/70",
  };

  const setZoomFromClientX = (clientX: number) => {
    const rail = zoomRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const inset = ZOOM_THUMB_SIZE_PX / 2;
    const usableWidth = Math.max(1, rect.width - ZOOM_THUMB_SIZE_PX);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - inset) / usableWidth));
    setZoom(clampTimelineZoom(snapZoom(getZoomFromRatio(ratio))));
  };

  const handleZoomPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setZoomFromClientX(e.clientX);
  };

  const handleZoomPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setZoomFromClientX(e.clientX);
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      setZoom(clampTimelineZoom(zoomLevel - TIMELINE_ZOOM_STEP));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      setZoom(clampTimelineZoom(zoomLevel + TIMELINE_ZOOM_STEP));
    } else if (e.key === "Home") {
      e.preventDefault();
      setZoom(TIMELINE_ZOOM_MIN);
    } else if (e.key === "End") {
      e.preventDefault();
      setZoom(TIMELINE_ZOOM_MAX);
    }
  };

  const toolButton = "text-text-muted hover:text-text-primary hover:bg-surface-raised/80";
  const activeButton = "bg-accent/15 text-accent-soft border-accent/40 hover:bg-accent/20";
  const zoomButton = "cursor-pointer h-8 w-8 rounded-full border border-accent/35 bg-surface-raised text-accent-soft shadow-[0_0_0_1px_rgba(0,0,0,0.28),0_6px_16px_rgba(0,0,0,0.22)] hover:border-accent/60 hover:bg-accent/15 hover:text-text-primary transition-colors";

  const Tool = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );

  const handleSwapClick = () => {
    const result = swapClips();
    if (result.error) {
      setToastMessage(result.error);
    }
  };

  return (
    <TooltipProvider>
      <div data-timeline-interactive="true" className="h-12 border-b border-timeline-toolbar-border flex items-center px-3 gap-2">
        <div className="flex items-center gap-1">
          <Tool label="Add video track">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => addTrack("video")}>
              <Plus className="w-4 h-4" />
            </Button>
          </Tool>
          {selectedClipIds.length === 2 && (
            <Tool label="Swap selected clips (Ctrl+Shift+S)">
              <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleSwapClick}>
                <ArrowLeftRight className="w-4 h-4" />
              </Button>
            </Tool>
          )}
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
            <Button variant="ghost" size="icon-sm" className={snapToGrid ? activeButton : toolButton} onClick={() => setSnapToGrid(!snapToGrid)}>
              <Magnet className="w-4 h-4" />
            </Button>
          </Tool>
          <Tool label="Ripple edit mode (R) - Hold Shift while trimming">
            <Button variant="ghost" size="icon-sm" className={rippleEditEnabled ? activeButton : toolButton} onClick={toggleRippleEdit}>
              <Waves className="w-4 h-4" />
            </Button>
          </Tool>
          <div className="w-px h-6 bg-timeline-toolbar-divider mx-1" />
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
          <span className="inline-flex items-center gap-1">
            <Button title="Zoom Out" variant="ghost" size="icon-sm" className={zoomButton} onClick={() => setZoom(clampTimelineZoom(zoomLevel - TIMELINE_ZOOM_STEP))} aria-label="Zoom out timeline">
              <ZoomOut className="w-2 h-2" strokeWidth={2} />
            </Button>

            <div ref={zoomRailRef} role="slider" tabIndex={0} aria-label="Timeline zoom" aria-valuemin={TIMELINE_ZOOM_MIN} aria-valuemax={TIMELINE_ZOOM_MAX} aria-valuenow={zoomLevel} aria-valuetext={`${zoomLevel.toFixed(2)} times, ${currentTierLabel}, ${temporalDetail.label}, ${cadenceLabel} samples`} onPointerDown={handleZoomPointerDown} onPointerMove={handleZoomPointerMove} onKeyDown={handleZoomKeyDown} className="group relative flex h-8 w-44 cursor-pointer touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
              <div className="relative mx-[11px] h-[7px] w-full overflow-hidden rounded-full bg-surface-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.04),0_5px_14px_rgba(0,0,0,0.28)]">
                {tierSegments.map(({ tier, left, width }) => (
                  <div key={tier} aria-hidden className={`absolute top-0 h-full ${tierBandClass[tier]}`} style={{ left: `${left}%`, width: `${width}%` }} />
                ))}
                <div className="relative h-full rounded-full bg-accent shadow-[0_0_16px_rgba(108,99,255,0.28)]" style={{ width: `${zoomProgress}%` }} />
              </div>
              <div data-testid="timeline-zoom-thumb" className="absolute top-1/2 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border-3 border-accent bg-surface" style={{ left: `${zoomThumbLeftPx}px` }} />
            </div>

            <Button title="Zoom In" variant="ghost" size="icon-sm" className={zoomButton} onClick={() => setZoom(clampTimelineZoom(zoomLevel + TIMELINE_ZOOM_STEP))} aria-label="Zoom in timeline">
              <ZoomIn className="w-4 h-4" strokeWidth={2} />
            </Button>
          </span>
        </div>
      </div>

      <SuccessToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </TooltipProvider>
  );
};
