import React, { useRef, useState } from "react";
import { Link2, Mic, Search, ZoomIn, ZoomOut, ArrowLeftRight, Waves, Undo2, Redo2, ScissorsLineDashed, ChevronLeft, ChevronRight, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { useTimelineStore } from "@/store/timelineStore";
import { useUIStore } from "@/store/uiStore";
import { generateId } from "@/lib/utils/id";
import { useSettingsStore } from "@/store/settingsStore";
import { useHistoryStore } from "@/store/historyStore";
import { RippleDeleteCommand } from "@/core/history/commands/RippleDeleteCommand";
import { DeleteClipCommand } from "@/core/history/commands/DeleteClipCommand";
import { SuccessToast } from "@/components/ui/SuccessToast";
import { DEFAULT_SRP_CONFIG, SpatialTier } from "@/lib/renderEngine/types";
import { clampTimelineZoom, formatCadenceSeconds, getSrpTierForZoom, getTimelineTemporalDetail, getZoomFromRatio, getZoomRatio, snapTimelineZoomToTierAnchors, TIMELINE_TIER_LABELS, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_STEP } from "@/lib/timeline/timelineZoom";
import { useSplitMode } from "@/hooks/useSplitMode";
import { EditingActions } from "@/core/interactions";
import { useAnchoredTimelineZoom, type TimelineZoomAnchor } from "@/hooks/useAnchoredTimelineZoom";

export const TimelineToolbar: React.FC = () => {
  const { zoomLevel, pixelsPerSecond, swapClips, rippleEditEnabled, toggleRippleEdit, tracks, normalizeTrack } = useTimelineStore();
  const { selectedClipIds, clearSelection } = useUIStore();
  const { state: historyState, undo, redo } = useHistoryStore();
  const [splitMode, setSplitMode] = useState(false);
  // const [linkMode, setLinkMode] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const zoomRailRef = useRef<HTMLDivElement>(null);
  const zoomGestureAnchorRef = useRef<TimelineZoomAnchor | null>(null);
  const { captureZoomAnchor, applyZoomLevel, zoomByStep } = useAnchoredTimelineZoom();

  // Split mode hook
  useSplitMode({
    enabled: splitMode,
    onSplit: (clipId, time) => {},
    onMessage: (message) => {
      setToastMessage(message);
      setTimeout(() => setToastMessage(null), 2000);
    },
  });

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
    applyZoomLevel(clampTimelineZoom(snapZoom(getZoomFromRatio(ratio))), zoomGestureAnchorRef.current);
  };

  const handleZoomPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    zoomGestureAnchorRef.current = captureZoomAnchor();
    setZoomFromClientX(e.clientX);
  };

  const handleZoomPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setZoomFromClientX(e.clientX);
  };

  const handleZoomPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    zoomGestureAnchorRef.current = null;
  };

  const handleZoomPointerCancel = () => {
    zoomGestureAnchorRef.current = null;
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      zoomByStep(-1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      zoomByStep(1);
    } else if (e.key === "Home") {
      e.preventDefault();
      applyZoomLevel(TIMELINE_ZOOM_MIN, captureZoomAnchor());
    } else if (e.key === "End") {
      e.preventDefault();
      applyZoomLevel(TIMELINE_ZOOM_MAX, captureZoomAnchor());
    }
  };

  const toolButton = "text-text-muted hover:text-text-primary hover:bg-surface-raised/80 cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-auto";
  const activeButton = "bg-accent/15 text-accent-soft border-accent/40 hover:bg-accent/20";
  const zoomButton = "cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-auto h-8 w-8 rounded-full border border-accent/35 bg-surface-raised text-accent-soft shadow-[0_0_0_1px_rgba(0,0,0,0.28),0_6px_16px_rgba(0,0,0,0.22)] hover:border-accent/60 hover:bg-accent/15 hover:text-text-primary transition-colors";

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

  const handleSplitAllAtPlayhead = () => {
    const results = EditingActions.splitAtPlayhead();
    if (results.length === 0) {
      setToastMessage("No clips under playhead to split");
    } else {
      const successCount = results.filter((r) => r.success).length;
      setToastMessage(`Split ${successCount} clip${successCount > 1 ? "s" : ""}`);
    }
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleDeleteLeftAtPlayhead = () => {
    const results = EditingActions.deleteLeftAtPlayhead();
    if (results.length === 0) {
      setToastMessage("No clips to delete left at playhead");
    } else {
      const successCount = results.filter((r) => r.success).length;
      setToastMessage(`Delete left applied to ${successCount} clip${successCount > 1 ? "s" : ""}`);
    }
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleDeleteRightAtPlayhead = () => {
    const results = EditingActions.deleteRightAtPlayhead();
    if (results.length === 0) {
      setToastMessage("No clips to delete right at playhead");
    } else {
      const successCount = results.filter((r) => r.success).length;
      setToastMessage(`Delete right applied to ${successCount} clip${successCount > 1 ? "s" : ""}`);
    }
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleDeleteSelectedClips = () => {
    if (selectedClipIds.length === 0) return;

    const { clips, normalizeTrack, removeEmptyNonMainTracks, withBatch } = useTimelineStore.getState();
    const { execute, beginTransaction, commitTransaction } = useHistoryStore.getState();
    const affectedTracks = new Set<string>();

    // Use transaction to group all deletes into a single undo/redo unit
    beginTransaction("Delete Clips");

    selectedClipIds.forEach((clipId) => {
      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return;
      affectedTracks.add(clip.trackId);
      // Use ripple delete if ripple mode is enabled, otherwise regular delete
      if (rippleEditEnabled) {
        execute(new RippleDeleteCommand(clipId));
      } else {
        execute(new DeleteClipCommand(clipId));
      }
    });

    commitTransaction();

    // Remove empty tracks after deletion (not part of undo/redo)
    withBatch(() => {
      removeEmptyNonMainTracks(Array.from(affectedTracks));
    });

    clearSelection();
    setToastMessage(`Deleted ${selectedClipIds.length} clip${selectedClipIds.length > 1 ? "s" : ""}`);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleDuplicateSelectedClips = () => {
    if (selectedClipIds.length === 0) return;
    const { clips, addClip } = useTimelineStore.getState();
    const selected = clips.filter((c) => selectedClipIds.includes(c.id)).sort((a, b) => a.startTime - b.startTime);
    if (selected.length === 0) return;
    const minStart = selected[0].startTime;
    const maxEnd = Math.max(...selected.map((c) => c.startTime + c.duration));
    const offset = maxEnd - minStart;
    selected.forEach((clip) => {
      addClip({
        ...clip,
        id: generateId("clip"),
        startTime: clip.startTime + offset,
      });
    });
    setToastMessage(`Duplicated ${selected.length} clip${selected.length > 1 ? "s" : ""}`);
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleCloseGaps = () => {
    const { removeEmptyNonMainTracks } = useTimelineStore.getState();
    const trackIds = tracks.map((t) => t.id);
    trackIds.forEach((trackId) => normalizeTrack(trackId));
    removeEmptyNonMainTracks(trackIds);
    setToastMessage("Closed timeline gaps");
    setTimeout(() => setToastMessage(null), 2000);
  };

  return (
    <TooltipProvider>
      <div data-timeline-interactive="true" className="border-b border-timeline-toolbar-border flex items-center p-1 gap-2">
        <div className="flex items-center gap-1">
          <Tool label="Undo (Cmd+Z)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={undo} disabled={!historyState.canUndo}>
              <Undo2 className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Redo (Cmd+Shift+Z)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={redo} disabled={!historyState.canRedo}>
              <Redo2 className="w-4 h-4" />
            </Button>
          </Tool>

          {selectedClipIds.length === 2 && (
            <Tool label="Swap selected clips (Ctrl+Shift+S)">
              <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleSwapClick}>
                <ArrowLeftRight className="w-4 h-4" />
              </Button>
            </Tool>
          )}

          <Tool label="Delete left at playhead (Q)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleDeleteLeftAtPlayhead}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Delete right at playhead (W)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleDeleteRightAtPlayhead}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Split all at playhead (S)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleSplitAllAtPlayhead}>
              <ScissorsLineDashed className="w-4 h-4" />
            </Button>
          </Tool>

          {/* <Tool label="Link clips">
            <Button variant="ghost" size="icon-sm" className={linkMode ? activeButton : toolButton} onClick={() => setLinkMode(!linkMode)}>
              <Link2 className="w-4 h-4" />
            </Button>
          </Tool> */}

          <Tool label="Ripple mode (R) - Affects drag, trim, and delete operations">
            <Button variant="ghost" size="icon-sm" className={rippleEditEnabled ? activeButton : toolButton} onClick={toggleRippleEdit}>
              <Waves className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Delete selected clip(s)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleDeleteSelectedClips} disabled={selectedClipIds.length === 0}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Duplicate selected clip(s) (Cmd/Ctrl+D)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleDuplicateSelectedClips} disabled={selectedClipIds.length === 0}>
              <Copy className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Close gaps">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={handleCloseGaps}>
              <ScissorsLineDashed className="w-4 h-4" />
            </Button>
          </Tool>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1">
            <Button title="Zoom Out" variant="ghost" size="icon-sm" className={zoomButton} onClick={() => zoomByStep(-1)} disabled={zoomLevel <= TIMELINE_ZOOM_MIN} aria-label="Zoom out timeline">
              <ZoomOut className="w-2 h-2" strokeWidth={2} />
            </Button>

            <div ref={zoomRailRef} role="slider" tabIndex={0} aria-label="Timeline zoom" aria-valuemin={TIMELINE_ZOOM_MIN} aria-valuemax={TIMELINE_ZOOM_MAX} aria-valuenow={zoomLevel} aria-valuetext={`${zoomLevel.toFixed(2)} times, ${currentTierLabel}, ${temporalDetail.label}, ${cadenceLabel} samples`} onPointerDown={handleZoomPointerDown} onPointerMove={handleZoomPointerMove} onPointerUp={handleZoomPointerUp} onPointerCancel={handleZoomPointerCancel} onLostPointerCapture={handleZoomPointerCancel} onKeyDown={handleZoomKeyDown} className="group relative flex h-8 w-44 cursor-pointer touch-none items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
              <div className="relative mx-[11px] h-[7px] w-full overflow-hidden rounded-full bg-surface-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.04),0_5px_14px_rgba(0,0,0,0.28)]">
                {tierSegments.map(({ tier, left, width }) => (
                  <div key={tier} aria-hidden className={`absolute top-0 h-full ${tierBandClass[tier]}`} style={{ left: `${left}%`, width: `${width}%` }} />
                ))}
                <div className="relative h-full rounded-full bg-accent shadow-[0_0_16px_rgba(108,99,255,0.28)]" style={{ width: `${zoomProgress}%` }} />
              </div>
              <div data-testid="timeline-zoom-thumb" className="absolute top-1/2 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border-3 border-accent bg-surface" style={{ left: `${zoomThumbLeftPx}px` }} />
            </div>

            <Button title="Zoom In" variant="ghost" size="icon-sm" className={zoomButton} onClick={() => zoomByStep(1)} disabled={zoomLevel >= TIMELINE_ZOOM_MAX} aria-label="Zoom in timeline">
              <ZoomIn className="w-4 h-4" strokeWidth={2} />
            </Button>
          </span>
        </div>
      </div>

      <SuccessToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
    </TooltipProvider>
  );
};
