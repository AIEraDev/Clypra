import React from "react";
import { TopBar } from "./TopBar";
import { Sidebar as EnhancedMediaPanel } from "./sidebar";
import { PreviewPanel } from "./preview/PreviewPanel";
import { SourcePreview } from "./preview/SourcePreview";
import { PreviewMonitorWorkspace } from "./preview/PreviewMonitorWorkspace";
import { PropertiesPanel } from "./PropertiesPanel";
import { Timeline } from "./timeline/Timeline";
import { FilmstripMetricsOverlay } from "./timeline/FilmstripMetricsOverlay";
import { useWindowSize } from "@/hooks/useWindowSize";
import { MobileEditorLayout } from "./MobileEditorLayout";
import { useAddToTimeline } from "@/hooks/useAddToTimeline";
import { usePanelResize } from "@/hooks/usePanelResize";
import { useSettingsStore } from "@/store/settingsStore";

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
  const defaultTimelineH = isTimelineFocus
    ? typeof window !== "undefined"
      ? Math.round(window.innerHeight * 0.58)
      : 520
    : 400;
  const initialSidebarWidth =
    isTimelineFocus || isDualPlayer
      ? 260
      : isCinemaPreview
        ? 220
        : isInspectorFocus
          ? 240
          : sidebarWidth;
  const initialPropertiesPanelWidth =
    isTimelineFocus || isDualPlayer
      ? 260
      : isCinemaPreview
        ? 220
        : isInspectorFocus
          ? Math.max(propertiesPanelWidth, 460)
          : propertiesPanelWidth;

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
    snapPoints: [260, 400],
    min: 220,
    max: 560,
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
    snapPoints: [260, 400],
    min: 220,
    max: 560,
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
    defaultSize: 480,
    snapPoints: [480],
    min: 320,
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
              <EnhancedMediaPanel
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
                  title="Drag to resize media panel • Double-click to reset (400px)"
                />
              )}

              {/* Properties panel expands in center to fill remaining width */}
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <PropertiesPanel
                  fillWidth={true}
                  collapsed={propertiesPanelCollapsed}
                  onToggleCollapse={() =>
                    setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
                  }
                />
              </div>
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
              className="panel-shell overflow-hidden flex-shrink-0"
              style={{ height: `${timelineH}px` }}
            >
              <Timeline />
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
            title="Drag to resize player • Double-click to reset (480px)"
          />

          {/* Right Block: Full-Height Preview Player */}
          <div
            className="panel-shell flex flex-col overflow-hidden shrink-0"
            style={{ width: `${tallPlayerW}px` }}
          >
            <PreviewMonitorWorkspace orientation="column" />
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
              {Math.round(tallPlayerW) === 480 && (
                <span className="text-[10px] text-accent font-medium">
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
            <PreviewMonitorWorkspace orientation="column" />
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
            title="Drag to resize player • Double-click to reset (480px)"
          />

          {/* Right Block: Media + Properties (top) and Timeline (bottom) */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Top row: Media & Properties */}
            <div className="flex-1 min-h-0 flex overflow-hidden relative">
              <EnhancedMediaPanel
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
                  title="Drag to resize media panel • Double-click to reset (400px)"
                />
              )}

              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <PropertiesPanel
                  fillWidth={true}
                  collapsed={propertiesPanelCollapsed}
                  onToggleCollapse={() =>
                    setPropertiesPanelCollapsed(!propertiesPanelCollapsed)
                  }
                />
              </div>
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
              className="panel-shell overflow-hidden flex-shrink-0"
              style={{ height: `${timelineH}px` }}
            >
              <Timeline />
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
              {Math.round(tallPlayerW) === 480 && (
                <span className="text-[10px] text-accent font-medium">
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
            <EnhancedMediaPanel
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
                title="Drag to resize media panel • Double-click to reset (260px)"
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
                <SourcePreview claimTransportOnMount={false} />
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
                <PreviewPanel mode="program" />
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
                title="Drag to resize properties panel • Double-click to reset (260px)"
              />
            )}

            {/* Right Properties Panel */}
            <PropertiesPanel
              width={propertiesPanelCollapsed ? 0 : propertiesW}
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
            className="panel-shell overflow-hidden flex-shrink-0"
            style={{ height: `${timelineH}px` }}
          >
            <Timeline />
          </div>
        </div>
      </div>
    );
  }

  // 4. CINEMA PREVIEW Layout (Color Grading & Screening)
  if (layoutPreset === "cinema-preview") {
    const cinemaTimelineH = Math.min(timelineH, 220);
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Collapsed/Compact Media Sidebar */}
            <EnhancedMediaPanel
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
              <PreviewMonitorWorkspace orientation="row" />
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
            <PropertiesPanel
              width={propertiesPanelCollapsed ? 0 : propertiesW}
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
            className="panel-shell overflow-hidden flex-shrink-0"
            style={{ height: `${cinemaTimelineH}px` }}
          >
            <Timeline />
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
            <EnhancedMediaPanel
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
              <div className="w-full h-full max-w-[460px] flex flex-col overflow-hidden">
                <PreviewMonitorWorkspace orientation="column" />
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
            <PropertiesPanel
              width={propertiesPanelCollapsed ? 0 : propertiesW}
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
            className="panel-shell overflow-hidden flex-shrink-0"
            style={{ height: `${timelineH}px` }}
          >
            <Timeline />
          </div>
        </div>
      </div>
    );
  }

  // 6. INSPECTOR FOCUS Layout (Color, Animation, Effects & Curves)
  if (layoutPreset === "inspector-focus") {
    const wideInspectorW = Math.max(propertiesW, 460);
    return (
      <div className="w-full h-full flex flex-col app-shell overflow-hidden p-1 pt-0 select-none relative">
        <TopBar onRequestClose={onRequestClose} />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-1 relative">
          <div className="flex-1 min-h-0 flex overflow-hidden relative">
            {/* Left Media Rail */}
            <EnhancedMediaPanel
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
              <PreviewMonitorWorkspace orientation="row" />
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
            <PropertiesPanel
              width={propertiesPanelCollapsed ? 0 : wideInspectorW}
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
            className="panel-shell overflow-hidden flex-shrink-0"
            style={{ height: `${timelineH}px` }}
          >
            <Timeline />
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
          <EnhancedMediaPanel
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
              {Math.round(sidebarW) === 400 && (
                <span className="text-[10px] text-accent font-medium">
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
              title="Drag to resize media panel • Double-click to reset (400px)"
            />
          )}

          {/* Center Preview Panel */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden panel-shell">
            <PreviewMonitorWorkspace orientation="row" />
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
              {Math.round(propertiesW) === 400 && (
                <span className="text-[10px] text-accent font-medium">
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
              title="Drag to resize properties panel • Double-click to reset (400px)"
            />
          )}

          {/* Right Properties Panel */}
          <PropertiesPanel
            width={propertiesPanelCollapsed ? 0 : propertiesW}
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
          className="panel-shell overflow-hidden flex-shrink-0"
          style={{ height: `${timelineH}px` }}
        >
          <Timeline />
        </div>
      </div>
      <FilmstripMetricsOverlay />
    </div>
  );
};
