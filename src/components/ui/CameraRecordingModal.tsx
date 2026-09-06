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
  /** Called with the final file path when a recording is complete */
  onRecordingComplete: (filePath: string) => void;
}

// Aspect ratio display label + CSS aspect-ratio value
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micAnimRef = useRef<number>(0);
  const micBarRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [micDropdownOpen, setMicDropdownOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const service = CameraRecordService.getInstance();

  // ── Device enumeration ────────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraModalOpen) return;
    const handleDeviceChange = async () => {
      const [cams, micsArr] = await Promise.all([
        service.enumerateCameras(),
        service.enumerateMics(),
      ]);
      setCameras(cams);
      setMics(micsArr);
    };
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
  }, [cameraModalOpen]);

  // ── Preview stream setup ──────────────────────────────────────────────────
  // WKWebView-safe approach:
  //  - Always open with unconstrained video:true on first mount so we never
  //    stop+reopen the track (WKWebView fires "capture failure" on any track
  //    that is stopped while still in the "starting" state).
  //  - Enumerate AFTER the grant so we get real deviceIds / labels.
  //  - If the user switches cameras via the dropdown, a dedicated
  //    handleSwitchCamera callback reopens cleanly on a stable stream.
  //  - Draw to canvas via rAF (hidden video → canvas) to bypass WKWebView's
  //    broken direct-video-element compositing path.

  const previewStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawLoopRef = useRef<number>(0);
  // Track which device is currently open so the dropdown callback can compare
  const openDeviceIdRef = useRef<string>("");

  // Internal helper: attach a live stream to the hidden video and start the
  // canvas draw loop. Does NOT stop any existing stream.
  const attachStreamToCanvas = React.useCallback(
    (stream: MediaStream, cancelled: { current: boolean }) => {
      const vid = videoRef.current;
      if (!vid || cancelled.current) return;

      // Audio context for mic level meter — set up BEFORE srcObject assignment
      // (WKWebView drops audio tracks when srcObject is set on a muted element)
      cancelAnimationFrame(micAnimRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      if (micEnabled && stream.getAudioTracks().length > 0) {
        try {
          const audioCtx = new AudioContext();
          audioCtxRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const pollMic = () => {
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            if (micBarRef.current)
              micBarRef.current.style.width = `${Math.min(avg / 128, 1) * 100}%`;
            micAnimRef.current = requestAnimationFrame(pollMic);
          };
          pollMic();
        } catch (e) {
          console.warn("[CameraModal] AudioContext:", e);
        }
      }

      // Feed only the video track into the hidden <video> element
      const videoOnlyStream = new MediaStream(stream.getVideoTracks());
      vid.muted = true;
      vid.srcObject = videoOnlyStream;
      vid.play().catch(() => {});

      const startDraw = () => {
        const canvas = canvasRef.current;
        if (!canvas || !vid || cancelled.current) return;
        canvas.width = vid.videoWidth || 640;
        canvas.height = vid.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        cancelAnimationFrame(drawLoopRef.current);
        const draw = () => {
          if (cancelled.current) return;
          if (vid.readyState >= 2 && vid.videoWidth > 0) {
            // Resize canvas if the track resolution changed (e.g. device switch)
            if (
              canvas.width !== vid.videoWidth ||
              canvas.height !== vid.videoHeight
            ) {
              canvas.width = vid.videoWidth;
              canvas.height = vid.videoHeight;
            }
            ctx.save();
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          }
          drawLoopRef.current = requestAnimationFrame(draw);
        };
        draw();
      };

      if (vid.readyState >= 1) {
        startDraw();
      } else {
        vid.onloadedmetadata = () => startDraw();
      }
    },
    [micEnabled],
  );

  const cancelledRef = useRef({ current: false });

  useEffect(() => {
    if (!cameraModalOpen || isRecording) return;

    const cancelled = { current: false };
    cancelledRef.current = cancelled;

    const setup = async () => {
      // Tear down any previous preview cleanly
      cancelAnimationFrame(drawLoopRef.current);
      cancelAnimationFrame(micAnimRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      openDeviceIdRef.current = "";
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraError(null);

      // Open stream with no device constraint — this fires the permission
      // prompt and gives us a live track immediately without any stop/reopen.
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: micEnabled,
        });
      } catch (err: any) {
        if (!cancelled.current)
          setCameraError(
            err?.message ||
              "Camera unavailable — check System Settings → Privacy.",
          );
        return;
      }

      if (cancelled.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Record which device is actually running
      const runningDeviceId =
        stream.getVideoTracks()[0]?.getSettings?.()?.deviceId ?? "";
      openDeviceIdRef.current = runningDeviceId;
      previewStreamRef.current = stream;

      // Enumerate NOW — permission is granted so we get real labels + deviceIds
      const [cams, micsArr] = await Promise.all([
        service.enumerateCameras(),
        service.enumerateMics(),
      ]);
      if (!cancelled.current) {
        setCameras(cams);
        setMics(micsArr);
        // Set defaults without triggering a re-open (we're already live)
        if (cams.length > 0 && !selectedCameraDeviceId) {
          setSelectedCameraDeviceId(runningDeviceId || cams[0].deviceId);
        }
        if (micsArr.length > 0 && !selectedMicDeviceId) {
          setSelectedMicDeviceId(micsArr[0].deviceId);
        }
      }

      attachStreamToCanvas(stream, cancelled);
    };

    setup();

    return () => {
      cancelled.current = true;
      cancelAnimationFrame(drawLoopRef.current);
      cancelAnimationFrame(micAnimRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      openDeviceIdRef.current = "";
      if (videoRef.current) videoRef.current.srcObject = null;
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    };
    // Only re-run when the modal opens/closes or recording starts/stops.
    // Device switching is handled by handleSwitchCamera below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraModalOpen, isRecording]);

  // Switch to a different camera without tearing down the whole effect
  const handleSwitchCamera = React.useCallback(
    async (deviceId: string) => {
      if (deviceId === openDeviceIdRef.current) return;
      setSelectedCameraDeviceId(deviceId);

      const cancelled = cancelledRef.current;
      cancelAnimationFrame(drawLoopRef.current);
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraError(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: micEnabled,
        });
        if (cancelled.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        openDeviceIdRef.current =
          stream.getVideoTracks()[0]?.getSettings?.()?.deviceId ?? deviceId;
        previewStreamRef.current = stream;
        attachStreamToCanvas(stream, cancelled);
      } catch (err: any) {
        setCameraError(err?.message || "Could not switch camera.");
      }
    },
    [micEnabled, attachStreamToCanvas],
  );

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

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleStartRecording = useCallback(async () => {
    try {
      setCameraError(null);
      if (videoRef.current) videoRef.current.srcObject = null;
      service.stopPreview();
      service.stopMicMonitor();
      cancelAnimationFrame(micAnimRef.current);

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
      setPreviewKey((k) => k + 1);
    }
  }, [
    selectedCameraDeviceId,
    selectedMicDeviceId,
    selectedAspectRatio,
    micEnabled,
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
    if (isRecording) return; // don't close mid-recording
    service.stopPreview();
    service.stopMicMonitor();
    cancelAnimationFrame(micAnimRef.current);
    if (videoRef.current) videoRef.current.srcObject = null;
    resetSession();
    closeCameraModal();
  }, [isRecording]);

  const handleFlipCamera = useCallback(async () => {
    if (cameras.length < 2) return;
    const currentIdx = cameras.findIndex(
      (c) => c.deviceId === selectedCameraDeviceId,
    );
    const next = cameras[(currentIdx + 1) % cameras.length];
    handleSwitchCamera(next.deviceId);
  }, [cameras, selectedCameraDeviceId, handleSwitchCamera]);

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
      {/* Close button */}
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
        {/* ── Aspect ratio selector ───────────────────────────────────────── */}
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

        {/* ── Viewfinder ─────────────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl"
          style={{
            aspectRatio: currentRatio.css,
            maxHeight: "55vh",
            width: "auto",
          }}
        >
          {/* Hidden decoder video — never visible, just feeds frames to the canvas */}
          <video ref={videoRef} playsInline style={{ display: "none" }} />
          {/* Canvas viewfinder — frames drawn here via rAF with mirror applied in 2D context */}
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

          {/* Crop guide overlay — shows the target ratio letterbox when sensor differs */}
          {/* Since we request matching ideal dimensions, this mostly acts as a visual frame */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.15)",
              borderRadius: "inherit",
            }}
          />

          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-sm font-mono font-bold tracking-wider">
                {formatTime(recordingSeconds)}
              </span>
            </div>
          )}

          {/* Aspect ratio badge */}
          {!isRecording && (
            <div className="absolute top-4 right-4 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white/70 text-[11px] font-semibold border border-white/10">
              {selectedAspectRatio}
            </div>
          )}

          {/* Camera error overlay */}
          {cameraError && !isRecording && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
              <Camera className="w-10 h-10 text-white/30 mb-3" />
              <p className="text-white/60 text-sm">{cameraError}</p>
            </div>
          )}
        </div>

        {/* ── Controls row ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-5">
          {/* Mic toggle */}
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

          {/* Main record / stop button */}
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
              disabled={!!cameraError}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-400 border-4 border-white flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Start recording"
            >
              <Circle className="w-7 h-7 fill-white text-white" />
            </button>
          )}

          {/* Flip camera */}
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

        {/* ── Mic level bar ─────────────────────────────────────────────── */}
        {micEnabled && !isRecording && (
          <div className="w-full max-w-xs h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              ref={micBarRef}
              className="h-full bg-green-400 rounded-full transition-[width] duration-75"
              style={{ width: "0%" }}
            />
          </div>
        )}

        {/* ── Device pickers ─────────────────────────────────────────────── */}
        {!isRecording && (
          <div className="flex items-center gap-3 text-xs text-white/50">
            {/* Camera picker */}
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
                        onClick={() => {
                          handleSwitchCamera(cam.deviceId);
                          setCameraDropdownOpen(false);
                        }}
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

            {/* Mic picker */}
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
