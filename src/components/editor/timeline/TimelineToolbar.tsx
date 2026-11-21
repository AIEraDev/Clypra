import React, { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Maximize2, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  ToolbarUndoIcon,
  ToolbarRedoIcon,
  ToolbarDeleteLeftIcon,
  ToolbarDeleteRightIcon,
  ToolbarSplitIcon,
  ToolbarDeleteIcon,
  ToolbarDuplicateIcon,
  ToolbarCloseGapIcon,
  ToolbarZoomInIcon,
  ToolbarZoomOutIcon,
  ToolbarRippleOnIcon,
  ToolbarRippleOffIcon,
  ToolbarSnapOnIcon,
  ToolbarSnapOffIcon,
} from "@/components/ui/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { useTimelineStore } from "@/store/timelineStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useHistoryStore } from "@/store/historyStore";
import { useProjectStore } from "@/store/projectStore";
import { DEFAULT_SRP_CONFIG, SpatialTier } from "@/lib/renderEngine/types";
import {
  clampTimelineZoom,
  formatCadenceSeconds,
  getSrpTierForZoom,
  getTimelineTemporalDetail,
  getTimelineZoomMax,
  getZoomFromRatio,
  getZoomRatio,
  snapTimelineZoomToTierAnchors,
  TIMELINE_TIER_LABELS,
  TIMELINE_ZOOM_MAX,
  TIMELINE_ZOOM_MIN,
  TIMELINE_ZOOM_STEP,
} from "@/lib/timeline/timelineZoom";
import { useClipCommands, useTimelineCommands } from "@/core/commands";
import {
  useAnchoredTimelineZoom,
  usePreviewQualityCapabilities,
} from "@/hooks";
import type { TimelineZoomAnchor } from "@/hooks/timeline/useAnchoredTimelineZoom";
import { VoiceoverRecorderButton } from "./VoiceoverRecorderButton";
import { timelineZoomTelemetry } from "@/lib/timeline/timelineZoomTelemetry";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n";

const ZOOM_THUMB_SIZE_PX = 12;
const ZOOM_RAIL_WIDTH_PX = 112; // w-28

const TIER_BAND_CLASS: Record<SpatialTier, string> = {
  [SpatialTier.L0]: "bg-accent-primary/20",
  [SpatialTier.L1]: "bg-accent-primary/35",
  [SpatialTier.L2]: "bg-accent-primary/50",
  [SpatialTier.L3]: "bg-accent-primary/70",
};

const TimelineToolbarComponent: React.FC = () => {
  const { t } = useI18n();
  const zoomLevel = useTimelineStore((s) => s.zoomLevel);
  const pixelsPerSecond = useTimelineStore((s) => s.pixelsPerSecond);
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const rippleEditEnabled = useTimelineStore((s) => s.rippleEditEnabled);
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const toggleRippleEdit = useTimelineStore((s) => s.toggleRippleEdit);
  const toggleSnapEnabled = useTimelineStore((s) => s.toggleSnapEnabled);

  const historyState = useHistoryStore((s) => s.state);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const proxyEditingEnabled = useSettingsStore((s) => s.proxyEditingEnabled);
  const {
    previewQuality,
    setPreviewQuality,
    currentOption,
    tierOptions,
    gpuName,
    is4kProject,
    isHardwareLimited,
  } = usePreviewQualityCapabilities();
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const zoomRailRef = useRef<HTMLDivElement>(null);
  const zoomGestureAnchorRef = useRef<TimelineZoomAnchor | null>(null);
  const zoomDragRafRef = useRef<number | null>(null);
  const pendingZoomClientXRef = useRef<number | null>(null);
  const { captureZoomAnchor, applyZoomLevel, zoomByStep, fitSequence } =
    useAnchoredTimelineZoom();
  const {
    resolvedCommands: resolvedClipCommands,
    executeCommand: executeClipCommand,
  } = useClipCommands(null);
  const {
    resolvedCommands: resolvedTimelineCommands,
    executeCommand: executeTimelineCommand,
  } = useTimelineCommands(null, 0);

  const getClipCommand = (id: string) =>
    resolvedClipCommands.find((item) => item.command.id === id);
  const getTimelineCommand = (id: string) =>
    resolvedTimelineCommands.find((item) => item.command.id === id);

  const frameRate = useProjectStore((s) => s.project?.frameRate ?? 30);
  const maxZoom = getTimelineZoomMax(frameRate);
  const zoomRatio = getZoomRatio(zoomLevel, frameRate);
  const zoomProgress = zoomRatio * 100;
  const zoomThumbLeftPx =
    ZOOM_THUMB_SIZE_PX / 2 +
    zoomRatio * (ZOOM_RAIL_WIDTH_PX - ZOOM_THUMB_SIZE_PX);
  const currentSrpTier = getSrpTierForZoom(zoomLevel);
  const currentTierLabel = TIMELINE_TIER_LABELS[currentSrpTier];
  const temporalDetail = getTimelineTemporalDetail(pixelsPerSecond);
  const cadenceLabel = formatCadenceSeconds(temporalDetail.baseInterval);
  const hasTimelineContent = tracks.length > 0 || clips.length > 0;

  const tierSegments = React.useMemo(() => {
    return (
      [SpatialTier.L0, SpatialTier.L1, SpatialTier.L2, SpatialTier.L3] as const
    ).map((tier) => {
      const boundary = DEFAULT_SRP_CONFIG[tier];
      const tierMax =
        tier === SpatialTier.L3
          ? Math.max(boundary.max, maxZoom)
          : boundary.max;
      const left = getZoomRatio(boundary.min, frameRate) * 100;
      const width =
        (getZoomRatio(tierMax, frameRate) -
          getZoomRatio(boundary.min, frameRate)) *
        100;
      return { tier, left, width };
    });
  }, [frameRate, maxZoom]);

  const snapZoom = (value: number) => {
    const stepped = Number(
      (Math.round(value / TIMELINE_ZOOM_STEP) * TIMELINE_ZOOM_STEP).toFixed(2),
    );
    return snapTimelineZoomToTierAnchors(
      stepped,
      DEFAULT_SRP_CONFIG,
      frameRate,
    );
  };

  const setZoomFromClientX = (clientX: number) => {
    if (!hasTimelineContent) return;
    const rail = zoomRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const inset = ZOOM_THUMB_SIZE_PX / 2;
    const usableWidth = Math.max(1, rect.width - ZOOM_THUMB_SIZE_PX);
    const ratio = Math.min(
      1,
      Math.max(0, (clientX - rect.left - inset) / usableWidth),
    );
    applyZoomLevel(
      clampTimelineZoom(
        snapZoom(getZoomFromRatio(ratio, frameRate)),
        frameRate,
      ),
      zoomGestureAnchorRef.current,
    );
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

  useEffect(
    () => () => {
      if (zoomDragRafRef.current !== null)
        cancelAnimationFrame(zoomDragRafRef.current);
      zoomDragRafRef.current = null;
      pendingZoomClientXRef.current = null;
    },
    [],
  );

  const handleZoomPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasTimelineContent) return;
    timelineZoomTelemetry.beginGesture("slider", pixelsPerSecond);
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
    timelineZoomTelemetry.endGesture(
      useTimelineStore.getState().pixelsPerSecond,
    );
  };

  const handleZoomPointerCancel = () => {
    if (zoomDragRafRef.current !== null)
      cancelAnimationFrame(zoomDragRafRef.current);
    zoomDragRafRef.current = null;
    pendingZoomClientXRef.current = null;
    zoomGestureAnchorRef.current = null;
    timelineZoomTelemetry.endGesture(
      useTimelineStore.getState().pixelsPerSecond,
    );
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
      timelineZoomTelemetry.beginGesture("keyboard", pixelsPerSecond);
      applyZoomLevel(TIMELINE_ZOOM_MIN, captureZoomAnchor());
      timelineZoomTelemetry.endGesture(
        useTimelineStore.getState().pixelsPerSecond,
      );
    } else if (e.key === "End") {
      e.preventDefault();
      timelineZoomTelemetry.beginGesture("keyboard", pixelsPerSecond);
      applyZoomLevel(maxZoom, captureZoomAnchor());
      timelineZoomTelemetry.endGesture(
        useTimelineStore.getState().pixelsPerSecond,
      );
    }
  };

  const toolButton =
    "text-text-muted hover:text-text-primary hover:bg-surface-hover cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-auto";
  const activeButton =
    "bg-accent-primary/10 text-accent-primary border-accent-primary/30 hover:bg-accent-primary/15";
  const zoomButton =
    "cursor-pointer disabled:cursor-not-allowed disabled:pointer-events-auto h-6 w-6 rounded-full border border-accent-primary/35 bg-surface-elevated text-accent-primary shadow-sm hover:border-accent-primary/60 hover:bg-surface-hover hover:text-text-primary transition-colors";

  const Tool = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider>
      <div
        data-timeline-interactive="true"
        className="border-b border-timeline-toolbar-border flex items-center p-1 gap-2"
      >
        <div className="flex items-center gap-1">
          <Tool label={`${t("common.actions.undo")} (Cmd+Z)`}>
            <button
              className={`flex justify-center items-center py-1 px-2 ${toolButton} rounded-(--ds-radius-sm)`}
              onClick={undo}
              disabled={!historyState.canUndo}
            >
              <ToolbarUndoIcon size="1rem" className="w-4 h-4" />
            </button>
          </Tool>

          <Tool label={`${t("common.actions.redo")} (Cmd+Shift+Z)`}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={redo}
              disabled={!historyState.canRedo}
            >
              <ToolbarRedoIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          {getClipCommand("clip.swap")?.isVisible && (
            <Tool label={t("timeline.tools.swapClips")}>
              <Button
                variant="ghost"
                size="icon-sm"
                className={toolButton}
                onClick={() => executeClipCommand("clip.swap")}
                disabled={!getClipCommand("clip.swap")?.isEnabled}
              >
                <ArrowLeftRight className="w-4 h-4" />
              </Button>
            </Tool>
          )}

          <Tool label={t("timeline.clips.deleteLeft")}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={() => executeClipCommand("clip.trimStartToPlayhead")}
              disabled={!getClipCommand("clip.trimStartToPlayhead")?.isEnabled}
            >
              <ToolbarDeleteLeftIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label={t("timeline.clips.deleteRight")}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={() => executeClipCommand("clip.trimEndToPlayhead")}
              disabled={!getClipCommand("clip.trimEndToPlayhead")?.isEnabled}
            >
              <ToolbarDeleteRightIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label={t("timeline.tools.split")}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={() => executeClipCommand("clip.splitAtPlayhead")}
              disabled={!getClipCommand("clip.splitAtPlayhead")?.isEnabled}
            >
              <ToolbarSplitIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label={t("timeline.clips.deleteSelected")}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={() => executeClipCommand("clip.rippleDelete")}
              disabled={!getClipCommand("clip.rippleDelete")?.isEnabled}
            >
              <ToolbarDeleteIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label={t("timeline.clips.duplicateSelected")}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={() => executeClipCommand("clip.duplicate")}
              disabled={!getClipCommand("clip.duplicate")?.isEnabled}
            >
              <ToolbarDuplicateIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          <Tool label={t("timeline.tools.closeGaps")}>
            <Button
              variant="ghost"
              size="icon-sm"
              className={toolButton}
              onClick={() => executeTimelineCommand("timeline.closeAllGaps")}
              disabled={!getTimelineCommand("timeline.closeAllGaps")?.isEnabled}
            >
              <ToolbarCloseGapIcon size="1rem" className="w-4 h-4" />
            </Button>
          </Tool>

          {/* Ripple edit toggle */}
          <Tool
            label={
              rippleEditEnabled
                ? "Ripple edit: On — trim shifts downstream clips"
                : "Ripple edit: Off — trim leaves a gap"
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className={`${toolButton} ${rippleEditEnabled ? activeButton : ""}`}
              onClick={toggleRippleEdit}
              aria-pressed={rippleEditEnabled}
            >
              {rippleEditEnabled ? (
                <ToolbarRippleOnIcon size="1rem" className="w-4 h-4" />
              ) : (
                <ToolbarRippleOffIcon size="1rem" className="w-4 h-4" />
              )}
            </Button>
          </Tool>

          {/* Magnetic snap toggle */}
          <Tool
            label={
              snapEnabled
                ? "Snap: On — clips snap to edges and playhead"
                : "Snap: Off"
            }
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className={`${toolButton} ${snapEnabled ? activeButton : ""}`}
              onClick={toggleSnapEnabled}
              aria-pressed={snapEnabled}
            >
              {snapEnabled ? (
                <ToolbarSnapOnIcon size="1rem" className="w-4 h-4" />
              ) : (
                <ToolbarSnapOffIcon size="1rem" className="w-4 h-4" />
              )}
            </Button>
          </Tool>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Proxy Mode indicator badge */}
          {proxyEditingEnabled && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-warning/15 border border-status-warning/30 text-status-warning text-[10px] font-semibold shrink-0">
              <Zap className="w-3 h-3" />
              {t("timeline.toolbar.proxyMode")}
            </span>
          )}

          {/* Preview Quality Quick Picker */}
          <div className="relative">
            <button
              onClick={() => setShowQualityMenu((v) => !v)}
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-md bg-surface-elevated border border-border-default text-[10px] font-semibold transition-colors cursor-pointer",
                isHardwareLimited
                  ? "text-amber-400 hover:text-amber-300 border-amber-500/30"
                  : "text-text-muted hover:text-text-primary",
              )}
              title={
                isHardwareLimited
                  ? `Preview resolution: ${currentOption.label} (${currentOption.hardwareLimitReason})`
                  : `Preview resolution: ${currentOption.label} (does not affect final export)`
              }
            >
              <Zap
                className={cn(
                  "w-3 h-3",
                  isHardwareLimited ? "text-amber-400" : "text-accent",
                )}
              />
              <span>{currentOption.shortLabel}</span>
              {isHardwareLimited && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"
                  title="GPU limited"
                />
              )}
            </button>
            {showQualityMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowQualityMenu(false)}
                />
                <div
                  data-testid="preview-quality-menu"
                  className="absolute top-full right-0 mt-1.5 z-[220] bg-surface-floating border border-border rounded-lg shadow-xl overflow-hidden min-w-[210px] py-1"
                >
                  {tierOptions.map((tier) => (
                    <button
                      key={tier.value}
                      onClick={() => {
                        setPreviewQuality(tier.value);
                        setShowQualityMenu(false);
                      }}
                      className={`w-full px-3 py-1.5 text-[11px] text-left transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                        previewQuality === tier.value
                          ? "text-accent-primary bg-accent-primary/10 font-semibold"
                          : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={
                              tier.isHardwareLimited ? "text-text-primary" : ""
                            }
                          >
                            {tier.label}
                          </span>
                          {tier.isHardwareLimited && (
                            <span
                              className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0"
                              title={tier.hardwareLimitReason}
                            >
                              Limited by GPU
                            </span>
                          )}
                          {tier.isRecommended && (
                            <span className="px-1 py-0.2 rounded text-[9px] font-medium bg-accent-primary/15 text-accent-primary border border-accent-primary/25 shrink-0">
                              Recommended
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-text-muted mt-0.5">
                          {tier.resolutionLabel}
                          {tier.isHardwareLimited ? " · Auto-downscaled" : ""}
                        </span>
                      </div>
                      {previewQuality === tier.value && (
                        <span className="text-accent text-xs">✓</span>
                      )}
                    </button>
                  ))}
                  {gpuName && (
                    <div className="px-3 py-1.5 mt-1 border-t border-border-default text-[9.5px] text-text-muted flex items-center justify-between bg-surface-elevated/20">
                      <span className="truncate max-w-[140px]" title={gpuName}>
                        {gpuName}
                      </span>
                      {isHardwareLimited && (
                        <span className="text-amber-400 font-medium shrink-0">
                          {is4kProject ? "4K downscaled" : "GPU constrained"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <VoiceoverRecorderButton />

          <span className="inline-flex items-center gap-0.5">
            <Button
              title={t("timeline.tools.fitSequence")}
              variant="ghost"
              size="icon-xs"
              className={zoomButton}
              onClick={fitSequence}
              disabled={!hasTimelineContent}
              aria-label={t("timeline.tools.fitSequence")}
            >
              <Maximize2 className="w-3 h-3" strokeWidth={2} />
            </Button>
            <Button
              title={t("timeline.tools.zoomOut")}
              variant="ghost"
              size="icon-xs"
              className={zoomButton}
              onClick={() => zoomByStep(-1)}
              disabled={!hasTimelineContent || zoomLevel <= TIMELINE_ZOOM_MIN}
              aria-label={t("timeline.tools.zoomOutTimeline")}
            >
              <ToolbarZoomOutIcon size="0.75rem" className="w-3 h-3" />
            </Button>

            <div
              ref={zoomRailRef}
              role="slider"
              tabIndex={hasTimelineContent ? 0 : -1}
              aria-disabled={!hasTimelineContent}
              aria-label={t("timeline.tools.zoomTimeline")}
              aria-valuemin={TIMELINE_ZOOM_MIN}
              aria-valuemax={maxZoom}
              aria-valuenow={zoomLevel}
              aria-valuetext={`${zoomLevel.toFixed(2)} times, ${currentTierLabel}, ${temporalDetail.label}, ${cadenceLabel} samples`}
              onPointerDown={handleZoomPointerDown}
              onPointerMove={handleZoomPointerMove}
              onPointerUp={handleZoomPointerUp}
              onPointerCancel={handleZoomPointerCancel}
              onLostPointerCapture={handleZoomPointerCancel}
              onKeyDown={handleZoomKeyDown}
              className={`group relative flex h-6 w-28 items-center rounded-full outline-none ${hasTimelineContent ? "cursor-pointer touch-none" : "cursor-not-allowed opacity-40"} focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface`}
            >
              <div className="relative mx-[8px] h-[5px] w-full overflow-hidden rounded-full bg-surface-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.04),0_3px_8px_rgba(0,0,0,0.28)]">
                {tierSegments.map(({ tier, left, width }) => (
                  <div
                    key={tier}
                    aria-hidden
                    className={`absolute top-0 h-full ${TIER_BAND_CLASS[tier]}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                ))}
                <div
                  className="relative h-full rounded-full bg-accent-primary shadow-[0_0_16px_var(--clypra-accent-glow)]"
                  style={{ width: `${zoomProgress}%` }}
                />
              </div>
              <div
                data-testid="timeline-zoom-thumb"
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface"
                style={{ left: `${zoomThumbLeftPx}px` }}
              />
            </div>

            <Button
              title={t("timeline.tools.zoomIn")}
              variant="ghost"
              size="icon-xs"
              className={zoomButton}
              onClick={() => zoomByStep(1)}
              disabled={!hasTimelineContent || zoomLevel >= maxZoom}
              aria-label={t("timeline.tools.zoomInTimeline")}
            >
              <ToolbarZoomInIcon size="0.875rem" className="w-3.5 h-3.5" />
            </Button>
          </span>
        </div>
      </div>
    </TooltipProvider>
  );
};

export const TimelineToolbar = React.memo(TimelineToolbarComponent);
