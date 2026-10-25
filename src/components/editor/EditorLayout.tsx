import React from "react";
import { TopBar } from "./TopBar";
import { Sidebar as EnhancedMediaPanel } from "./sidebar";
import { PreviewPanel } from "./preview/PreviewPanel";
import { SourcePreview } from "./preview/SourcePreview";
import { PropertiesPanel } from "./properties/core/PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { useWindowSize } from "@/hooks/useWindowSize";
import { MobileEditorLayout } from "./MobileEditorLayout";
import { useAddToTimeline } from "@/hooks/useAddToTimeline";
import { usePanelResize } from "@/hooks/usePanelResize";
import { useSettingsStore } from "@/store/settingsStore";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CurveEditorModal } from "./curves/CurveEditorModal";

const SafeMediaPanel: React.FC<
  React.ComponentProps<typeof EnhancedMediaPanel>
> = (props) => (
  <ErrorBoundary name="Media Library">
    <EnhancedMediaPanel {...props} />
  </ErrorBoundary>
);

const SafePropertiesPanel: React.FC<
  React.ComponentProps<typeof PropertiesPanel>
> = (props) => (
  <ErrorBoundary name="Properties Inspector">
    <PropertiesPanel {...props} />
  </ErrorBoundary>
);

const SafePreviewPanel: React.FC<React.ComponentProps<typeof PreviewPanel>> = (
  props,
) => (
  <ErrorBoundary name="Program Preview">
    <PreviewPanel {...props} />
  </ErrorBoundary>
);

const SafeSourcePreview: React.FC<
  React.ComponentProps<typeof SourcePreview>
> = (props) => (
  <ErrorBoundary name="Source Preview">
    <SourcePreview {...props} />
  </ErrorBoundary>
);

const SafeTimeline: React.FC = () => (
  <ErrorBoundary name="Timeline">
    <Timeline />
  </ErrorBoundary>
);

interface EditorLayoutProps {
  onRequestClose?: () => void;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
  onRequestClose,
}) => {
  // Call all hooks first before any conditional returns (Rules of Hooks)
  const { width } = useWindowSize();
  const handleAddToTimeline = useAddToTimeline();

  const {
    layoutPreset,
    timelineHeight,
    setTimelineHeight,
    sidebarWidth,
    setSidebarWidth,
    propertiesPanelWidth,
    setPropertiesPanelWidth,
    tallPlayerWidth,
    setTallPlayerWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    propertiesPanelCollapsed,
    setPropertiesPanelCollapsed,
  } = useSettingsStore();

  const isTimelineFocus = layoutPreset === "timeline-focus";
  const isDualPlayer = layoutPreset === "dual-player";
  const isCinemaPreview = layoutPreset === "cinema-preview";
  const isInspectorFocus = layoutPreset === "inspector-focus";

  // Viewport-relative helpers — evaluated at render time so they respond to
  // window resizes when the user changes screen or resizes the Tauri window.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;

  // Default panel widths: 22% of viewport, clamped [240, 480]
  const defaultPanelW = Math.round(Math.min(Math.max(vw * 0.22, 240), 480));
  // Compact panel widths for presets that need narrower side panels: 18% vw, clamped [200, 300]
  const compactPanelW = Math.round(Math.min(Math.max(vw * 0.18, 200), 300));
  // Default timeline height: 30% vh, clamped [160, 400]
  const defaultTimelineH = isTimelineFocus
    ? Math.round(vh * 0.58)
    : Math.round(Math.min(Math.max(vh * 0.3, 160), 400));
  // Default tall player width: 32% vw, clamped [320, 600]
  const defaultTallPlayerW = Math.round(
    Math.min(Math.max(vw * 0.32, 320), 600),
  );

  // Per-preset initial panel widths
  const initialSidebarWidth =
    isTimelineFocus || isDualPlayer
      ? compactPanelW
      : isCinemaPreview
        ? Math.round(Math.min(Math.max(vw * 0.15, 180), 260))
        : isInspectorFocus
          ? Math.round(Math.min(Math.max(vw * 0.16, 200), 280))
          : sidebarWidth;
  const initialPropertiesPanelWidth =
    isTimelineFocus || isDualPlayer
      ? compactPanelW
      : isCinemaPreview
        ? Math.round(Math.min(Math.max(vw * 0.15, 180), 260))
        : isInspectorFocus
          ? // Inspector focus: wide properties panel — 35% vw, floor at 380px
            Math.max(
              propertiesPanelWidth,
              Math.round(Math.min(Math.max(vw * 0.35, 380), 560)),
            )
          : propertiesPanelWidth;

  // Panel resize constraints — all viewport-relative so they scale with screen size
  const panelMin = Math.round(Math.max(vw * 0.16, 400)); // ~16% vw, min 280px
  const panelMax = Math.round(Math.min(vw * 0.42, 500)); // ~42% vw, max 640px
  // Snap points relative to viewport: compact (~18% vw) and default (~22% vw)
  const panelSnapPoints = [compactPanelW, defaultPanelW];

  // Timeline vertical height resizer
  const {
    size: timelineH,
    isDragging: isTimelineDragging,
    handlePointerDown: handleTimelineResizerPointerDown,
    handleDoubleClick: handleTimelineDoubleClick,
  } = usePanelResize({
    initial: isTimelineFocus ? defaultTimelineH : timelineHeight,
    defaultSize: defaultTimelineH,
    snapPoints: [defaultTimelineH],
    min: 160,
    max: () => window.innerHeight * (isTimelineFocus ? 0.8 : 0.65),
    direction: "vertical",
    onCommit: setTimelineHeight,
  });

  // Sidebar horizontal width resizer
  const {
    size: sidebarW,
    isDragging: isSidebarDragging,
    handlePointerDown: handleSidebarResizerPointerDown,
    handleDoubleClick: handleSidebarDoubleClick,
  } = usePanelResize({
    initial: initialSidebarWidth,
    defaultSize: initialSidebarWidth,
    snapPoints: panelSnapPoints,
    min: panelMin,
    max: panelMax,
    direction: "horizontal",
    onCommit: setSidebarWidth,
  });

  // Properties panel horizontal width resizer
  const {
    size: propertiesW,
    isDragging: isPropertiesDragging,
    handlePointerDown: handlePropertiesResizerPointerDown,
    handleDoubleClick: handlePropertiesDoubleClick,
  } = usePanelResize({
    initial: initialPropertiesPanelWidth,
    defaultSize: initialPropertiesPanelWidth,
    snapPoints: panelSnapPoints,
    min: panelMin,
    max: panelMax,
    direction: "horizontal-reverse",
    onCommit: setPropertiesPanelWidth,
  });

  // Tall Player column resizer
  const {
    size: tallPlayerW,
    isDragging: isTallPlayerDragging,
    handlePointerDown: handleTallPlayerResizerPointerDown,
    handleDoubleClick: handleTallPlayerDoubleClick,
  } = usePanelResize({
    initial: tallPlayerWidth,
    defaultSize: defaultTallPlayerW,
    snapPoints: [defaultTallPlayerW],
    min: Math.round(Math.max(vw * 0.2, 280)),
    max: () => window.innerWidth * 0.65,
    direction:
      layoutPreset === "tall-player-right"
        ? "horizontal-reverse"
        : "horizontal",
    onCommit: setTallPlayerWidth,
  });

  // Mobile check after all hooks are called (Rules of Hooks)
  if (width < 768) {
    return <MobileEditorLayout />;
  }

  // 1. TALL PLAYER RIGHT (CapCut Layout)
  if (layoutPreset === "tall-player-right") {
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex overflow-hidden mt-1 relative">
          {/* Left Block: Media + Properties (top) and Timeline (bottom) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Top row: Media & Properties */}
            <div className="flex-1 min-h-0 flex overflow-hidden relative">
              <SafeMediaPanel
                onAddToTimeline={handleAddToTimeline}
                width={
                  sidebarCollapsed
                    ? 44
                    : propertiesPanelCollapsed
                      ? undefined
                      : sidebarW
                }
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              />

              {!sidebarCollapsed && !propertiesPanelCollapsed && (
                <div
                  onPointerDown={handleSidebarResizerPointerDown}
                  onDoubleClick={handleSidebarDoubleClick}
                  style={{ cursor: "col-resize" }}
                  className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                    isSidebarDragging
                      ? "bg-accent"
                      : "hover:bg-accent/60 active:bg-accent"
                  }`}
                  title="Drag to resize media panel • Double-click to reset"
                />
              )}

              {/* Properties panel */}
              <SafePropertiesPanel
                fillWidth={!propertiesPanelCollapsed}
                width={propertiesPanelCollapsed ? 44 : undefined}
                collapsed={propertiesPanelCollapsed}
                onToggleCollapse={() =>
                  setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
                }
              />
            </div>

            {/* Vertical resizer for timeline */}
            <div
              onPointerDown={handleTimelineResizerPointerDown}
              onDoubleClick={handleTimelineDoubleClick}
              style={{ cursor: "row-resize" }}
              className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
                isTimelineDragging
                  ? "bg-accent"
                  : "hover:bg-accent/60 active:bg-accent"
              }`}
              title="Drag to resize timeline • Double-click to reset"
            />

            {/* Timeline */}
            <div
              className="panel-shell overflow-hidden shrink-0"
              style={{ height: `${timelineH}px` }}
            >
              <SafeTimeline />
            </div>
          </div>

          {/* Horizontal Resizer between Editing Block and Tall Player */}
          <div
            onPointerDown={handleTallPlayerResizerPointerDown}
            onDoubleClick={handleTallPlayerDoubleClick}
            style={{ cursor: "col-resize" }}
            className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
              isTallPlayerDragging
                ? "bg-accent"
                : "hover:bg-accent/60 active:bg-accent"
            }`}
            title={`Drag to resize player • Double-click to reset (${defaultTallPlayerW}px)`}
          />

          {/* Right Block: Full-Height Preview Player */}
          <div
            className="panel-shell flex flex-col overflow-hidden shrink-0"
            style={{ width: `${tallPlayerW}px` }}
          >
            <SafePreviewPanel />
          </div>

          {/* Live Dimension HUDs */}
          {isTallPlayerDragging && (
            <div
              className="absolute top-3 z-50 pointer-events-none px-2.5 py-1 rounded-full bg-surface-floating/95 border border-accent/50 shadow-2xl backdrop-blur-md text-[11px] font-medium text-text-primary flex items-center gap-1.5"
              style={{ right: `${tallPlayerW + 10}px` }}
            >
              <span className="text-accent font-semibold">Player</span>
              <span className="text-white/30">•</span>
              <span className="tabular-nums font-mono">
                {Math.round(tallPlayerW)} px
              </span>
              {Math.round(tallPlayerW) === defaultTallPlayerW && (
                <span className="text-[0.625rem] text-accent font-medium">
                  (Default)
                </span>
              )}
            </div>
          )}

          {isTimelineDragging && (
            <div
              className="absolute left-1/3 -translate-x-1/2 z-50 pointer-events-none px-2.5 py-1 rounded-full bg-surface-floating/95 border border-accent/50 shadow-2xl backdrop-blur-md text-[11px] font-medium text-text-primary flex items-center gap-1.5"
              style={{ bottom: `${timelineH + 10}px` }}
            >
              <span className="text-accent font-semibold">Timeline</span>
              <span className="text-white/30">•</span>
              <span className="tabular-nums font-mono">
                {Math.round(timelineH)} px
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. TALL PLAYER LEFT Layout
  if (layoutPreset === "tall-player-left") {
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex overflow-hidden mt-1 relative">
          {/* Left Block: Full-Height Preview Player */}
          <div
            className="panel-shell flex flex-col overflow-hidden shrink-0"
            style={{ width: `${tallPlayerW}px` }}
          >
            <SafePreviewPanel />
          </div>

          {/* Horizontal Resizer */}
          <div
            onPointerDown={handleTallPlayerResizerPointerDown}
            onDoubleClick={handleTallPlayerDoubleClick}
            style={{ cursor: "col-resize" }}
            className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
              isTallPlayerDragging
                ? "bg-accent"
                : "hover:bg-accent/60 active:bg-accent"
            }`}
            title={`Drag to resize player • Double-click to reset (${defaultTallPlayerW}px)`}
          />

          {/* Right Block: Media + Properties (top) and Timeline (bottom) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Top row: Media & Properties */}
            <div className="flex-1 min-h-0 flex overflow-hidden relative">
              <SafeMediaPanel
                onAddToTimeline={handleAddToTimeline}
                width={
                  sidebarCollapsed
                    ? 44
                    : propertiesPanelCollapsed
                      ? undefined
                      : sidebarW
                }
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              />

              {!sidebarCollapsed && !propertiesPanelCollapsed && (
                <div
                  onPointerDown={handleSidebarResizerPointerDown}
                  onDoubleClick={handleSidebarDoubleClick}
                  style={{ cursor: "col-resize" }}
                  className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                    isSidebarDragging
                      ? "bg-accent"
                      : "hover:bg-accent/60 active:bg-accent"
                  }`}
                  title="Drag to resize media panel • Double-click to reset"
                />
              )}

              <SafePropertiesPanel
                fillWidth={!propertiesPanelCollapsed}
                width={propertiesPanelCollapsed ? 44 : undefined}
                collapsed={propertiesPanelCollapsed}
                onToggleCollapse={() =>
                  setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
                }
              />
            </div>

            {/* Vertical resizer for timeline */}
            <div
              onPointerDown={handleTimelineResizerPointerDown}
              onDoubleClick={handleTimelineDoubleClick}
              style={{ cursor: "row-resize" }}
              className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
                isTimelineDragging
                  ? "bg-accent"
                  : "hover:bg-accent/60 active:bg-accent"
              }`}
              title="Drag to resize timeline • Double-click to reset"
            />

            {/* Timeline */}
            <div
              className="panel-shell overflow-hidden shrink-0"
              style={{ height: `${timelineH}px` }}
            >
              <SafeTimeline />
            </div>
          </div>

          {/* Live Dimension HUD */}
          {isTallPlayerDragging && (
            <div
              className="absolute top-3 z-50 pointer-events-none px-2.5 py-1 rounded-full bg-surface-floating/95 border border-accent/50 shadow-2xl backdrop-blur-md text-[11px] font-medium text-text-primary flex items-center gap-1.5"
              style={{ left: `${tallPlayerW + 10}px` }}
            >
              <span className="text-accent font-semibold">Player</span>
              <span className="text-white/30">•</span>
              <span className="tabular-nums font-mono">
                {Math.round(tallPlayerW)} px
              </span>
              {Math.round(tallPlayerW) === defaultTallPlayerW && (
                <span className="text-[0.625rem] text-accent font-medium">
                  (Default)
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3. DUAL PLAYER Layout (Assembly / Footage Ingest & Comparison)
  if (layoutPreset === "dual-player") {
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Left Media Sidebar */}
            <SafeMediaPanel
              onAddToTimeline={handleAddToTimeline}
              width={sidebarCollapsed ? 44 : sidebarW}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />

            {!sidebarCollapsed && (
              <div
                onPointerDown={handleSidebarResizerPointerDown}
                onDoubleClick={handleSidebarDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isSidebarDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize media panel • Double-click to reset"
              />
            )}

            {/* Left Monitor: Source Clip Preview */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell">
              <div className="px-3 py-1 border-b border-border/40 bg-surface/40 flex items-center justify-between text-[11px] font-semibold text-text-muted select-none">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400/80" />
                  Source Monitor (Ingest / In-Out)
                </span>
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <SafeSourcePreview claimTransportOnMount={false} />
              </div>
            </div>

            {/* Divider between Source and Program */}
            <div className="w-1 shrink-0 bg-border/40 mx-0.5" />

            {/* Right Monitor: Program Timeline Preview */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell">
              <div className="px-3 py-1 border-b border-border/40 bg-surface/40 flex items-center justify-between text-[11px] font-semibold text-text-muted select-none">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-accent" />
                  Program Monitor (Timeline)
                </span>
              </div>
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <SafePreviewPanel mode="program" />
              </div>
            </div>

            {!propertiesPanelCollapsed && (
              <div
                onPointerDown={handlePropertiesResizerPointerDown}
                onDoubleClick={handlePropertiesDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isPropertiesDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize properties panel • Double-click to reset"
              />
            )}

            {/* Right Properties Panel */}
            <SafePropertiesPanel
              width={propertiesPanelCollapsed ? 44 : propertiesW}
              collapsed={propertiesPanelCollapsed}
              onToggleCollapse={() =>
                setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
              }
            />
          </div>

          {/* Vertical Resizer for timeline */}
          <div
            onPointerDown={handleTimelineResizerPointerDown}
            onDoubleClick={handleTimelineDoubleClick}
            style={{ cursor: "row-resize" }}
            className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
              isTimelineDragging
                ? "bg-accent"
                : "hover:bg-accent/60 active:bg-accent"
            }`}
            title="Drag to resize timeline • Double-click to reset"
          />

          {/* Timeline */}
          <div
            className="panel-shell overflow-hidden shrink-0"
            style={{ height: `${timelineH}px` }}
          >
            <SafeTimeline />
          </div>
        </div>
      </div>
    );
  }

  // 4. CINEMA PREVIEW Layout (Color Grading & Screening)
  if (layoutPreset === "cinema-preview") {
    // Cinema timeline: compact, capped at 25% of viewport height (max 240px)
    const cinemaTimelineH = Math.min(
      timelineH,
      Math.round(Math.min(vh * 0.25, 240)),
    );
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Collapsed/Compact Media Sidebar */}
            <SafeMediaPanel
              onAddToTimeline={handleAddToTimeline}
              width={sidebarCollapsed ? 44 : sidebarW}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />

            {!sidebarCollapsed && (
              <div
                onPointerDown={handleSidebarResizerPointerDown}
                onDoubleClick={handleSidebarDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isSidebarDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize media panel"
              />
            )}

            {/* Giant Center Preview Monitor */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell shadow-2xl">
              <SafePreviewPanel />
            </div>

            {!propertiesPanelCollapsed && (
              <div
                onPointerDown={handlePropertiesResizerPointerDown}
                onDoubleClick={handlePropertiesDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isPropertiesDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize properties panel"
              />
            )}

            {/* Collapsed/Compact Properties */}
            <SafePropertiesPanel
              width={propertiesPanelCollapsed ? 44 : propertiesW}
              collapsed={propertiesPanelCollapsed}
              onToggleCollapse={() =>
                setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
              }
            />
          </div>

          {/* Vertical Resizer for compact timeline */}
          <div
            onPointerDown={handleTimelineResizerPointerDown}
            onDoubleClick={handleTimelineDoubleClick}
            style={{ cursor: "row-resize" }}
            className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
              isTimelineDragging
                ? "bg-accent"
                : "hover:bg-accent/60 active:bg-accent"
            }`}
            title="Drag to resize timeline"
          />

          {/* Compact Timeline */}
          <div
            className="panel-shell overflow-hidden shrink-0"
            style={{ height: `${cinemaTimelineH}px` }}
          >
            <SafeTimeline />
          </div>
        </div>
      </div>
    );
  }

  // 5. VERTICAL / SHORTS Layout (9:16 Creator Focus)
  if (layoutPreset === "vertical-shorts") {
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Left Media & Stickers & Audio */}
            <SafeMediaPanel
              onAddToTimeline={handleAddToTimeline}
              width={sidebarCollapsed ? 44 : sidebarW}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />

            {!sidebarCollapsed && (
              <div
                onPointerDown={handleSidebarResizerPointerDown}
                onDoubleClick={handleSidebarDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isSidebarDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize media panel • Double-click to reset"
              />
            )}

            {/* Centered 9:16 Portrait Preview Monitor */}
            <div className="flex-1 min-w-0 flex items-center justify-center overflow-hidden panel-shell bg-surface/30">
              <div className="w-full h-full max-w-115 flex flex-col overflow-hidden">
                <SafePreviewPanel />
              </div>
            </div>

            {!propertiesPanelCollapsed && (
              <div
                onPointerDown={handlePropertiesResizerPointerDown}
                onDoubleClick={handlePropertiesDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isPropertiesDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize properties panel • Double-click to reset"
              />
            )}

            {/* Right Text & Captions Properties */}
            <SafePropertiesPanel
              width={propertiesPanelCollapsed ? 44 : propertiesW}
              collapsed={propertiesPanelCollapsed}
              onToggleCollapse={() =>
                setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
              }
            />
          </div>

          {/* Vertical Resizer */}
          <div
            onPointerDown={handleTimelineResizerPointerDown}
            onDoubleClick={handleTimelineDoubleClick}
            style={{ cursor: "row-resize" }}
            className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
              isTimelineDragging
                ? "bg-accent"
                : "hover:bg-accent/60 active:bg-accent"
            }`}
            title="Drag to resize timeline • Double-click to reset"
          />

          {/* Timeline */}
          <div
            className="panel-shell overflow-hidden shrink-0"
            style={{ height: `${timelineH}px` }}
          >
            <SafeTimeline />
          </div>
        </div>
      </div>
    );
  }

  // 6. INSPECTOR FOCUS Layout (Color, Animation, Effects & Curves)
  if (layoutPreset === "inspector-focus") {
    // Wide inspector: matches the viewport-relative floor set in initialPropertiesPanelWidth
    const wideInspectorW = Math.max(
      propertiesW,
      Math.round(Math.min(Math.max(vw * 0.35, 380), 560)),
    );
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Left Media Rail */}
            <SafeMediaPanel
              onAddToTimeline={handleAddToTimeline}
              width={sidebarCollapsed ? 44 : sidebarW}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />

            {!sidebarCollapsed && (
              <div
                onPointerDown={handleSidebarResizerPointerDown}
                onDoubleClick={handleSidebarDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isSidebarDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize media panel"
              />
            )}

            {/* Preview Monitor */}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell">
              <SafePreviewPanel />
            </div>

            {!propertiesPanelCollapsed && (
              <div
                onPointerDown={handlePropertiesResizerPointerDown}
                onDoubleClick={handlePropertiesDoubleClick}
                style={{ cursor: "col-resize" }}
                className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                  isPropertiesDragging
                    ? "bg-accent"
                    : "hover:bg-accent/60 active:bg-accent"
                }`}
                title="Drag to resize inspector panel"
              />
            )}

            {/* Dominant Wide Properties Inspector */}
            <SafePropertiesPanel
              width={propertiesPanelCollapsed ? 44 : wideInspectorW}
              collapsed={propertiesPanelCollapsed}
              onToggleCollapse={() =>
                setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
              }
            />
          </div>

          {/* Vertical Resizer */}
          <div
            onPointerDown={handleTimelineResizerPointerDown}
            onDoubleClick={handleTimelineDoubleClick}
            style={{ cursor: "row-resize" }}
            className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
              isTimelineDragging
                ? "bg-accent"
                : "hover:bg-accent/60 active:bg-accent"
            }`}
            title="Drag to resize timeline"
          />

          {/* Timeline */}
          <div
            className="panel-shell overflow-hidden shrink-0"
            style={{ height: `${timelineH}px` }}
          >
            <SafeTimeline />
          </div>
        </div>
      </div>
    );
  }

  // 7. DEFAULT & TIMELINE-FOCUS (Classic 3-column top + bottom timeline)
  return (
    <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
      <TopBar onRequestClose={onRequestClose} />

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          {/* Left Media Sidebar */}
          <SafeMediaPanel
            onAddToTimeline={handleAddToTimeline}
            width={sidebarCollapsed ? 44 : sidebarW}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          />

          {/* Sidebar Dimension HUD */}
          {isSidebarDragging && (
            <div
              className="absolute top-3 z-50 pointer-events-none px-2.5 py-1 rounded-full bg-surface-floating/95 border border-accent/50 shadow-2xl backdrop-blur-md text-[11px] font-medium text-text-primary flex items-center gap-1.5"
              style={{ left: `${sidebarW + 10}px` }}
            >
              <span className="text-accent font-semibold">Media</span>
              <span className="text-white/30">•</span>
              <span className="tabular-nums font-mono">
                {Math.round(sidebarW)} px
              </span>
              {Math.round(sidebarW) === defaultPanelW && (
                <span className="text-[0.625rem] text-accent font-medium">
                  (Default)
                </span>
              )}
            </div>
          )}

          {/* Left Horizontal Resizer (4px gap) */}
          {!sidebarCollapsed && (
            <div
              onPointerDown={handleSidebarResizerPointerDown}
              onDoubleClick={handleSidebarDoubleClick}
              style={{ cursor: "col-resize" }}
              className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                isSidebarDragging
                  ? "bg-accent"
                  : "hover:bg-accent/60 active:bg-accent"
              }`}
              title="Drag to resize media panel • Double-click to reset"
            />
          )}

          {/* Center Preview Panel */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell">
            <SafePreviewPanel />
          </div>

          {/* Properties Dimension HUD */}
          {isPropertiesDragging && (
            <div
              className="absolute top-3 z-50 pointer-events-none px-2.5 py-1 rounded-full bg-surface-floating/95 border border-accent/50 shadow-2xl backdrop-blur-md text-[11px] font-medium text-text-primary flex items-center gap-1.5"
              style={{ right: `${propertiesW + 10}px` }}
            >
              <span className="text-accent font-semibold">Properties</span>
              <span className="text-white/30">•</span>
              <span className="tabular-nums font-mono">
                {Math.round(propertiesW)} px
              </span>
              {Math.round(propertiesW) === defaultPanelW && (
                <span className="text-[0.625rem] text-accent font-medium">
                  (Default)
                </span>
              )}
            </div>
          )}

          {/* Right Horizontal Resizer (4px gap) */}
          {!propertiesPanelCollapsed && (
            <div
              onPointerDown={handlePropertiesResizerPointerDown}
              onDoubleClick={handlePropertiesDoubleClick}
              style={{ cursor: "col-resize" }}
              className={`w-1 shrink-0 resizer-horizontal cursor-col-resize transition-colors select-none ${
                isPropertiesDragging
                  ? "bg-accent"
                  : "hover:bg-accent/60 active:bg-accent"
              }`}
              title="Drag to resize properties panel • Double-click to reset"
            />
          )}

          {/* Right Properties Panel */}
          <SafePropertiesPanel
            width={propertiesPanelCollapsed ? 44 : propertiesW}
            collapsed={propertiesPanelCollapsed}
            onToggleCollapse={() =>
              setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
            }
          />
        </div>

        {/* Timeline Dimension HUD */}
        {isTimelineDragging && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none px-2.5 py-1 rounded-full bg-surface-floating/95 border border-accent/50 shadow-2xl backdrop-blur-md text-[11px] font-medium text-text-primary flex items-center gap-1.5"
            style={{ bottom: `${timelineH + 10}px` }}
          >
            <span className="text-accent font-semibold">Timeline</span>
            <span className="text-white/30">•</span>
            <span className="tabular-nums font-mono">
              {Math.round(timelineH)} px
            </span>
            {Math.round(timelineH) === defaultTimelineH && (
              <span className="text-[10px] text-accent font-medium">
                (Default)
              </span>
            )}
          </div>
        )}

        {/* Vertical Drag Resizer (4px gap) */}
        <div
          onPointerDown={handleTimelineResizerPointerDown}
          onDoubleClick={handleTimelineDoubleClick}
          style={{ cursor: "row-resize" }}
          className={`h-1 w-full shrink-0 resizer-vertical cursor-row-resize transition-colors select-none ${
            isTimelineDragging
              ? "bg-accent"
              : "hover:bg-accent/60 active:bg-accent"
          }`}
          title={`Drag to resize timeline • Double-click to reset (${defaultTimelineH}px)`}
        />

        {/* Timeline Panel */}
        <div
          className="panel-shell overflow-hidden shrink-0"
          style={{ height: `${timelineH}px` }}
        >
          <SafeTimeline />
        </div>
      </div>
      <CurveEditorModal />
    </div>
  );
};
