import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Button } from "../ui/Button";
import { usePlayback } from "../../hooks/usePlayback";
import { useProjectStore } from "../../store/projectStore";
import { useTimelineStore } from "../../store/timelineStore";
import { useUIStore } from "../../store/uiStore";
import { resolvePreviewScene } from "../../lib/previewScene";
import { SourcePreview } from "./SourcePreview";

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
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const layer = scene.layers.find((l) => l.mediaId === video.dataset.mediaId && l.clipId === video.dataset.clipId);
      if (!layer) return;
      const t = Math.max(0, Math.min(layer.sourceTime, Math.max(0, video.duration - 0.01)));
      if (Math.abs(video.currentTime - t) > 0.05) video.currentTime = t;
      video.muted = isMuted || volume === 0;
      video.volume = Math.max(0, Math.min(1, volume / 100));
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
  }, [scene, isPlaying, isMuted, volume]);

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
  const scale = Math.min(dimensions.width / canvasWidth, dimensions.height / canvasHeight);
  const displayWidth = canvasWidth * scale;
  const displayHeight = canvasHeight * scale;

  const step = 1 / Math.max(1, frameRate);

  return (
    <div className="flex-1 bg-transparent flex flex-col min-h-0">
      <div className="flex-1 flex items-center justify-center p-2 overflow-hidden">
        <div ref={containerRef} className="w-full h-full flex items-center justify-center">
          <div className="relative bg-black" style={{ width: displayWidth, height: displayHeight }}>
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
                      muted
                      playsInline
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
