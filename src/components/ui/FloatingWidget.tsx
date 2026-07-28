import React, { useEffect, useRef, useState } from "react";
import { StopCircle, AlertTriangle, Pause, Play, Mic, MicOff, FlipHorizontal, Square, Circle, EyeOff } from "lucide-react";
import { useRecordingStore } from "@/store/recordingStore";
import { DualRecordService } from "@/services/dualRecordService";
import { useSettingsStore } from "@/store/settingsStore";
import { AspectRatio } from "@/types";

interface FloatingWidgetProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60, initialClipPaths?: string[]) => void;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const FloatingWidget: React.FC<FloatingWidgetProps> = ({ onProjectCreate }) => {
  const { seconds, setSeconds, hasWebcam, setPreviewRecording, setIsRecording, recordingError, setRecordingError } = useRecordingStore();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Interactive UI State
  const [shape, setShape] = useState<"circle" | "rectangle" | "hidden">("circle");
  const [isMirrored, setIsMirrored] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  // Timer effect — freezes when paused
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [setSeconds, isPaused]);

  // Stream binding effect
  useEffect(() => {
    let active = true;
    let boundStream: MediaStream | null = null;

    const attachStream = () => {
      if (!active) return;
      const stream = DualRecordService.getInstance().getWebcamStream();
      if (videoRef.current && stream) {
        const videoTracks = stream.getVideoTracks();
        if (videoTracks.length > 0) {
          boundStream = new MediaStream(videoTracks);
          videoRef.current.srcObject = boundStream;
          const playPromise = videoRef.current.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((err) => {
              console.error("[FloatingWidget] Failed to play video stream:", err);
            });
          }
        }
      } else if (active) {
        setTimeout(attachStream, 100);
      }
    };
    attachStream();

    return () => {
      active = false;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      boundStream = null;
    };
  }, [hasWebcam]);

  // Auto-recover when recording is externally stopped (screen track ended / recorder error)
  useEffect(() => {
    if (!recordingError || isStopping) return;

    const timeout = setTimeout(async () => {
      setIsStopping(true);
      try {
        const { filePaths } = await DualRecordService.getInstance().stopRecording();
        if (isTauri) {
          try {
            const { restorePreRecordingWindowGeometry } = await import("@/lib/window/windowState");
            await restorePreRecordingWindowGeometry();
          } catch (winErr) {
            console.error("[FloatingWidget] Failed to restore window geometry:", winErr);
          }
        }
        if (filePaths.length > 0) {
          setPreviewRecording({ filePaths });
        }
      } catch {
        DualRecordService.getInstance().cleanup();
      } finally {
        setSeconds(0);
        setIsRecording(false);
        setRecordingError(null);
        setIsStopping(false);
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [recordingError, isStopping, setPreviewRecording, setIsRecording, setSeconds, setRecordingError]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const togglePause = () => {
    const service = DualRecordService.getInstance();
    if (isPaused) {
      service.resumeRecording();
      setIsPaused(false);
    } else {
      service.pauseRecording();
      setIsPaused(true);
    }
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    DualRecordService.getInstance().setMicMuted(nextMute);
    setIsMuted(nextMute);
  };

  const toggleMirror = () => {
    setIsMirrored((prev) => !prev);
  };

  const toggleShape = () => {
    setShape((prev) => {
      if (prev === "circle") return "rectangle";
      if (prev === "rectangle") return "hidden";
      return "circle";
    });
  };

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);

    try {
      const { filePaths, metadata } = await DualRecordService.getInstance().stopRecording();

      if (isTauri) {
        try {
          const { restorePreRecordingWindowGeometry } = await import("@/lib/window/windowState");
          await restorePreRecordingWindowGeometry();
        } catch (winErr) {
          console.error("[FloatingWidget] Failed to restore window geometry:", winErr);
        }
      }

      setPreviewRecording({ filePaths, metadata });
      setSeconds(0);
      setIsRecording(false);
      setRecordingError(null);
    } catch (err: any) {
      console.error("[FloatingWidget] Stop recording failed:", err);
      DualRecordService.getInstance().cleanup();
      setSeconds(0);
      setIsRecording(false);
      setRecordingError(null);

      if (isTauri) {
        try {
          const { restorePreRecordingWindowGeometry } = await import("@/lib/window/windowState");
          await restorePreRecordingWindowGeometry();
        } catch {
          // Best effort
        }
      }
    } finally {
      setIsStopping(false);
    }
  };

  const shapeContainerClass =
    shape === "circle"
      ? "w-48 h-48 rounded-full border-2 border-accent/40"
      : shape === "rectangle"
      ? "w-56 h-36 rounded-2xl border-2 border-accent/40"
      : "hidden";

  return (
    <div
      className="w-full h-full select-none flex flex-col items-center justify-between text-slate-100 p-4 relative"
      style={{
        background: "linear-gradient(160deg, #12121c 0%, #0c0c14 100%)",
      }}
      data-tauri-drag-region
    >
      {/* Error Banner */}
      {recordingError && (
        <div className="absolute top-0 left-0 right-0 z-30 bg-red-600/95 backdrop-blur-sm text-white text-[11px] font-semibold px-3 py-2 flex items-center gap-2 animate-fade-in">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{recordingError}</span>
          <span className="text-white/70 ml-auto text-[10px] flex-shrink-0">Auto-saving…</span>
        </div>
      )}

      {/* Top Drag Indicator Area */}
      <div
        data-tauri-drag-region
        className="w-full h-4 flex items-center justify-center cursor-move text-slate-600 hover:text-slate-400 active:text-slate-300 transition-colors"
      >
        <div data-tauri-drag-region className="w-12 h-1 bg-white/20 rounded-full" />
      </div>

      {/* Facecam Display Area */}
      {hasWebcam && DualRecordService.getInstance().hasWebcamVideoTrack() && shape !== "hidden" ? (
        <div className={`relative overflow-hidden shadow-xl bg-black ${shapeContainerClass}`}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isMirrored ? "scale-x-[-1]" : "scale-x-1"}`}
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg">
            <span className={`w-1.5 h-1.5 rounded-full bg-white ${isPaused ? "" : "animate-ping"}`} />
            {isPaused ? "PAUSED" : `REC ${formatTime(seconds)}`}
          </div>
        </div>
      ) : (
        <div className="relative w-48 h-48 rounded-full flex flex-col items-center justify-center border-2 border-dashed border-white/20 bg-white/5">
          <span className="text-3xl">{shape === "hidden" ? "🙈" : "🖥️"}</span>
          <span className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-wide">
            {shape === "hidden" ? "Camera Hidden" : "Recording Screen"}
          </span>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg">
            <span className={`w-1.5 h-1.5 rounded-full bg-white ${isPaused ? "" : "animate-ping"}`} />
            {isPaused ? "PAUSED" : `REC ${formatTime(seconds)}`}
          </div>
        </div>
      )}

      {/* Interactive Control Toolbar */}
      <div className="w-full bg-[#181826]/90 border border-white/10 rounded-2xl p-2 flex items-center justify-between shadow-xl mb-1 gap-1">
        {/* Left: Duration & Status */}
        <div className="flex flex-col ml-1">
          <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
            {isPaused ? "PAUSED" : "REC"}
          </span>
          <span className="text-xs font-bold text-white font-mono">{formatTime(seconds)}</span>
        </div>

        {/* Middle: Interactive Actions */}
        <div className="flex items-center gap-1">
          {/* Pause / Resume */}
          <button
            onClick={togglePause}
            disabled={isStopping}
            title={isPaused ? "Resume Recording" : "Pause Recording"}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              isPaused
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {/* Mic Mute / Unmute */}
          <button
            onClick={toggleMute}
            title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              isMuted
                ? "bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30"
                : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
            }`}
          >
            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>

          {/* Mirror Flip Toggle */}
          {hasWebcam && shape !== "hidden" && (
            <button
              onClick={toggleMirror}
              title={isMirrored ? "Disable Selfie Mirror" : "Enable Selfie Mirror"}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isMirrored
                  ? "bg-accent/20 border-accent/40 text-accent hover:bg-accent/30"
                  : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <FlipHorizontal className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Camera Shape Toggle */}
          {hasWebcam && (
            <button
              onClick={toggleShape}
              title={`Camera Shape: ${shape}`}
              className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
            >
              {shape === "circle" ? <Circle className="w-3.5 h-3.5" /> : shape === "rectangle" ? <Square className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Right: Stop Capture */}
        <button
          onClick={handleStop}
          disabled={isStopping}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold transition-all shadow-md shadow-red-900/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
        >
          <StopCircle className="w-3.5 h-3.5" />
          {isStopping ? "Saving…" : "Stop"}
        </button>
      </div>
    </div>
  );
};
