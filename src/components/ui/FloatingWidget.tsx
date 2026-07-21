import React, { useEffect, useRef } from "react";
import { StopCircle, AlertTriangle } from "lucide-react";
import { useRecordingStore } from "@/store/recordingStore";
import { DualRecordService } from "@/services/dualRecordService";
import { useSettingsStore } from "@/store/settingsStore";
import { AspectRatio } from "@/types";
import { t } from "@/i18n";

interface FloatingWidgetProps {
  onProjectCreate: (name: string, aspectRatio: AspectRatio, frameRate: 24 | 30 | 60, initialClipPaths?: string[]) => void;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const FloatingWidget: React.FC<FloatingWidgetProps> = ({ onProjectCreate }) => {
  const { seconds, setSeconds, hasWebcam, setPreviewRecording, setIsRecording, recordingError, setRecordingError } = useRecordingStore();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Timer effect
  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [setSeconds]);

  // Stream binding effect
  useEffect(() => {
    let active = true;
    let clonedStream: MediaStream | null = null;

    const attachStream = () => {
      if (!active) return;
      const stream = DualRecordService.getInstance().getWebcamStream();
      if (videoRef.current && stream) {
        if (clonedStream) {
          clonedStream.getTracks().forEach((t) => t.stop());
        }

        // WebKit / WKWebView workaround: Clone the stream to force re-binding
        // the video tracks to this new <video> element. In Tauri's Safari-based
        // webview, assigning the same MediaStream to a second element doesn't
        // reliably start playback. Cloning creates a new internal binding.
        // TODO: Remove when WebKit fixes MediaStream element re-attachment.
        clonedStream = stream.clone();
        videoRef.current.srcObject = clonedStream;
        videoRef.current.play().catch((err) => {
          console.error("[FloatingWidget] Failed to play video stream:", err);
        });
      } else {
        setTimeout(attachStream, 100);
      }
    };
    attachStream();

    return () => {
      active = false;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (clonedStream) {
        clonedStream.getTracks().forEach((t) => t.stop());
        clonedStream = null;
      }
    };
  }, [hasWebcam]);

  // Auto-recover when recording is externally stopped (screen track ended / recorder error)
  useEffect(() => {
    if (!recordingError) return;

    // Give the user a moment to see the error, then auto-stop
    const timeout = setTimeout(async () => {
      try {
        const { filePaths } = await DualRecordService.getInstance().stopRecording();
        if (isTauri) {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const { LogicalSize } = await import("@tauri-apps/api/dpi");
            const win = getCurrentWindow();
            await win.setMinSize(new LogicalSize(1100, 720));
            await win.setSize(new LogicalSize(1100, 720));
            await win.setAlwaysOnTop(false);
          } catch (winErr) {
            console.error("[FloatingWidget] Failed to restore window size:", winErr);
          }
        }
        if (filePaths.length > 0) {
          setPreviewRecording({ filePaths });
        }
      } catch {
        // stopRecording may fail if already cleaned up — that's fine
        DualRecordService.getInstance().cleanup();
      } finally {
        setSeconds(0);
        setIsRecording(false);
        setRecordingError(null);
      }
    }, 2000);

    return () => clearTimeout(timeout);
  }, [recordingError, setPreviewRecording, setIsRecording, setSeconds, setRecordingError]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleStop = async () => {
    try {
      const { filePaths } = await DualRecordService.getInstance().stopRecording();

      if (isTauri) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const { LogicalSize } = await import("@tauri-apps/api/dpi");
          const win = getCurrentWindow();
          await win.setMinSize(new LogicalSize(1100, 720));
          await win.setSize(new LogicalSize(1100, 720));
          await win.setAlwaysOnTop(false);
        } catch (winErr) {
          console.error("[FloatingWidget] Failed to restore window size:", winErr);
        }
      }

      setPreviewRecording({ filePaths });
      setSeconds(0);
      setIsRecording(false);
    } catch (err: any) {
      console.error("[FloatingWidget] Stop recording failed:", err);
      // CRITICAL: Always exit the floating widget — don't trap the user
      DualRecordService.getInstance().cleanup();
      setSeconds(0);
      setIsRecording(false);

      if (isTauri) {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const { LogicalSize } = await import("@tauri-apps/api/dpi");
          const win = getCurrentWindow();
          await win.setMinSize(new LogicalSize(1100, 720));
          await win.setSize(new LogicalSize(1100, 720));
          await win.setAlwaysOnTop(false);
        } catch {
          // Best effort
        }
      }
    }
  };


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
          <span className="text-white/70 ml-auto text-[10px] flex-shrink-0">{t("recording.autoSaving")}</span>
        </div>
      )}

      {/* Top Drag Indicator Area */}
      <div
        data-tauri-drag-region
        className="w-full h-4 flex items-center justify-center cursor-move text-slate-600 hover:text-slate-400 active:text-slate-300 transition-colors"
      >
        <div data-tauri-drag-region className="w-12 h-1 bg-white/20 rounded-full" />
      </div>

      {/* Circular Facecam Bubble */}
      {hasWebcam && DualRecordService.getInstance().hasWebcamVideoTrack() ? (
        <div className="relative w-48 h-48 rounded-full overflow-hidden border-2 border-accent/40 shadow-xl bg-black">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover scale-x-[-1]"
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            {t("recording.recordingWithTime", { time: formatTime(seconds) })}
          </div>
        </div>
      ) : (
        <div className="relative w-48 h-48 rounded-full flex flex-col items-center justify-center border-2 border-dashed border-white/20 bg-white/5">
          <span className="text-3xl">🖥️</span>
          <span className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-wide">{t("recording.recordingScreen")}</span>
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            {t("recording.recordingWithTime", { time: formatTime(seconds) })}
          </div>
        </div>
      )}

      {/* Control toolbar */}
      <div className="w-full bg-[#181826]/90 border border-white/10 rounded-2xl p-3 flex items-center justify-between shadow-xl mb-1">
        <div className="flex flex-col ml-1">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{t("recording.duration")}</span>
          <span className="text-xs font-bold text-white font-mono">{formatTime(seconds)}</span>
        </div>

        <button
          onClick={handleStop}
          disabled={!!recordingError}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 active:bg-red-700 text-white text-xs font-bold transition-all shadow-md shadow-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <StopCircle className="w-4 h-4" />
          {t("recording.stopCapture")}
        </button>
      </div>
    </div>
  );
};
