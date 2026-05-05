import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Expand, Pause, Play, Shrink, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/Button";
import { usePlayback } from "../../hooks/usePlayback";
import { useProjectStore } from "../../store/projectStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useUIStore } from "../../store/uiStore";
import { resolvePreviewScene } from "../../lib/previewScene";
import { SourcePreview } from "./SourcePreview";
import { cn } from "../../lib/utils";

/** Program preview “viewer” aspect (width / height). */
type PreviewAspectPreset =
  | "original"
  | "custom"
  | "16:9"
  | "4:3"
  | "2.35:1"
  | "2:1"
  | "1.85:1"
  | "9:16"
  | "3:4"
  | "5.8-inch"
  | "1:1";

const PREVIEW_ASPECT_LABEL: Record<PreviewAspectPreset, string> = {
  original: "Original",
  custom: "Custom",
  "16:9": "16:9",
  "4:3": "4:3",
  "2.35:1": "2.35:1",
  "2:1": "2:1",
  "1.85:1": "1.85:1",
  "9:16": "9:16",
  "3:4": "3:4",
  "5.8-inch": "5.8-inch",
  "1:1": "1:1",
};

const PREVIEW_ASPECT_RATIO: Partial<Record<PreviewAspectPreset, number>> = {
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "2.35:1": 2.35,
  "2:1": 2,
  "1.85:1": 1.85,
  "9:16": 9 / 16,
  "3:4": 3 / 4,
  "5.8-inch": 1170 / 2532,
  "1:1": 1,
};

function previewAspectWidthOverHeight(preset: PreviewAspectPreset, canvasWidth: number, canvasHeight: number): number {
  const ch = Math.max(1, canvasHeight);
  if (preset === "original" || preset === "custom") {
    return canvasWidth / ch;
  }
  return PREVIEW_ASPECT_RATIO[preset] ?? canvasWidth / ch;
}

function resolveOriginalPreviewAspect(
  layers: Array<{ mediaId: string }>,
  mediaAssets: Array<{ id: string; width?: number; height?: number }>,
  canvasWidth: number,
  canvasHeight: number,
): number {
  const projectRatio = canvasWidth / Math.max(1, canvasHeight);
  if (layers.length !== 1) return projectRatio;
  const onlyLayer = layers[0];
  const asset = mediaAssets.find((a) => a.id === onlyLayer.mediaId);
  if (!asset?.width || !asset?.height || asset.width <= 0 || asset.height <= 0) return projectRatio;
  return asset.width / asset.height;
}

/** Largest rectangle with aspect W/H = R inside the panel. */
function previewViewportSize(panelWidth: number, panelHeight: number, widthOverHeight: number): { vw: number; vh: number } {
  const R = widthOverHeight;
  let vw = Math.min(panelWidth, panelHeight * R);
  let vh = vw / R;
  if (vh > panelHeight + 0.5) {
    vh = panelHeight;
    vw = vh * R;
  }
  return { vw: Math.max(1, vw), vh: Math.max(1, vh) };
}

function PreviewAspectShapeIcon({ widthOverHeight }: { widthOverHeight: number }) {
  const max = 22;
  const min = 8;
  let w: number;
  let h: number;
  if (widthOverHeight >= 1) {
    h = 12;
    w = Math.round(Math.min(max, Math.max(min, h * widthOverHeight)));
  } else {
    w = 12;
    h = Math.round(Math.min(max, Math.max(min, w / widthOverHeight)));
  }
  return <span className="inline-flex shrink-0 rounded-sm border border-[#5c6570] bg-[#0f1419]" style={{ width: w, height: h }} aria-hidden />;
}

function AspectMenuRow({
  preset,
  selected,
  onSelect,
  icon,
  disabled,
}: {
  preset: PreviewAspectPreset;
  selected: PreviewAspectPreset;
  onSelect: (p: PreviewAspectPreset) => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  const isSel = selected === preset;
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSel}
      disabled={disabled}
      title={preset === "custom" ? "Custom size (coming soon)" : PREVIEW_ASPECT_LABEL[preset]}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-[#e8ecf0] hover:bg-[#1f2730]",
        isSel && "bg-[#1f2730]",
        disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
      )}
      onClick={() => {
        if (!disabled) onSelect(preset);
      }}
    >
      <span className="flex w-5 shrink-0 justify-center">{isSel ? <Check className="h-3.5 w-3.5 text-[#53a9ff]" /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{PREVIEW_ASPECT_LABEL[preset]}</span>
      <span className="flex shrink-0 items-center justify-end text-[#88909a]">{icon}</span>
    </button>
  );
}

export const PreviewPanel: React.FC = () => {
  const { previewMode } = useUIStore();

  // If in source mode, show SourcePreview
  if (previewMode === "source") {
    return <SourcePreview />;
  }

  // Otherwise show program (timeline) preview
  return <ProgramPreview />;
};

const ProgramPreview: React.FC = () => {
  const { isPlaying, currentTime, duration, frameRate, play, pause, seek, formatTime } = usePlayback();
  const { project, mediaAssets } = useProjectStore();
  const { tracks, clips } = useTimelineStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  /** Bumps after program <video> metadata loads so we re-seek once duration is valid. */
  const [previewVideoReadyTick, setPreviewVideoReadyTick] = useState(0);
  /** fit = letterbox full canvas; fill = zoom canvas to cover panel (crop edges). */
  const [previewScaleMode, setPreviewScaleMode] = useState<"fit" | "fill">("fit");
  const [previewAspectPreset, setPreviewAspectPreset] = useState<PreviewAspectPreset>("original");
  const [aspectMenuOpen, setAspectMenuOpen] = useState(false);
  const aspectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aspectMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (aspectMenuRef.current && !aspectMenuRef.current.contains(e.target as Node)) {
        setAspectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [aspectMenuOpen]);

  useEffect(() => {
    const updateDimensions = () => {
      if (!containerRef.current) return;
      setDimensions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    };

    const resizeObserver = new ResizeObserver(() => updateDimensions());
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      setTimeout(updateDimensions, 0);
    }

    return () => resizeObserver.disconnect();
  }, [project]);

  const scene = useMemo(
    () =>
      resolvePreviewScene({
        tracks,
        clips,
        assets: mediaAssets,
        time: currentTime,
        project: project ?? null,
      }),
    [tracks, clips, mediaAssets, currentTime, project],
  );

  useEffect(() => {
    Object.values(videoRefs.current).forEach((video) => {
      if (!video) return;
      const layer = scene.layers.find((l) => l.mediaId === video.dataset.mediaId && l.clipId === video.dataset.clipId);
      if (!layer) return;

      video.muted = isMuted || volume === 0;
      video.volume = Math.max(0, Math.min(1, volume / 100));

      if (Number.isFinite(video.duration) && video.duration > 0) {
        const t = Math.max(0, Math.min(layer.sourceTime, Math.max(0, video.duration - 0.01)));
        if (Math.abs(video.currentTime - t) > 0.05) {
          video.currentTime = t;
        }
      }

      if (isPlaying) {
        try {
          const p = video.play();
          if (p && typeof p.catch === "function") void p.catch(() => undefined);
        } catch {
          // noop in test/jsdom environments
        }
      } else {
        try {
          video.pause();
        } catch {
          // noop
        }
      }
    });
  }, [scene, isPlaying, isMuted, volume, previewVideoReadyTick]);

  if (!project) return null;

  if (dimensions.width === 0 || dimensions.height === 0) {
    return (
      <div className="flex-1 bg-transparent flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div ref={containerRef} className="w-full h-full flex items-center justify-center">
            <div className="text-text-muted">Loading preview...</div>
          </div>
        </div>
      </div>
    );
  }

  const canvasWidth = project.canvasWidth;
  const canvasHeight = project.canvasHeight;
  const originalAspectR = resolveOriginalPreviewAspect(scene.layers, mediaAssets, canvasWidth, canvasHeight);
  const aspectR = previewAspectPreset === "original" ? originalAspectR : previewAspectWidthOverHeight(previewAspectPreset, canvasWidth, canvasHeight);
  const { vw, vh } = previewViewportSize(dimensions.width, dimensions.height, aspectR);
  const scaleFit = Math.min(vw / canvasWidth, vh / canvasHeight);
  const scaleFill = Math.max(vw / canvasWidth, vh / canvasHeight);
  const scale = previewScaleMode === "fit" ? scaleFit : scaleFill;
  const displayWidth = canvasWidth * scale;
  const displayHeight = canvasHeight * scale;

  const landscapePresets: PreviewAspectPreset[] = ["16:9", "4:3", "2.35:1", "2:1", "1.85:1"];
  const portraitPresets: PreviewAspectPreset[] = ["9:16", "3:4", "5.8-inch"];

  const selectAspectPreset = (p: PreviewAspectPreset) => {
    if (p === "custom") return;
    setPreviewAspectPreset(p);
    setAspectMenuOpen(false);
  };

  const step = 1 / Math.max(1, frameRate);

  return (
    <div className="flex-1 bg-transparent flex flex-col min-h-0">
      <div className="flex-1 flex items-center justify-center p-2 overflow-hidden">
        <div ref={containerRef} className="w-full h-full flex items-center justify-center overflow-hidden">
          <div data-testid="program-preview-viewport" className="relative flex shrink-0 items-center justify-center overflow-hidden" style={{ width: vw, height: vh }}>
            <div data-testid="program-preview-canvas" className="relative shrink-0 bg-black" style={{ width: displayWidth, height: displayHeight }}>
            {scene.layers.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-text-muted">Preview</div>
            ) : (
              scene.layers.map((layer) => (
                <div
                  key={`${layer.clipId}-${layer.mediaId}`}
                  data-testid="preview-layer"
                  className="absolute overflow-hidden"
                  style={{
                    left: layer.x * scale,
                    top: layer.y * scale,
                    width: layer.width * scale,
                    height: layer.height * scale,
                    opacity: Math.max(0, Math.min(1, layer.opacity > 1 ? layer.opacity / 100 : layer.opacity)),
                    transform: `rotate(${layer.rotation}deg)`,
                    transformOrigin: "center center",
                    zIndex: layer.zIndex + 1,
                  }}
                >
                  {layer.mediaType === "video" ? (
                    <video
                      data-media-id={layer.mediaId}
                      data-clip-id={layer.clipId}
                      ref={(el) => {
                        videoRefs.current[`${layer.clipId}-${layer.mediaId}`] = el;
                      }}
                      src={layer.sourcePath}
                      muted={isMuted || volume === 0}
                      playsInline
                      preload="auto"
                      onLoadedMetadata={() => setPreviewVideoReadyTick((n) => n + 1)}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <img src={layer.posterFrame || layer.sourcePath} alt={layer.mediaId} className="w-full h-full object-contain" />
                  )}
                </div>
              ))
            )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="panel-shell panel-head p-3 flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => seek(Math.max(0, currentTime - step))} title="Previous frame">
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => (isPlaying ? pause() : play())} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => seek(Math.min(duration, currentTime + step))} title="Next frame">
            <SkipForward className="w-4 h-4" />
          </Button>

          <div className="text-xs text-text-primary min-w-[140px]">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="relative shrink-0" ref={aspectMenuRef}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs"
              onClick={() => setAspectMenuOpen((o) => !o)}
              aria-expanded={aspectMenuOpen}
              aria-haspopup="listbox"
              title="Preview aspect ratio"
            >
              <span className="max-w-[4.5rem] truncate">{PREVIEW_ASPECT_LABEL[previewAspectPreset]}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
            </Button>

            {aspectMenuOpen && (
              <div
                className="absolute bottom-full left-0 z-50 mb-1 w-[220px] overflow-hidden rounded-lg border border-[#2b3442] bg-[#141920] py-1 text-[#e8ecf0] shadow-xl"
                role="listbox"
              >
                <div className="px-1">
                  <AspectMenuRow
                    preset="original"
                    selected={previewAspectPreset}
                    onSelect={selectAspectPreset}
                    icon={<PreviewAspectShapeIcon widthOverHeight={canvasWidth / Math.max(1, canvasHeight)} />}
                  />
                  <AspectMenuRow preset="custom" selected={previewAspectPreset} onSelect={selectAspectPreset} disabled icon={<span className="w-[22px]" />} />
                </div>
                <div className="my-1 h-px bg-[#2b3442]" />
                <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#88909a]">Landscape</div>
                <div className="px-1">
                  {landscapePresets.map((p) => (
                    <AspectMenuRow
                      key={p}
                      preset={p}
                      selected={previewAspectPreset}
                      onSelect={selectAspectPreset}
                      icon={<PreviewAspectShapeIcon widthOverHeight={PREVIEW_ASPECT_RATIO[p]!} />}
                    />
                  ))}
                </div>
                <div className="my-1 h-px bg-[#2b3442]" />
                <div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#88909a]">Portrait</div>
                <div className="px-1">
                  {portraitPresets.map((p) => (
                    <AspectMenuRow
                      key={p}
                      preset={p}
                      selected={previewAspectPreset}
                      onSelect={selectAspectPreset}
                      icon={<PreviewAspectShapeIcon widthOverHeight={PREVIEW_ASPECT_RATIO[p]!} />}
                    />
                  ))}
                </div>
                <div className="my-1 h-px bg-[#2b3442]" />
                <div className="px-1">
                  <AspectMenuRow
                    preset="1:1"
                    selected={previewAspectPreset}
                    onSelect={selectAspectPreset}
                    icon={<PreviewAspectShapeIcon widthOverHeight={1} />}
                  />
                </div>
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setPreviewScaleMode((m) => (m === "fit" ? "fill" : "fit"))}
            title={previewScaleMode === "fit" ? "Fill preview — scale to cover (crop edges)" : "Fit preview — show entire frame (letterbox)"}
            aria-label={previewScaleMode === "fit" ? "Switch preview to fill" : "Switch preview to fit"}
          >
            {previewScaleMode === "fit" ? <Expand className="w-4 h-4" /> : <Shrink className="w-4 h-4" />}
          </Button>

          <div
            className="flex-1 h-2 rounded bg-[#222a34] border border-[#2f3846] cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
              seek(Math.max(0, Math.min(duration, ratio * duration)));
            }}
          >
            <div className="h-full rounded bg-[#53a9ff]" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
          </div>

          <Button variant="ghost" size="icon-sm" onClick={() => setIsMuted((m) => !m)} title={isMuted ? "Unmute" : "Mute"}>
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-20" />
        </div>
      </div>
    </div>
  );
};
