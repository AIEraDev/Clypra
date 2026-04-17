import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Timeline } from "./features/timeline";
import { CanvasRenderer } from "./features/canvas-preview";
import { clamp } from "./lib/utils";
import { exportTrimmedVideo } from "./lib/tauri";
import { VIDEO_CONFIG, SUPPORTED_VIDEO_FORMATS } from "./constants/config";
import { ErrorToast } from "./components/ui/ErrorToast";
import { useTimelineStore } from "./features/timeline/store/timelineStore";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(VIDEO_CONFIG.DEFAULT_TRIM_DURATION);
  const [playhead, setPlayhead] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<Error | string | null>(null);

  // Subscribe to timeline store playhead changes to sync with local state
  useEffect(() => {
    const unsubscribe = useTimelineStore.subscribe((state) => {
      setPlayhead(state.playhead);
    });
    return unsubscribe;
  }, []);

  const seek = useCallback(
    (t: number) => {
      const el = videoRef.current;
      if (!el || !Number.isFinite(t)) return;
      const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : duration;
      el.currentTime = clamp(t, 0, d || 0);
    },
    [duration],
  );

  const importVideo = async () => {
    setMessage(null);
    setError(null);

    try {
      const picked = await open({
        title: "Open video",
        multiple: false,
        filters: [
          {
            name: "Video",
            extensions: [...SUPPORTED_VIDEO_FORMATS],
          },
        ],
        fileAccessMode: "scoped",
      });

      if (picked === null || Array.isArray(picked)) {
        console.log("No file selected");
        return;
      }

      // Validate the file path
      if (!picked || typeof picked !== "string") {
        throw new Error("Invalid file path selected");
      }

      // Convert file path to URL
      const url = convertFileSrc(picked);
      if (!url) {
        throw new Error("Failed to convert file path to URL");
      }

      // Set the video immediately - let the video element and timeline handle loading
      setSourcePath(picked);
      setVideoUrl(url);
      setDuration(0);
      setTrimStart(0);
      setTrimEnd(VIDEO_CONFIG.DEFAULT_TRIM_DURATION);
      setPlayhead(0);
    } catch (err) {
      console.error("Video import error:", err);
      setError(err instanceof Error ? err : new Error(String(err)));
      // Reset state on error
      setSourcePath(null);
      setVideoUrl(null);
      setDuration(0);
    }
  };

  const onLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const d = el.duration;
    if (!Number.isFinite(d) || d <= 0) {
      setError("Video loaded but has invalid duration");
      return;
    }
    setDuration(d);
    setTrimStart(0);
    setTrimEnd(Math.min(VIDEO_CONFIG.DEFAULT_TRIM_DURATION, d));
    setPlayhead(0);
    setError(null); // Clear any previous errors

    // Update timeline store duration
    useTimelineStore.getState().setDuration(d);
  };

  // Automatically add a video clip when video loads and tracks are ready
  useEffect(() => {
    if (!sourcePath || !videoUrl || duration <= 0) return;

    const { addClip, tracks, clips } = useTimelineStore.getState();

    // Check if we already added a clip for this video (check by videoUrl since that's what we use)
    const existingClip = Array.from(clips.values()).find((clip) => clip.sourceMediaPath === videoUrl);
    if (existingClip) {
      console.log("Clip already exists for this video");
      return;
    }

    // Find the video track (created by TimelineContainer when duration > 0)
    const videoTrack = Array.from(tracks.values()).find((track) => track.type === "video");

    if (videoTrack) {
      // Extract filename from path for clip name
      const fileName = sourcePath.split("/").pop() || sourcePath.split("\\").pop() || "Video";

      // Add a clip spanning the full video duration
      // IMPORTANT: Use videoUrl (Tauri asset protocol) not sourcePath (file system path)
      addClip({
        id: `clip-${Date.now()}`,
        trackId: videoTrack.id,
        name: fileName,
        startTime: 0,
        duration: duration,
        sourceMediaPath: videoUrl, // Use the converted Tauri URL, not the file system path
        sourceStart: 0,
        sourceEnd: duration,
        type: "video",
        locked: false,
        muted: false,
        filmstripUrl: null,
        waveformPeaks: null,
      });
    } else {
      console.log("Waiting for video track to be created...");
    }
  }, [duration, sourcePath, videoUrl]);

  const onVideoError = () => {
    setError("Failed to load video. The file may be corrupted or in an unsupported format.");
    setSourcePath(null);
    setVideoUrl(null);
    setDuration(0);
  };

  useEffect(() => {
    if (duration <= 0) return;
    setTrimStart((s) => clamp(s, 0, duration));
    setTrimEnd((end) => clamp(end, 0, duration));
  }, [duration]);

  const trimValid = duration > 0 && trimEnd > trimStart && trimEnd <= duration + 1e-6 && trimStart >= 0;

  const exportTrimmed = async () => {
    if (!sourcePath || !trimValid) return;
    setMessage(null);
    setError(null);
    const out = await save({
      title: "Export trimmed video",
      defaultPath: "trimmed.mp4",
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (out === null) return;

    setExporting(true);
    try {
      await exportTrimmedVideo(sourcePath, out, trimStart, trimEnd);
      setMessage(`Saved to ${out}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg);
      setMessage(null);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0c0c0c]">
      <header className="shrink-0 border-b border-zinc-800 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-white">Kyro Editor</h1>
            <p className="mt-0.5 text-xs text-zinc-500">Import → preview → trim → export · CapCut-style timeline</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={importVideo} className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white">
              Import video
            </button>
            <button type="button" disabled={!sourcePath || !trimValid || exporting} onClick={exportTrimmed} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">
              {exporting ? "Exporting…" : "Export trim"}
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-2">
        {/* Video Preview - Canvas adapts to video aspect ratio like CapCut */}
        <section className="shrink-0 rounded-lg border border-zinc-800 bg-black shadow-xl max-h-[45vh] flex items-center justify-center overflow-hidden">
          <CanvasRenderer baseWidth={1920} baseHeight={1080} className="max-w-full max-h-full object-contain" />
        </section>

        <section className="grid shrink-0 grid-cols-2 gap-3 md:max-w-md">
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Trim start (s)
            <input
              type="number"
              min={0}
              step={0.1}
              value={trimStart}
              disabled={!sourcePath}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setTrimStart(clamp(v, 0, duration || v));
              }}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-[#00c2ff]/40 disabled:opacity-40"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Trim end (s)
            <input
              type="number"
              min={0}
              step={0.1}
              value={trimEnd}
              disabled={!sourcePath}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setTrimEnd(clamp(v, 0, duration || v));
              }}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-[#00c2ff]/40 disabled:opacity-40"
            />
          </label>
        </section>

        <Timeline duration={duration} trimStart={trimStart} trimEnd={trimEnd} playhead={playhead} onSeek={seek} videoUrl={videoUrl} sourcePath={sourcePath} videoRef={videoRef} />

        {message && <p className="shrink-0 rounded-md border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300">{message}</p>}
      </div>

      {/* Hidden video element for metadata loading and playback control */}
      {videoUrl && <video ref={videoRef} src={videoUrl} className="hidden" onLoadedMetadata={onLoadedMetadata} onError={onVideoError} preload="auto" />}

      {/* Error Toast */}
      <ErrorToast error={error} onDismiss={() => setError(null)} autoHideDuration={8000} />
    </div>
  );
}
