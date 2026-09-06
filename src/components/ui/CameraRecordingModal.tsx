import React, { useEffect, useRef, useCallback, useState } from "react";
import {
  Camera,
  Mic,
  MicOff,
  RotateCcw,
  X,
  Circle,
  Square,
  ChevronDown,
  Check,
} from "lucide-react";
import { useCameraStore, type CameraAspectRatio } from "@/store/cameraStore";
import {
  CameraRecordService,
  type CameraDevice,
  type AudioDevice,
} from "@/services/cameraRecordService";

interface CameraRecordingModalProps {
  onRecordingComplete: (filePath: string) => void;
}

const RATIO_OPTIONS: {
  value: CameraAspectRatio;
  label: string;
  css: string;
}[] = [
  { value: "9:16", label: "9:16", css: "9 / 16" },
  { value: "16:9", label: "16:9", css: "16 / 9" },
  { value: "1:1", label: "1:1", css: "1 / 1" },
  { value: "4:3", label: "4:3", css: "4 / 3" },
];

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export const CameraRecordingModal: React.FC<CameraRecordingModalProps> = ({
  onRecordingComplete,
}) => {
  const {
    cameraModalOpen,
    closeCameraModal,
    isRecording,
    setIsRecording,
    recordingSeconds,
    setRecordingSeconds,
    selectedAspectRatio,
    setSelectedAspectRatio,
    selectedCameraDeviceId,
    setSelectedCameraDeviceId,
    selectedMicDeviceId,
    setSelectedMicDeviceId,
    micEnabled,
    setMicEnabled,
    cameraError,
    setCameraError,
    resetSession,
  } = useCameraStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const drawRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnimRef = useRef<number>(0);
  const micBarRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [micDropdownOpen, setMicDropdownOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  // "idle" → waiting for user tap | "starting" → getUserMedia in flight | "live" → frames flowing
  const [previewState, setPreviewState] = useState<
    "idle" | "starting" | "live"
  >("idle");

  const service = CameraRecordService.getInstance();

  // ── Clean up everything when modal closes ────────────────────────────────
  const teardown = useCallback(() => {
    cancelAnimationFrame(drawRef.current);
    cancelAnimationFrame(micAnimRef.current);
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (vidRef.current) vidRef.current.srcObject = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    setPreviewState("idle");
  }, []);

  useEffect(() => {
    if (!cameraModalOpen) {
      teardown();
      return;
    }
    // Reset to idle so the user sees the "tap to enable" prompt on each open
    setPreviewState("idle");
    setCameraError(null);
  }, [cameraModalOpen]);

  // Hot-plug re-enumeration
  useEffect(() => {
    if (!cameraModalOpen) return;
    const onChange = async () => {
      const [cams, micsArr] = await Promise.all([
        service.enumerateCameras(),
        service.enumerateMics(),
      ]);
      setCameras(cams);
      setMics(micsArr);
    };
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [cameraModalOpen]);

  // ── Attach a live stream to canvas + audio meter ─────────────────────────
  const attachStream = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;

      // Audio meter — set up BEFORE srcObject (WKWebView drops audio tracks otherwise)
      cancelAnimationFrame(micAnimRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      if (micEnabled && stream.getAudioTracks().length > 0) {
        try {
          const ac = new AudioContext();
          audioCtxRef.current = ac;
          const src = ac.createMediaStreamSource(stream);
          const anal = ac.createAnalyser();
          anal.fftSize = 256;
          src.connect(anal);
          const buf = new Uint8Array(anal.frequencyBinCount);
          const poll = () => {
            anal.getByteFrequencyData(buf);
            const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
            if (micBarRef.current)
              micBarRef.current.style.width = `${Math.min(avg / 128, 1) * 100}%`;
            micAnimRef.current = requestAnimationFrame(poll);
          };
          poll();
        } catch {
          /* ignore */
        }
      }

      // Feed only the video track into the hidden <video> (WKWebView safe)
      const vid = vidRef.current;
      if (!vid) return;
      vid.srcObject = new MediaStream(stream.getVideoTracks());
      vid.muted = true;
      vid.play().catch(() => {});

      const startDraw = () => {
        const canvas = canvasRef.current;
        if (!canvas || !vid) return;
        canvas.width = vid.videoWidth || 640;
        canvas.height = vid.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        cancelAnimationFrame(drawRef.current);
        const draw = () => {
          if (vid.readyState >= 2 && vid.videoWidth > 0) {
            if (canvas.width !== vid.videoWidth) canvas.width = vid.videoWidth;
            if (canvas.height !== vid.videoHeight)
              canvas.height = vid.videoHeight;
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
          drawRef.current = requestAnimationFrame(draw);
        };
        draw();
        setPreviewState("live");
      };

      if (vid.readyState >= 1) startDraw();
      else vid.onloadedmetadata = () => startDraw();
    },
    [micEnabled],
  );

  // ── USER GESTURE: Enable camera (called from a button click) ─────────────
  // WKWebView requires getUserMedia to be called on the user-gesture call stack.
  // Calling it from a useEffect (no gesture) causes the track to open then
  // immediately die with "capture failure". This button click IS the gesture.
  const handleEnableCamera = useCallback(async () => {
    if (previewState !== "idle") return;
    setPreviewState("starting");
    setCameraError(null);

    // Stop any stale stream
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: micEnabled,
      });
    } catch (err: any) {
      setCameraError(
        err?.message || "Camera unavailable — check System Settings → Privacy.",
      );
      setPreviewState("idle");
      return;
    }

    // Enumerate NOW — permission is granted so we get real labels and deviceIds
    const [cams, micsArr] = await Promise.all([
      service.enumerateCameras(),
      service.enumerateMics(),
    ]);
    setCameras(cams);
    setMics(micsArr);

    const runningId =
      stream.getVideoTracks()[0]?.getSettings?.()?.deviceId ?? "";
    if (!selectedCameraDeviceId)
      setSelectedCameraDeviceId(runningId || cams[0]?.deviceId || "");
    if (!selectedMicDeviceId)
      setSelectedMicDeviceId(micsArr[0]?.deviceId || "");

    attachStream(stream);
  }, [
    previewState,
    micEnabled,
    selectedCameraDeviceId,
    selectedMicDeviceId,
    attachStream,
  ]);

  // ── Switch camera (also user gesture — called from dropdown click) ────────
  const handleSwitchCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCameraDeviceId(deviceId);
      setCameraDropdownOpen(false);
      if (previewState !== "live") return;

      cancelAnimationFrame(drawRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (vidRef.current) vidRef.current.srcObject = null;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: micEnabled,
        });
        attachStream(stream);
      } catch (err: any) {
        setCameraError(err?.message || "Could not switch camera.");
        setPreviewState("idle");
      }
    },
    [previewState, micEnabled, attachStream],
  );

  const handleFlipCamera = useCallback(() => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.deviceId === selectedCameraDeviceId);
    const next = cameras[(idx + 1) % cameras.length];
    handleSwitchCamera(next.deviceId);
  }, [cameras, selectedCameraDeviceId, handleSwitchCamera]);

  // ── Recording timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRecording) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    timerRef.current = setInterval(
      () => setRecordingSeconds((p) => p + 1),
      1000,
    );
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // ── Record / Stop ─────────────────────────────────────────────────────────
  const handleStartRecording = useCallback(async () => {
    try {
      setCameraError(null);
      teardown();
      setRecordingSeconds(0);
      await service.startRecording({
        deviceId: selectedCameraDeviceId ?? undefined,
        audioDeviceId: selectedMicDeviceId ?? undefined,
        aspectRatio: selectedAspectRatio,
        audio: micEnabled,
      });
      setIsRecording(true);
    } catch (err: any) {
      setCameraError(
        err?.message || "Could not start camera. Check permissions.",
      );
    }
  }, [
    selectedCameraDeviceId,
    selectedMicDeviceId,
    selectedAspectRatio,
    micEnabled,
    teardown,
  ]);

  const handleStopRecording = useCallback(async () => {
    if (!service.isRecording() || isStopping) return;
    setIsStopping(true);
    try {
      const filePath = await service.stopRecording();
      setIsRecording(false);
      resetSession();
      closeCameraModal();
      onRecordingComplete(filePath);
    } catch (err: any) {
      setCameraError(err?.message || "Failed to save recording.");
      setIsRecording(false);
      setIsStopping(false);
    }
  }, [isStopping, onRecordingComplete]);

  const handleClose = useCallback(() => {
    if (isRecording) return;
    teardown();
    service.stopPreview();
    service.stopMicMonitor();
    resetSession();
    closeCameraModal();
  }, [isRecording, teardown]);

  if (!cameraModalOpen) return null;

  const currentRatio =
    RATIO_OPTIONS.find((r) => r.value === selectedAspectRatio) ??
    RATIO_OPTIONS[0];
  const currentCamera = cameras.find(
    (c) => c.deviceId === selectedCameraDeviceId,
  );
  const currentMic = mics.find((m) => m.deviceId === selectedMicDeviceId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl">
      {!isRecording && (
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 z-20 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          title="Close"
        >
          <X className="w-5 h-5" />
        </button>
      )}

      <div className="flex flex-col items-center gap-5 w-full max-w-130 px-4">
        {/* Aspect ratio selector */}
        {!isRecording && (
          <div className="flex items-center gap-2">
            {RATIO_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedAspectRatio(opt.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer border ${
                  selectedAspectRatio === opt.value
                    ? "bg-white text-black border-white"
                    : "bg-white/10 text-white/70 border-white/15 hover:bg-white/20 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Viewfinder */}
        <div
          className="relative overflow-hidden rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl"
          style={{
            aspectRatio: currentRatio.css,
            maxHeight: "55vh",
            width: "auto",
            minWidth: "240px",
          }}
        >
          {/* Hidden decoder video */}
          <video ref={vidRef} playsInline style={{ display: "none" }} />

          {/* Canvas viewfinder */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Tap-to-enable overlay — shown until the user clicks to grant camera */}
          {!isRecording && previewState !== "live" && (
            <button
              onClick={handleEnableCamera}
              disabled={previewState === "starting"}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 hover:bg-black/40 transition-colors cursor-pointer disabled:cursor-wait"
            >
              {previewState === "starting" ? (
                <>
                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="text-white/70 text-sm">
                    Starting camera…
                  </span>
                </>
              ) : cameraError ? (
                <>
                  <Camera className="w-10 h-10 text-white/30" />
                  <span className="text-white/60 text-sm text-center px-6">
                    {cameraError}
                  </span>
                  <span className="text-white/40 text-xs">Tap to retry</span>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center hover:bg-white/20 transition-colors">
                    <Camera className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-white/70 text-sm">
                    Tap to enable camera
                  </span>
                </>
              )}
            </button>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-sm font-mono font-bold tracking-wider">
                {formatTime(recordingSeconds)}
              </span>
            </div>
          )}

          {!isRecording && previewState === "live" && (
            <div className="absolute top-4 right-4 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white/70 text-[11px] font-semibold border border-white/10">
              {selectedAspectRatio}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-5">
          {!isRecording && (
            <button
              onClick={() => setMicEnabled(!micEnabled)}
              className={`p-3 rounded-full transition-all cursor-pointer border ${
                micEnabled
                  ? "bg-white/10 border-white/20 text-white hover:bg-white/20"
                  : "bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30"
              }`}
              title={micEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {micEnabled ? (
                <Mic className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
            </button>
          )}

          {isStopping ? (
            <div className="w-18 h-18 rounded-full border-4 border-white/30 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          ) : isRecording ? (
            <button
              onClick={handleStopRecording}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-400 border-4 border-white flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all cursor-pointer active:scale-95"
              title="Stop recording"
            >
              <Square className="w-6 h-6 fill-white text-white" />
            </button>
          ) : (
            <button
              onClick={handleStartRecording}
              disabled={previewState !== "live"}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-400 border-4 border-white flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Start recording"
            >
              <Circle className="w-7 h-7 fill-white text-white" />
            </button>
          )}

          {!isRecording && (
            <button
              onClick={handleFlipCamera}
              disabled={cameras.length < 2}
              className="p-3 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Switch camera"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Mic level bar */}
        {micEnabled && !isRecording && previewState === "live" && (
          <div className="w-full max-w-xs h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              ref={micBarRef}
              className="h-full bg-green-400 rounded-full transition-[width] duration-75"
              style={{ width: "0%" }}
            />
          </div>
        )}

        {/* Device pickers */}
        {!isRecording && previewState === "live" && (
          <div className="flex items-center gap-3 text-xs text-white/50">
            {cameras.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => {
                    setCameraDropdownOpen((o) => !o);
                    setMicDropdownOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 border border-white/10 hover:bg-white/12 transition-colors cursor-pointer text-white/70"
                >
                  <Camera className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">
                    {currentCamera?.label ?? "Camera"}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
                {cameraDropdownOpen && (
                  <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[180px] rounded-xl border border-white/10 bg-[#1a1a1e] py-1 shadow-2xl">
                    {cameras.map((cam) => (
                      <button
                        key={cam.deviceId}
                        onClick={() => handleSwitchCamera(cam.deviceId)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/8 transition-colors cursor-pointer"
                      >
                        <Check
                          className={`w-3 h-3 shrink-0 ${selectedCameraDeviceId === cam.deviceId ? "opacity-100 text-white" : "opacity-0"}`}
                        />
                        <span className="truncate">{cam.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {micEnabled && mics.length > 1 && (
              <div className="relative">
                <button
                  onClick={() => {
                    setMicDropdownOpen((o) => !o);
                    setCameraDropdownOpen(false);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 border border-white/10 hover:bg-white/12 transition-colors cursor-pointer text-white/70"
                >
                  <Mic className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">
                    {currentMic?.label ?? "Microphone"}
                  </span>
                  <ChevronDown className="w-3 h-3 opacity-60" />
                </button>
                {micDropdownOpen && (
                  <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[180px] rounded-xl border border-white/10 bg-[#1a1a1e] py-1 shadow-2xl">
                    {mics.map((mic) => (
                      <button
                        key={mic.deviceId}
                        onClick={() => {
                          setSelectedMicDeviceId(mic.deviceId);
                          setMicDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/8 transition-colors cursor-pointer"
                      >
                        <Check
                          className={`w-3 h-3 shrink-0 ${selectedMicDeviceId === mic.deviceId ? "opacity-100 text-white" : "opacity-0"}`}
                        />
                        <span className="truncate">{mic.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
