import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Play, Pause, Download, Edit3, X, Eye, EyeOff } from "lucide-react";
import { useRecordingStore } from "@/store/recordingStore";
import { useSettingsStore } from "@/store/settingsStore";
import { AspectRatio } from "@/types";
import { t } from "@/i18n";

interface ScreenRecordingPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60, initialClipPaths?: string[]) => void;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const ScreenRecordingPreviewModal: React.FC<ScreenRecordingPreviewModalProps> = ({ isOpen, onClose, onProjectCreate }) => {
  const { previewRecording, setPreviewRecording } = useRecordingStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showCameraPip, setShowCameraPip] = useState(true);

  // Trim range (percentage: 0 to 100)
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(100);
  const [isDragging, setIsDragging] = useState<"start" | "end" | "playhead" | null>(null);

  const filePaths = previewRecording?.filePaths || [];

  // Separate screen and camera recordings
  const { screenPath, cameraPath } = useMemo(() => {
    const screen = filePaths.find((p) => p.includes("screen")) || "";
    const camera = filePaths.find((p) => p.includes("camera")) || "";
    return { screenPath: screen || filePaths[0] || "", cameraPath: camera };
  }, [filePaths]);

  const hasDualRecording = !!screenPath && !!cameraPath;

  // Convert native path to asset URL for webview playback
  const [videoSrc, setVideoSrc] = useState("");
  const [cameraSrc, setCameraSrc] = useState("");

  useEffect(() => {
    if (!screenPath) return;

    if (isTauri) {
      import("@tauri-apps/api/core")
        .then(({ convertFileSrc }) => {
          setVideoSrc(convertFileSrc(screenPath));
          if (cameraPath) {
            setCameraSrc(convertFileSrc(cameraPath));
          }
        })
        .catch((err) => {
          console.error("Failed to convert file src:", err);
          setVideoSrc(screenPath);
          if (cameraPath) setCameraSrc(cameraPath);
        });
    } else {
      setVideoSrc(screenPath);
      if (cameraPath) setCameraSrc(cameraPath);
    }
  }, [screenPath, cameraPath]);

  // Keep video time within trim bounds when playing
  useEffect(() => {
    if (!videoRef.current || duration === 0) return;

    const minTime = (trimStart / 100) * duration;
    const maxTime = (trimEnd / 100) * duration;

    if (currentTime < minTime) {
      videoRef.current.currentTime = minTime;
    } else if (currentTime > maxTime) {
      if (isPlaying) {
        videoRef.current.currentTime = minTime; // Loop back
      } else {
        videoRef.current.currentTime = maxTime;
      }
    }
  }, [currentTime, duration, trimStart, trimEnd, isPlaying]);

  // Sync camera PiP playback with main video
  useEffect(() => {
    if (!cameraVideoRef.current || !videoRef.current) return;
    const mainVideo = videoRef.current;
    const camVideo = cameraVideoRef.current;

    const syncTime = () => {
      if (Math.abs(camVideo.currentTime - mainVideo.currentTime) > 0.3) {
        camVideo.currentTime = mainVideo.currentTime;
      }
    };

    const onPlay = () => {
      camVideo.play().catch(() => {});
      syncTime();
    };
    const onPause = () => {
      camVideo.pause();
      syncTime();
    };
    const onSeeked = () => {
      syncTime();
    };

    mainVideo.addEventListener("play", onPlay);
    mainVideo.addEventListener("pause", onPause);
    mainVideo.addEventListener("seeked", onSeeked);

    return () => {
      mainVideo.removeEventListener("play", onPlay);
      mainVideo.removeEventListener("pause", onPause);
      mainVideo.removeEventListener("seeked", onSeeked);
    };
  }, [cameraSrc]);

  // Use refs for latest values to avoid stale closure issues in the
  // global mousemove handler. The effect only re-registers on `isDragging`
  // changes, but the handler always reads current trim values via refs.
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  const durationRef = useRef(duration);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;
  durationRef.current = duration;

  const handleGlobalMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current || durationRef.current === 0) return;

      const rect = containerRef.current.getBoundingClientRect();
      const clientX = e.clientX;
      const relativeX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const percent = relativeX * 100;

      if (isDragging === "start") {
        setTrimStart(Math.min(percent, trimEndRef.current - 5));
      } else if (isDragging === "end") {
        setTrimEnd(Math.max(percent, trimStartRef.current + 5));
      } else if (isDragging === "playhead") {
        if (videoRef.current) {
          videoRef.current.currentTime = relativeX * durationRef.current;
        }
      }
    },
    [isDragging],
  );

  const handleGlobalMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleGlobalMouseMove);
      window.addEventListener("mouseup", handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isDragging, handleGlobalMouseMove, handleGlobalMouseUp]);

  if (!isOpen || filePaths.length === 0) return null;

  const isTrimmed = trimStart > 0 || trimEnd < 100;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
  };

  // Drag handlers for custom trimmer and timeline scrubber
  const handleTimelineMouseDown = (e: React.MouseEvent, type: "start" | "end" | "playhead") => {
    e.preventDefault();
    setIsDragging(type);
  };

  const handleDownload = async () => {
    if (isDownloading || !screenPath) return;

    try {
      if (isTauri) {
        const { save } = await import("@tauri-apps/plugin-dialog");

        const ext = screenPath.split(".").pop() || "webm";
        const selectedPath = await save({
          defaultPath: `clypra_recording.${ext}`,
          filters: [{ name: t("recording.videoFilterName"), extensions: [ext] }],
        });

        if (selectedPath) {
          setIsDownloading(true);

          if (isTrimmed && duration > 0) {
            // Use Rust FFmpeg trim for actual trimmed output
            const { invoke } = await import("@tauri-apps/api/core");
            const startSeconds = (trimStart / 100) * duration;
            const endSeconds = (trimEnd / 100) * duration;
            await invoke("trim_video", {
              inputPath: screenPath,
              outputPath: selectedPath,
              startSeconds,
              endSeconds,
            });
          } else {
            // No trim — fast file copy
            const { copyFile } = await import("@tauri-apps/plugin-fs");
            await copyFile(screenPath, selectedPath);
          }

          setIsDownloading(false);
        }
      } else {
        // Browser fallback (no trim support)
        const a = document.createElement("a");
        a.href = videoSrc;
        a.download = "clypra_recording.webm";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.error("[PreviewModal] Download failed:", err);
      setIsDownloading(false);
    }
  };

  const handleEditMore = () => {
    const { defaultFrameRate } = useSettingsStore.getState();
    // Trim values can be loaded inside timeline later.
    // For now, auto-create project and navigate.
    onProjectCreate(t("recording.defaultProjectName"), "16:9", defaultFrameRate, filePaths);
    setPreviewRecording(null);
  };

  const handleClose = () => {
    if (showCloseConfirm) {
      // User confirmed — close
      setShowCloseConfirm(false);
      onClose();
    } else {
      // Show confirmation first
      setShowCloseConfirm(true);
    }
  };

  const handleCancelClose = () => {
    setShowCloseConfirm(false);
  };

  const formatTimecode = (seconds: number, fps = 30) => {
    // Guard against NaN/Infinity (video not yet loaded)
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    const frames = Math.floor((seconds % 1) * fps).toString().padStart(2, "0");
    return `${hrs}:${mins}:${secs}:${frames}`;
  };

  // ── Filmstrip ────────────────────────────────────────────────────────────────
  const filmstripCanvasRef = useRef<HTMLCanvasElement>(null);
  const filmstripDrawnRef = useRef(false);

  // Draw thumbnail frames onto the filmstrip canvas once the video is loaded
  const drawFilmstrip = useCallback(async () => {
    const video = videoRef.current;
    const canvas = filmstripCanvasRef.current;
    if (!video || !canvas || !Number.isFinite(video.duration) || video.duration <= 0) return;
    if (filmstripDrawnRef.current) return;
    filmstripDrawnRef.current = true;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const totalDur = video.duration;
    const frameCount = Math.max(4, Math.min(16, Math.floor(canvas.offsetWidth / 48)));
    const frameW = canvas.width / frameCount;
    const frameH = canvas.height;

    // Preserve original time so playback isn't disrupted
    const originalTime = video.currentTime;
    const wasPaused = video.paused;
    if (!wasPaused) video.pause();

    for (let i = 0; i < frameCount; i++) {
      const t = (i / frameCount) * totalDur;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          ctx.drawImage(video, i * frameW, 0, frameW, frameH);
          resolve();
        };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.currentTime = t;
      });
    }

    // Restore original position
    video.currentTime = originalTime;
    if (!wasPaused) video.play().catch(() => {});
  }, []);

  useEffect(() => {
    filmstripDrawnRef.current = false;
  }, [videoSrc]);

  // Trigger filmstrip draw once video metadata is ready AND duration is known
  useEffect(() => {
    if (duration > 0) {
      drawFilmstrip();
    }
  }, [duration, drawFilmstrip]);

  const playheadPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-1000 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-[600px] rounded-2xl bg-[#14141e]/95 border border-white/8 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#1a1a26]/50">
          <button onClick={handleClose} aria-label={t("recording.closePreview")} className="w-3.5 h-3.5 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center text-[8px] text-red-950 font-bold">
            ✕
          </button>
          <span className="text-sm font-semibold text-slate-300">{t("recording.previewTitle")}</span>
          <div className="w-4" /> {/* Spacer */}
        </div>

        {/* Close Confirmation Banner */}
        {showCloseConfirm && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
            <span className="text-xs text-amber-300">{t("recording.discardPreview")}</span>
            <div className="flex items-center gap-2">
              <button onClick={handleCancelClose} className="px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white rounded-md hover:bg-white/5 transition-colors">
                {t("common.cancel")}
              </button>
              <button
                onClick={() => {
                  setShowCloseConfirm(false);
                  onClose();
                }}
                className="px-2.5 py-1 text-[11px] font-semibold text-amber-400 hover:text-amber-300 rounded-md hover:bg-amber-500/10 transition-colors"
              >
                {t("recovery.discard")}
              </button>
            </div>
          </div>
        )}

        {/* Video Preview */}
        <div className="relative aspect-video bg-[#0a0a0f] border-b border-white/5 flex items-center justify-center overflow-hidden">
          {videoSrc ? <video ref={videoRef} src={videoSrc} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onEnded={handleEnded} onClick={togglePlay} className="max-w-full max-h-full object-contain cursor-pointer" /> : <div className="text-slate-500 text-xs">{t("recording.loadingPreview")}</div>}

          {/* Camera PiP overlay */}
          {hasDualRecording && cameraSrc && showCameraPip && (
            <div className="absolute bottom-3 right-3 w-28 aspect-video rounded-lg overflow-hidden border border-white/20 shadow-2xl bg-black z-10">
              <video ref={cameraVideoRef} src={cameraSrc} muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
            </div>
          )}

          {/* Camera PiP toggle */}
          {hasDualRecording && (
            <button onClick={() => setShowCameraPip((v) => !v)} className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-black/50 backdrop-blur-sm border border-white/10 hover:bg-black/70 transition-colors text-white/70 hover:text-white" title={showCameraPip ? t("recording.hideCamera") : t("recording.showCamera")} aria-label={showCameraPip ? t("recording.hideCamera") : t("recording.showCamera")}>
              {showCameraPip ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Timeline & Controls */}
        <div className="p-5 flex flex-col gap-4 bg-[#14141e]">
          {/* Trimmer Timeline Slider */}
          <div className="flex flex-col gap-1.5">
            <div className="relative h-10 bg-[#08080f] rounded-md border border-white/8 overflow-hidden" ref={containerRef}>
              {/* Filmstrip canvas — drawn once from video frames */}
              <canvas
                ref={filmstripCanvasRef}
                width={800}
                height={40}
                className="absolute inset-0 w-full h-full object-cover opacity-60"
              />

              {/* Darkened inactive regions outside the trim zone */}
              <div className="absolute top-0 bottom-0 left-0 bg-black/60" style={{ width: `${trimStart}%` }} />
              <div className="absolute top-0 bottom-0 right-0 bg-black/60" style={{ width: `${100 - trimEnd}%` }} />

              {/* Visual Trim Region overlay — accent border showing the selected region */}
              <div
                className="absolute top-0 bottom-0 border-x-2 border-accent pointer-events-none"
                style={{
                  left: `${trimStart}%`,
                  right: `${100 - trimEnd}%`,
                  boxShadow: "inset 0 0 0 1px rgba(108,99,255,0.15)",
                }}
              />

              {/* Range slider tracks (inactive areas) */}
              <div className="absolute top-0 bottom-0 left-0 bg-black/40" style={{ width: `${trimStart}%` }} />
              <div className="absolute top-0 bottom-0 right-0 bg-black/40" style={{ width: `${100 - trimEnd}%` }} />

              {/* Start Handle */}
              <div onMouseDown={(e) => handleTimelineMouseDown(e, "start")} className="absolute top-0 bottom-0 w-3 bg-accent rounded-l-md cursor-ew-resize flex items-center justify-center border-r border-white/20 select-none" style={{ left: `${trimStart}%`, transform: "translateX(-50%)", zIndex: 10 }}>
                <div className="w-0.5 h-3 bg-white/60" />
              </div>

              {/* End Handle */}
              <div onMouseDown={(e) => handleTimelineMouseDown(e, "end")} className="absolute top-0 bottom-0 w-3 bg-accent rounded-r-md cursor-ew-resize flex items-center justify-center border-l border-white/20 select-none" style={{ left: `${trimEnd}%`, transform: "translateX(-50%)", zIndex: 10 }}>
                <div className="w-0.5 h-3 bg-white/60" />
              </div>

              {/* Playhead Scrubber */}
              <div onMouseDown={(e) => handleTimelineMouseDown(e, "playhead")} className="absolute top-0 bottom-0 w-0.5 bg-white cursor-ew-resize select-none" style={{ left: `${playheadPercent}%`, zIndex: 20 }}>
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-white shadow-md" />
              </div>
            </div>
          </div>

          {/* Player controls */}
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? t("recording.pausePreview") : t("recording.playPreview")}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 text-white transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
            </button>
            <div className="flex items-center gap-1.5 select-none">
              <span className="text-white">{formatTimecode(currentTime)}</span>
              <span>/</span>
              <span>{formatTimecode(Number.isFinite(duration) && duration > 0 ? (trimEnd - trimStart) / 100 * duration : 0)}</span>
            </div>
          </div>

          {/* Trim indicator */}
          {isTrimmed && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/8 border border-accent/20">
              <span className="text-[11px] text-accent font-semibold">{t("recording.trimmed")}</span>
              <span className="text-[10px] text-slate-400">
                {formatTimecode((trimStart / 100) * duration)} → {formatTimecode((trimEnd / 100) * duration)}
              </span>
              <button
                onClick={() => {
                  setTrimStart(0);
                  setTrimEnd(100);
                }}
                className="ml-auto text-[10px] text-slate-500 hover:text-white transition-colors"
              >
                {t("common.reset")}
              </button>
            </div>
          )}

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-3 mt-1">
            <button onClick={handleDownload} disabled={isDownloading} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 text-white font-semibold text-sm transition-all border border-white/5 cursor-pointer disabled:opacity-50">
              <Download className="w-4 h-4" />
              {isDownloading ? t("recording.processing") : isTrimmed ? t("recording.downloadTrimmed") : t("common.download")}
            </button>
            <button onClick={handleEditMore} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#00b4c8] hover:bg-[#00cdd8] active:bg-[#00a0b0] text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/10 cursor-pointer">
              <Edit3 className="w-4 h-4" />
              {t("recording.editMore")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
