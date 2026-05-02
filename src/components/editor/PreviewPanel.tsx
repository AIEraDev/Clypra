import React, { useRef, useEffect, useState } from "react";
import { Volume2, VolumeX, SkipBack, ChevronLeft, Circle, ChevronRight, SkipForward } from "lucide-react";
import { Button } from "../ui/Button";
import { usePlayback } from "../../hooks/usePlayback";
import { useProjectStore } from "../../store/projectStore";
import { useUIStore } from "../../store/uiStore";

export const PreviewPanel: React.FC = () => {
  const { isPlaying, currentTime, duration, frameRate, play, pause, seek, formatTime } = usePlayback();
  const { project, mediaAssets } = useProjectStore();
  const { previewMediaId } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({
          width: clientWidth,
          height: clientHeight,
        });
      }
    };

    // Use ResizeObserver for better dimension tracking
    const resizeObserver = new ResizeObserver((entries) => {
      updateDimensions();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
      // Initial update with a small delay to ensure layout is complete
      setTimeout(updateDimensions, 0);
      setTimeout(updateDimensions, 100);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [project]);

  if (!project) {
    console.log("[PreviewPanel] No project, returning null");
    return null;
  }

  const previewMedia = previewMediaId ? mediaAssets.find((asset) => asset.id === previewMediaId) : null;

  const canvasWidth = project.canvasWidth;
  const canvasHeight = project.canvasHeight;

  // Only calculate if we have valid dimensions, otherwise show a loading state
  if (dimensions.width === 0 || dimensions.height === 0) {
    return (
      <div className="flex-1 bg-surface flex flex-col">
        <div className="flex-1 flex items-center justify-center p-4">
          <div ref={containerRef} className="w-full h-full flex items-center justify-center">
            <div className="text-text-muted">Loading preview...</div>
          </div>
        </div>
      </div>
    );
  }

  const containerWidth = dimensions.width;
  const containerHeight = dimensions.height;

  const scale = Math.min(containerWidth / canvasWidth, containerHeight / canvasHeight);
  const displayWidth = canvasWidth * scale;
  const displayHeight = canvasHeight * scale;

  const handlePlayheadClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const newTime = (relativeX / displayWidth) * duration;
    seek(newTime);
  };

  return (
    <div className="flex-1 bg-surface flex flex-col">
      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <div ref={containerRef} className="w-full h-full flex items-center justify-center">
          <div
            className="checkerboard rounded"
            style={{
              width: displayWidth,
              height: displayHeight,
            }}
          >
            <div className="w-full h-full bg-surface-raised flex items-center justify-center text-text-muted overflow-hidden relative">
              {previewMedia ? (
                previewMedia.type === "video" || previewMedia.type === "image" ? (
                  previewMedia.posterFrame ? (
                    <img src={previewMedia.posterFrame} alt={previewMedia.name} className="max-w-full max-h-full object-contain" />
                  ) : previewMedia.type === "image" ? (
                    <img src={previewMedia.path} alt={previewMedia.name} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <video src={previewMedia.path} className="max-w-full max-h-full object-contain" controls={false} />
                  )
                ) : (
                  <div className="text-center z-10">
                    <div className="text-4xl mb-2">🎵</div>
                    <div className="text-sm">{previewMedia.name}</div>
                  </div>
                )
              ) : (
                "Preview"
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
