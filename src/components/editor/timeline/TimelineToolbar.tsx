import React, { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, ArrowLeftRight, Undo2, Redo2, ScissorsLineDashed, ChevronLeft, ChevronRight, Trash2, Copy, Maximize2, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { useTimelineStore } from "@/store/timelineStore";
import { useSettingsStore, type PreviewQuality } from "@/store/settingsStore";
import { useHistoryStore } from "@/store/historyStore";
import { DEFAULT_SRP_CONFIG, SpatialTier } from "@/lib/renderEngine/types";
import { clampTimelineZoom, formatCadenceSeconds, getSrpTierForZoom, getTimelineTemporalDetail, getZoomFromRatio, getZoomRatio, snapTimelineZoomToTierAnchors, TIMELINE_TIER_LABELS, TIMELINE_ZOOM_MAX, TIMELINE_ZOOM_MIN, TIMELINE_ZOOM_STEP } from "@/lib/timeline/timelineZoom";
import { useClipCommands, useTimelineCommands } from "@/core/commands";
import { useAnchoredTimelineZoom } from "@/hooks";
import type { TimelineZoomAnchor } from "@/hooks/timeline/useAnchoredTimelineZoom";
import { VoiceoverRecorderButton } from "./VoiceoverRecorderButton";

const ZOOM_THUMB_SIZE_PX = 22;
const ZOOM_RAIL_WIDTH_PX = 176; // w-44

const TIER_SEGMENTS = ([SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3] as const).map((tier) => {
  const boundary = DEFAULT_SRP_CONFIG[tier];
  const left = getZoomRatio(boundary.min) * 100;
  const width = (getZoomRatio(boundary.max) - getZoomRatio(boundary.min)) * 100;
  return { tier, left, width };
});

const TIER_BAND_CLASS: Record<SpatialTier, string> = {
  [SpatialTier.L0]: "bg-accent/20",
  [SpatialTier.L1]: "bg-accent/35",
  [SpatialTier.L2]: "bg-accent/50",
  [SpatialTier.L3]: "bg-accent/70",
};

const TimelineToolbarComponent: React.FC = () => {
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);
  const pixelsPerSecond = useTimelineStore((s) => s.pixelsPerSecond);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);

  const historyState = useHistoryStore((s) => s.state);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const { previewQuality, setPreviewQuality, proxyEditingEnabled } = useSettingsStore();
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const zoomRailRef = useRef<HTMLDivElement>(null);
  const zoomGestureAnchorRef = useRef<TimelineZoomAnchor | null>(null);
  const zoomDragRafRef = useRef<number | null>(null);
  const pendingZoomClientXRef = useRef<number | null>(null);
  const { captureZoomAnchor, applyZoomLevel, zoomByStep, fitSequence } = useAnchoredTimelineZoom();
  const { resolvedCommands: resolvedClipCommands, executeCommand: executeClipCommand } = useClipCommands(null);
  const { resolvedCommands: resolvedTimelineCommands, executeCommand: executeTimelineCommand } = useTimelineCommands(null, 0);

  const getClipCommand = (id: string) => resolvedClipCommands.find((item) => item.command.id === id);
  const getTimelineCommand = (id: string) => resolvedTimelineCommands.find((item) => item.command.id === id);

  const zoomRatio = getZoomRatio(zoomLevel);
  const zoomProgress = zoomRatio * 100;
  const zoomThumbLeftPx = ZOOM_THUMB_SIZE_PX / 2 + zoomRatio * (ZOOM_RAIL_WIDTH_PX - ZOOM_THUMB_SIZE_PX);
  const currentSrpTier = getSrpTierForZoom(zoomLevel);
  const currentTierLabel = TIMELINE_TIER_LABELS[currentSrpTier];
  const temporalDetail = getTimelineTemporalDetail(pixelsPerSecond);
  const cadenceLabel = formatCadenceSeconds(temporalDetail.baseInterval);
  const hasTimelineContent = tracks.length > 0 || clips.length > 0;
  const snapZoom = (value: number) => {
    const stepped = Number((Math.round(value / TIMELINE_ZOOM_STEP) * TIMELINE_ZOOM_STEP).toFixed(2));
    return snapTimelineZoomToTierAnchors(stepped);
  };

  const setZoomFromClientX = (clientX: number) => {
    if (!hasTimelineContent) return;
    const rail = zoomRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const inset = ZOOM_THUMB_SIZE_PX / 2;
    const usableWidth = Math.max(1, rect.width - ZOOM_THUMB_SIZE_PX);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - inset) / usableWidth));
    applyZoomLevel(clampTimelineZoom(snapZoom(getZoomFromRatio(ratio))), zoomGestureAnchorRef.current);
  };

  const flushZoomDrag = () => {
    if (zoomDragRafRef.current !== null) {
      cancelAnimationFrame(zoomDragRafRef.current);
      zoomDragRafRef.current = null;
    }
    const clientX = pendingZoomClientXRef.current;
    pendingZoomClientXRef.current = null;
    if (clientX !== null) setZoomFromClientX(clientX);
  };

  const queueZoomDrag = (clientX: number) => {
    pendingZoomClientXRef.current = clientX;
    if (zoomDragRafRef.current === null) {
      zoomDragRafRef.current = requestAnimationFrame(() => {
        zoomDragRafRef.current = null;
        const nextClientX = pendingZoomClientXRef.current;
        pendingZoomClientXRef.current = null;
        if (nextClientX !== null) setZoomFromClientX(nextClientX);
      });
    }
  };

  useEffect(() => () => {
    if (zoomDragRafRef.current !== null) cancelAnimationFrame(zoomDragRafRef.current);
    zoomDragRafRef.current = null;
    pendingZoomClientXRef.current = null;
  }, []);

  const handleZoomPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTimelineContent) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    zoomGestureAnchorRef.current = captureZoomAnchor();
    setZoomFromClientX(e.clientX);
  };

  const handleZoomPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTimelineContent) return;
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    queueZoomDrag(e.clientX);
  };

  const handleZoomPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTimelineContent) return;
    flushZoomDrag();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    zoomGestureAnchorRef.current = null;
  };

  const handleZoomPointerCancel = () => {
    if (zoomDragRafRef.current !== null) cancelAnimationFrame(zoomDragRafRef.current);
    zoomDragRafRef.current = null;
    pendingZoomClientXRef.current = null;
    zoomGestureAnchorRef.current = null;
  };

  const handleZoomKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasTimelineContent) return;
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

          {getClipCommand("clip.swap")?.isVisible && (
            <Tool label="Swap selected clips (Ctrl+Shift+S)">
              <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeClipCommand("clip.swap")} disabled={!getClipCommand("clip.swap")?.isEnabled}>
                <ArrowLeftRight className="w-4 h-4" />
              </Button>
            </Tool>
          )}

          <Tool label="Delete left at playhead (Q)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeClipCommand("clip.trimStartToPlayhead")} disabled={!getClipCommand("clip.trimStartToPlayhead")?.isEnabled}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Delete right at playhead (W)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeClipCommand("clip.trimEndToPlayhead")} disabled={!getClipCommand("clip.trimEndToPlayhead")?.isEnabled}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Split all at playhead (S)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeClipCommand("clip.splitAllAtPlayhead")} disabled={!getClipCommand("clip.splitAllAtPlayhead")?.isEnabled}>
              <ScissorsLineDashed className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Delete selected clip(s)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeClipCommand("clip.rippleDelete")} disabled={!getClipCommand("clip.rippleDelete")?.isEnabled}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Duplicate selected clip(s) (Cmd/Ctrl+D)">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeClipCommand("clip.duplicate")} disabled={!getClipCommand("clip.duplicate")?.isEnabled}>
              <Copy className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label="Close gaps">
            <Button variant="ghost" size="icon-sm" className={toolButton} onClick={() => executeTimelineCommand("timeline.closeAllGaps")} disabled={!getTimelineCommand("timeline.closeAllGaps")?.isEnabled}>
              <ScissorsLineDashed className="w-4 h-4" />
            </Button>
          </Tool>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Proxy Mode indicator badge */}
          {proxyEditingEnabled && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-warning/15 border border-status-warning/30 text-status-warning text-[10px] font-semibold shrink-0">
              <Zap className="w-3 h-3" />
              Proxy Mode
            </span>
          )}

          {/* Preview Quality Quick Picker */}
          <div className="relative">
            <button
              onClick={() => setShowQualityMenu((v) => !v)}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-raised border border-white/6 text-[10px] font-semibold text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              title="Preview resolution (does not affect final export)"
            >
              <Zap className="w-3 h-3 text-accent" />
              {{ full: "Full", high: "High", medium: "Med", low: "Proxy" }[previewQuality]}
            </button>
            {showQualityMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowQualityMenu(false)} />
                <div className="absolute bottom-full right-0 mb-1.5 z-50 bg-surface-floating border border-border rounded-lg shadow-xl overflow-hidden min-w-32 py-1">
                  {([
                    { value: "full" as PreviewQuality, label: "Full 4K" },
                    { value: "high" as PreviewQuality, label: "High 1080p" },
                    { value: "medium" as PreviewQuality, label: "Medium 720p" },
                    { value: "low" as PreviewQuality, label: "Proxy 480p" },
                  ]).map((tier) => (
                    <button
                      key={tier.value}
                      onClick={() => {
                        setPreviewQuality(tier.value);
                        setShowQualityMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-[11px] text-left transition-colors cursor-pointer flex items-center justify-between ${
                        previewQuality === tier.value
                          ? "text-accent bg-accent/10 font-semibold"
                          : "text-text-muted hover:text-text-primary hover:bg-white/5"
                      }`}
                    >
                      <span>{tier.label}</span>
                      {previewQuality === tier.value && <span className="text-accent text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <VoiceoverRecorderButton />

          <span className="inline-flex items-center gap-1">
            <Button title="Fit sequence (Shift+Z)" variant="ghost" size="icon-sm" className={zoomButton} onClick={fitSequence} disabled={!hasTimelineContent} aria-label="Fit sequence">
              <Maximize2 className="w-3.5 h-3.5" strokeWidth={2} />
            </Button>
            <Button title="Zoom Out" variant="ghost" size="icon-sm" className={zoomButton} onClick={() => zoomByStep(-1)} disabled={!hasTimelineContent || zoomLevel <= TIMELINE_ZOOM_MIN} aria-label="Zoom out timeline">
              <ZoomOut className="w-2 h-2" strokeWidth={2} />
            </Button>

            <div ref={zoomRailRef} role="slider" tabIndex={hasTimelineContent ? 0 : -1} aria-disabled={!hasTimelineContent} aria-label="Timeline zoom" aria-valuemin={TIMELINE_ZOOM_MIN} aria-valuemax={TIMELINE_ZOOM_MAX} aria-valuenow={zoomLevel} aria-valuetext={`${zoomLevel.toFixed(2)} times, ${currentTierLabel}, ${temporalDetail.label}, ${cadenceLabel} samples`} onPointerDown={handleZoomPointerDown} onPointerMove={handleZoomPointerMove} onPointerUp={handleZoomPointerUp} onPointerCancel={handleZoomPointerCancel} onLostPointerCapture={handleZoomPointerCancel} onKeyDown={handleZoomKeyDown} className={`group relative flex h-8 w-44 items-center rounded-full outline-none ${hasTimelineContent ? "cursor-pointer touch-none" : "cursor-not-allowed opacity-40"} focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}>
              <div className="relative mx-[11px] h-[7px] w-full overflow-hidden rounded-full bg-surface-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.04),0_5px_14px_rgba(0,0,0,0.28)]">
                {TIER_SEGMENTS.map(({ tier, left, width }) => (
                  <div key={tier} aria-hidden className={`absolute top-0 h-full ${TIER_BAND_CLASS[tier]}`} style={{ left: `${left}%`, width: `${width}%` }} />
                ))}
                <div className="relative h-full rounded-full bg-accent shadow-[0_0_16px_var(--clypra-accent-glow)]" style={{ width: `${zoomProgress}%` }} />
              </div>
              <div data-testid="timeline-zoom-thumb" className="absolute top-1/2 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border-3 border-accent bg-surface" style={{ left: `${zoomThumbLeftPx}px` }} />
            </div>

            <Button title="Zoom In" variant="ghost" size="icon-sm" className={zoomButton} onClick={() => zoomByStep(1)} disabled={!hasTimelineContent || zoomLevel >= TIMELINE_ZOOM_MAX} aria-label="Zoom in timeline">
              <ZoomIn className="w-4 h-4" strokeWidth={2} />
            </Button>
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
};

export const TimelineToolbar = React.memo(TimelineToolbarComponent);
