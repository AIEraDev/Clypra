/**
 * CameraRecordingModal
 *
 * Front camera only recording modal with live aspect-ratio preview framing
 * (9:16, 16:9, 1:1, 4:3) and native post-processing.
 *
 * Architecture:
 * - Direct WebKit video stream for zero-latency, hardware-accelerated preview.
 * - Single getUserMedia call shared by video, mic VU metering, and recorder
 *   (eliminates macOS AVCaptureSession contention).
 * - Live aspect-ratio container with `object-cover` and selfie mirroring (`scale-x-[-1]`).
 * - MediaRecorder captures raw video stream; on stop, Clypra's Rust backend
 *   (`process_camera_recording`) center-crops to target aspect ratio and exports clean MP4.
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

// ── Props ─────────────────────────────────────────────────────────────────────

interface CameraRecordingModalProps {
  onRecordingComplete: (filePath: string, aspectRatio: CameraAspectRatio) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

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
    previewState,
    setPreviewState,
    availableCameras,
    setAvailableCameras,
    availableMics,
    setAvailableMics,
    cameraError,
    setCameraError,
    resetSession,
  } = useCameraStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micBarRef = useRef<HTMLDivElement>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const micAnimRef = useRef<number>(0);

  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [micDropdownOpen, setMicDropdownOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [sensorCoveredWarning, setSensorCoveredWarning] = useState(false);

  const service = CameraRecordService.getInstance();

  // ── Stream binding helper (direct hardware-accelerated WebKit video) ───────

  const attachStreamToVideo = useCallback((stream: MediaStream) => {
    const vid = videoRef.current;
    console.log("%c🎥 [CameraDebug] attachStreamToVideo called.", "color: #e879f9; font-weight: bold;", {
      hasVidRef: !!vid,
      streamId: stream.id,
      streamActive: stream.active,
      videoTrackCount: stream.getVideoTracks().length,
      audioTrackCount: stream.getAudioTracks().length,
    });

    if (!vid) {
      console.error("❌ [CameraDebug] attachStreamToVideo: videoRef.current is NULL!");
      return;
    }

    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      console.error("❌ [CameraDebug] No video tracks in stream!");
      return;
    }

    // Inspect layout geometry
    const rect = vid.getBoundingClientRect();
    const computed = window.getComputedStyle(vid);
    console.log("%c🎥 [CameraDebug] <video> DOM Geometry & Computed Style:", "color: #38bdf8;", {
      clientWidth: vid.clientWidth,
      clientHeight: vid.clientHeight,
      offsetWidth: vid.offsetWidth,
      offsetHeight: vid.offsetHeight,
      rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
    });

    // Ensure WebKit media flags
    vid.defaultMuted = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.setAttribute("muted", "");
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    vid.setAttribute("autoplay", "");

    // Monitor all video element events
    const eventsToTrack = [
      "loadstart",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "play",
      "playing",
      "pause",
      "waiting",
      "stalled",
      "suspend",
      "error",
    ];

    eventsToTrack.forEach((evtName) => {
      vid.addEventListener(
        evtName,
        () => {
          console.log(`%c🎥 [CameraDebug] <video> EVENT: '${evtName}'`, "color: #60a5fa; font-weight: bold;", {
            videoWidth: vid.videoWidth,
            videoHeight: vid.videoHeight,
            readyState: vid.readyState,
            paused: vid.paused,
            currentTime: vid.currentTime,
            error: vid.error ? { code: vid.error.code, message: vid.error.message } : null,
          });
        },
        { passive: true },
      );
    });

    // Monitor timeupdate and sample pixel luminance to verify frame rendering
    let timeTick = 0;
    let consecutiveBlackCount = 0;
    vid.ontimeupdate = () => {
      timeTick++;
      if (timeTick <= 5 || timeTick % 15 === 0) {
        let pixelAnalysis = "N/A";
        try {
          if (vid.videoWidth > 0 && vid.videoHeight > 0) {
            const probeCanvas = document.createElement("canvas");
            probeCanvas.width = 16;
            probeCanvas.height = 16;
            const ctx = probeCanvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(vid, 0, 0, 16, 16);
              const imgData = ctx.getImageData(0, 0, 16, 16).data;
              let rTotal = 0, gTotal = 0, bTotal = 0;
              for (let i = 0; i < imgData.length; i += 4) {
                rTotal += imgData[i];
                gTotal += imgData[i + 1];
                bTotal += imgData[i + 2];
              }
              const pxCount = imgData.length / 4;
              const avgR = Math.round(rTotal / pxCount);
              const avgG = Math.round(gTotal / pxCount);
              const avgB = Math.round(bTotal / pxCount);
              const isPureBlack = avgR + avgG + avgB === 0;
              if (isPureBlack) {
                consecutiveBlackCount++;
                if (consecutiveBlackCount >= 6) {
                  setSensorCoveredWarning(true);
                }
              } else {
                consecutiveBlackCount = 0;
                setSensorCoveredWarning(false);
              }
              pixelAnalysis = isPureBlack
                ? `⚠️ PURE BLACK (RGB: 0,0,0) [count: ${consecutiveBlackCount}] — Hardware/OS is feeding black frames`
                : `✅ LIGHT DETECTED! Avg RGB(${avgR}, ${avgG}, ${avgB})`;
            }
          }
        } catch (e: any) {
          pixelAnalysis = `Probe failed: ${e?.message}`;
        }

        console.log(`%c🎥 [CameraDebug] Frame update #${timeTick}:`, "color: #34d399;", {
          currentTime: vid.currentTime.toFixed(2),
          videoWidth: vid.videoWidth,
          videoHeight: vid.videoHeight,
          readyState: vid.readyState,
          pixelAnalysis,
        });
      }
    };

    console.log("%c🎥 [CameraDebug] Setting vid.srcObject = video-only stream", "color: #f59e0b;");
    // Only pass video tracks to the <video> element.
    // In WebKit (macOS), assigning a MediaStream with audio tracks to a muted <video> element
    // causes WebKit's audio unit to terminate the capture track with
    // "A MediaStreamTrack ended due to a capture failure".
    const previewStream = new MediaStream(stream.getVideoTracks());
    vid.srcObject = previewStream;

    vid.play()
      .then(() => {
        console.log("%c✅ [CameraDebug] vid.play() PROMISE RESOLVED SUCCESSFULLY!", "color: #22c55e; font-weight: bold;", {
          videoWidth: vid.videoWidth,
          videoHeight: vid.videoHeight,
          readyState: vid.readyState,
          paused: vid.paused,
          currentTime: vid.currentTime,
        });
        setPreviewState("live");
      })
      .catch((err) => {
        console.error("%c❌ [CameraDebug] vid.play() PROMISE REJECTED:", "color: #ef4444; font-weight: bold;", err);
      });
  }, [setPreviewState]);

  // ── Teardown helper ─────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    console.log("%c🎥 [CameraDebug] teardown called.", "color: #94a3b8;");
    setSensorCoveredWarning(false);
    cancelAnimationFrame(micAnimRef.current);
    micAudioCtxRef.current?.close().catch?.(() => {});
    micAudioCtxRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (micBarRef.current) {
      micBarRef.current.style.width = "0%";
    }

    setPreviewState("idle");
  }, [setPreviewState]);

  // ── Stop mic meter ──────────────────────────────────────────────────────────

  const stopMicMeter = useCallback(() => {
    cancelAnimationFrame(micAnimRef.current);
    micAudioCtxRef.current?.close().catch?.(() => {});
    micAudioCtxRef.current = null;
    if (micBarRef.current) {
      micBarRef.current.style.width = "0%";
    }
  }, []);

  // ── Start mic VU meter from an active stream ────────────────────────────────

  const startMicMeter = useCallback((stream: MediaStream) => {
    stopMicMeter();

    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    try {
      const ac = new AudioContext();
      micAudioCtxRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      const anal = ac.createAnalyser();
      anal.fftSize = 256;
      src.connect(anal);
      const buf = new Uint8Array(anal.frequencyBinCount);

      const poll = () => {
        anal.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        if (micBarRef.current) {
          micBarRef.current.style.width = `${Math.min(avg / 128, 1) * 100}%`;
        }
        micAnimRef.current = requestAnimationFrame(poll);
      };
      poll();
    } catch (err) {
      console.warn("[CameraModal] Mic meter setup failed:", err);
    }
  }, [stopMicMeter]);

  const isAcquiringStreamRef = useRef<boolean>(false);
  const hasInitializedModalRef = useRef<boolean>(false);

  // ── Start camera preview ────────────────────────────────────────────────────

  const startCameraPreview = useCallback(
    async (targetCamId?: string | null, targetMicId?: string | null) => {
      if (isAcquiringStreamRef.current) {
        console.warn("🎥 [CameraDebug] startCameraPreview already in progress, ignoring concurrent call.");
        return;
      }
      isAcquiringStreamRef.current = true;

      const storeState = useCameraStore.getState();
      const effectiveMicEnabled = storeState.micEnabled;
      const effectiveCamId = targetCamId || storeState.selectedCameraDeviceId;
      let effectiveMicId = targetMicId || storeState.selectedMicDeviceId;

      // Auto-resolve hardware mic (MacBook Pro Microphone) to avoid QuickTime 2.1 channel capture failure
      if (!effectiveMicId && effectiveMicEnabled) {
        try {
          const preferredMic = await service.getPreferredMicrophone();
          if (preferredMic && preferredMic.deviceId && preferredMic.deviceId.trim().length > 0) {
            effectiveMicId = preferredMic.deviceId;
            console.log(
              "%c🎤 [CameraDebug] Auto-selected hardware microphone:",
              "color: #a855f7; font-weight: bold;",
              preferredMic,
            );
          }
        } catch (micResolveErr) {
          console.warn("[CameraDebug] Preferred mic pre-resolution error:", micResolveErr);
        }
      }

      const validMicId = effectiveMicId && effectiveMicId.trim().length > 0 ? effectiveMicId : null;

      console.log("%c🎥 [CameraDebug] startCameraPreview invoked (LOCKED).", "color: #38bdf8; font-weight: bold;", {
        targetCamId,
        targetMicId,
        effectiveCamId,
        effectiveMicId: validMicId,
        micEnabled: effectiveMicEnabled,
      });

      setPreviewState("initializing");
      setCameraError(null);

      // Clean up previous stream before opening new one
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      stopMicMeter();

      try {
        // On desktop macOS, built-in FaceTime cameras do not report facingMode: "user".
        // Use deviceId if explicitly selected, otherwise request standard ideal 1280x720.
        const videoConstraints: MediaTrackConstraints = targetCamId
          ? { deviceId: { exact: targetCamId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } };

        // Build audio constraints — request audio in the SAME getUserMedia call so WebKit
        // grants permission visibility for audioinput devices before enumerateDevices().
        const audioConstraints: boolean | MediaTrackConstraints = effectiveMicEnabled
          ? validMicId
            ? { deviceId: { ideal: validMicId } }
            : true
          : false;

        // 1. Acquire video+audio together (ensures WebKit unlocks both device types
        //    for enumerateDevices and avoids separate CoreAudio session contention)
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: audioConstraints,
          });
        } catch (initialErr) {
          console.warn("[CameraModal] Combined video+audio request failed, trying video-only:", initialErr);
          // Fallback: video-only if the combined request fails (e.g. mic hardware error)
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: videoConstraints,
            });
          } catch (videoErr) {
            console.warn("[CameraModal] Targeted camera request failed, retrying with video: true:", videoErr);
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
            });
          }
        }

        console.log("%c✅ [CameraDebug] Video getUserMedia SUCCEEDED!", "color: #22c55e; font-weight: bold;", {
          streamId: stream.id,
          active: stream.active,
          videoTracks: stream.getVideoTracks().length,
          audioTracks: stream.getAudioTracks().length,
        });

        stream.getVideoTracks().forEach((track, i) => {
          console.log(`%c🎥 [CameraDebug] VideoTrack[${i}]:`, "color: #38bdf8;", {
            label: track.label,
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            settings: track.getSettings(),
            constraints: track.getConstraints(),
          });
          track.onmute = () => console.warn(`⚠️ [CameraDebug] VideoTrack[${i}] MUTED by system!`);
          track.onunmute = () => console.log(`✅ [CameraDebug] VideoTrack[${i}] UNMUTED by system.`);
          track.onended = () => console.warn(`❌ [CameraDebug] VideoTrack[${i}] ENDED!`);
        });

        stream.getAudioTracks().forEach((track, i) => {
          console.log(`%c🎤 [CameraDebug] AudioTrack[${i}]:`, "color: #a855f7;", {
            label: track.label,
            id: track.id,
            enabled: track.enabled,
            readyState: track.readyState,
            settings: track.getSettings(),
          });
          track.onended = () => {
            if (streamRef.current?.getAudioTracks().includes(track)) {
              console.warn(`❌ [CameraDebug] AudioTrack[${i}] ended unexpectedly!`);
            }
          };
        });

        // 2. Now that permissions are active in WebKit for BOTH video and audio,
        //    enumerate devices with full labels and IDs
        const [cams, mics] = await Promise.all([
          service.enumerateCameras(),
          service.enumerateMics(),
        ]);
        console.log("%c🎥 [CameraDebug] Enumerated devices:", "color: #94a3b8;", {
          cameras: cams.map((c) => ({ id: c.deviceId, label: c.label })),
          mics: mics.map((m) => ({ id: m.deviceId, label: m.label })),
        });
        setAvailableCameras(cams);
        setAvailableMics(mics);

        // Record running camera ID
        const runningCamTrack = stream.getVideoTracks()[0];
        const runningCamId = runningCamTrack?.getSettings?.()?.deviceId || cams[0]?.deviceId || null;
        if (!storeState.selectedCameraDeviceId && runningCamId) {
          setSelectedCameraDeviceId(runningCamId);
        }

        // 3. If mic is enabled but the initial combined request didn't yield an audio track
        //    (e.g. combined request failed and we fell back to video-only), try binding the
        //    best hardware mic explicitly
        if (effectiveMicEnabled && stream.getAudioTracks().length === 0 && mics.length > 0) {
          const chosenMic =
            (validMicId && mics.find((m) => m.deviceId === validMicId)) ||
            mics.find((m) => /macbook|built-in|internal/i.test(m.label)) ||
            mics[0];

          if (chosenMic) {
            console.log("%c🎤 [CameraDebug] Binding hardware mic (fallback):", "color: #f59e0b; font-weight: bold;", chosenMic);
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: chosenMic.deviceId } },
              });
              const audioTrack = audioStream.getAudioTracks()[0];
              if (audioTrack) {
                stream.addTrack(audioTrack);
                setSelectedMicDeviceId(chosenMic.deviceId);
              }
            } catch (micErr) {
              console.warn("⚠️ [CameraDebug] Fallback mic binding failed:", micErr);
            }
          }
        } else if (effectiveMicEnabled && stream.getAudioTracks().length > 0) {
          // If no specific mic was requested and the default acquired track is a virtual device (e.g. QuickTime),
          // automatically switch to the real hardware mic (e.g. MacBook Pro Microphone).
          let audioTrack = stream.getAudioTracks()[0];
          const isVirtual = /quicktime|blackhole|loopback|virtual/i.test(audioTrack.label);
          const hardwareMic = mics.find((m) => /macbook|built-in|internal/i.test(m.label));
          if (!validMicId && isVirtual && hardwareMic) {
            console.log("🎤 [CameraDebug] Switching from virtual sink to hardware mic:", hardwareMic);
            try {
              const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: hardwareMic.deviceId } },
              });
              const newTrack = audioStream.getAudioTracks()[0];
              if (newTrack) {
                audioTrack.onended = null;
                stream.removeTrack(audioTrack);
                audioTrack.stop();
                stream.addTrack(newTrack);
                audioTrack = newTrack;
              }
            } catch (switchErr) {
              console.warn("Failed to switch to hardware mic:", switchErr);
            }
          }

          const audioDeviceId = audioTrack?.getSettings?.()?.deviceId || hardwareMic?.deviceId;
          if (audioDeviceId) {
            setSelectedMicDeviceId(audioDeviceId);
          }
          console.log("%c✅ [CameraDebug] Audio track ready:", "color: #22c55e;", {
            label: audioTrack.label,
            id: audioTrack.id,
            deviceId: audioDeviceId,
          });
        }

        streamRef.current = stream;

        // Attach direct video stream to element
        attachStreamToVideo(stream);

        // Start mic meter from the same stream
        if (effectiveMicEnabled && stream.getAudioTracks().length > 0) {
          startMicMeter(stream);
        }

        setPreviewState("live");
      } catch (err: any) {
        console.error("❌ [CameraModal] startCameraPreview failed:", err);
        const msg =
          typeof err === "string"
            ? err
            : err?.message || "Camera access failed. Check macOS System Settings → Privacy & Security.";
        setCameraError(msg);
        setPreviewState("error");
      } finally {
        isAcquiringStreamRef.current = false;
      }
    },
    [
      setPreviewState,
      setCameraError,
      setAvailableCameras,
      setAvailableMics,
      setSelectedCameraDeviceId,
      setSelectedMicDeviceId,
      service,
      startMicMeter,
      stopMicMeter,
      attachStreamToVideo,
    ],
  );

  // ── Permission pre-check & auto-start on modal open ─────────────────────────

  useEffect(() => {
    if (!cameraModalOpen) {
      hasInitializedModalRef.current = false;
      teardown();
      return;
    }

    if (hasInitializedModalRef.current) {
      return;
    }
    hasInitializedModalRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        // Log diagnostics on Rust native backend & WebKit console
        const diag = await invoke<any>("log_system_media_diagnostics");
        console.log(
          "%c🦀 [RustDiagnostics] System Media Diagnostics:",
          "color: #f97316; font-weight: bold;",
          diag,
        );
      } catch (diagErr) {
        console.warn("🦀 [RustDiagnostics] log_system_media_diagnostics call:", diagErr);
      }

      try {
        const permStatus = await invoke<{
          status: string;
          can_request: boolean;
          message: string;
        }>("check_camera_permission");
        console.log("%c🎥 [CameraDebug] check_camera_permission result:", "color: #38bdf8; font-weight: bold;", permStatus);

        if (cancelled) return;

        if (permStatus.status === "denied" || permStatus.status === "restricted") {
          setCameraError(permStatus.message);
          setPreviewState("error");
          return;
        }
      } catch (permErr) {
        console.warn("🎥 [CameraDebug] check_camera_permission error/fallback:", permErr);
      }

      if (!cancelled) {
        await startCameraPreview();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cameraModalOpen, teardown, startCameraPreview, setCameraError, setPreviewState]);

  // ── Recording timer ─────────────────────────────────────────────────────────

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
  }, [isRecording, setRecordingSeconds]);

  // ── Switch Camera ───────────────────────────────────────────────────────────

  const handleSwitchCamera = useCallback(
    async (deviceId: string) => {
      setSelectedCameraDeviceId(deviceId);
      setCameraDropdownOpen(false);
      await startCameraPreview(deviceId, selectedMicDeviceId);
    },
    [setSelectedCameraDeviceId, startCameraPreview, selectedMicDeviceId],
  );

  const handleFlipCamera = useCallback(() => {
    if (availableCameras.length < 2) return;
    const idx = availableCameras.findIndex(
      (c) => c.deviceId === selectedCameraDeviceId,
    );
    const next = availableCameras[(idx + 1) % availableCameras.length];
    if (next) {
      handleSwitchCamera(next.deviceId);
    }
  }, [availableCameras, selectedCameraDeviceId, handleSwitchCamera]);

  // ── Mic Toggle ──────────────────────────────────────────────────────────────

  const handleToggleMic = useCallback(() => {
    const nextState = !micEnabled;
    setMicEnabled(nextState);

    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = nextState;
      }
      if (!nextState) {
        stopMicMeter();
      } else if (audioTrack) {
        startMicMeter(streamRef.current);
      } else {
        startCameraPreview(selectedCameraDeviceId, selectedMicDeviceId);
      }
    }
  }, [
    micEnabled,
    setMicEnabled,
    stopMicMeter,
    startMicMeter,
    startCameraPreview,
    selectedCameraDeviceId,
    selectedMicDeviceId,
  ]);

  // ── Record / Stop ───────────────────────────────────────────────────────────

  const handleStartRecording = useCallback(async () => {
    if (previewState !== "live" || !streamRef.current) return;
    try {
      setCameraError(null);
      setRecordingSeconds(0);

      await service.startRecording(streamRef.current, {
        deviceId: selectedCameraDeviceId ?? undefined,
        audioDeviceId: micEnabled
          ? (selectedMicDeviceId ?? undefined)
          : undefined,
        aspectRatio: selectedAspectRatio,
        audio: micEnabled,
      });

      setIsRecording(true);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Could not start recording";
      setCameraError(msg);
    }
  }, [
    previewState,
    service,
    selectedCameraDeviceId,
    selectedMicDeviceId,
    selectedAspectRatio,
    micEnabled,
    setCameraError,
    setRecordingSeconds,
    setIsRecording,
  ]);

  const handleStopRecording = useCallback(async () => {
    if (!service.isRecording() || isStopping) return;
    setIsStopping(true);
    try {
      const filePath = await service.stopRecording(selectedAspectRatio);
      setIsRecording(false);
      teardown();
      service.cleanup();
      resetSession();
      closeCameraModal();
      onRecordingComplete(filePath, selectedAspectRatio);
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "Failed to save recording";
      setCameraError(msg);
      setIsRecording(false);
      setIsStopping(false);
    }
  }, [
    isStopping,
    service,
    selectedAspectRatio,
    setIsRecording,
    teardown,
    resetSession,
    closeCameraModal,
    onRecordingComplete,
    setCameraError,
  ]);

  // ── Close ───────────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (isRecording) return;
    teardown();
    service.cleanup();
    resetSession();
    closeCameraModal();
  }, [isRecording, teardown, service, resetSession, closeCameraModal]);

  if (!cameraModalOpen) return null;

  const currentRatio =
    RATIO_OPTIONS.find((r) => r.value === selectedAspectRatio) ??
    RATIO_OPTIONS[0];
  const currentCamera = availableCameras.find(
    (c) => c.deviceId === selectedCameraDeviceId,
  );
  const currentMic = availableMics.find(
    (m) => m.deviceId === selectedMicDeviceId,
  );
  const isLive = previewState === "live";
  const isInitializing = previewState === "initializing";

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
        {/* ── Aspect ratio selector ─────────────────────────────────────── */}
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

        {/* ── Viewfinder Container (Smoothly framed to selected aspect ratio) ── */}
        <div
          className="relative overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl transition-[aspect-ratio] duration-300"
          style={{
            aspectRatio: currentRatio.css,
            maxHeight: "55vh",
            width: "auto",
            minWidth: "240px",
          }}
        >
          {/* Mirrored container for selfie camera */}
          <div className="absolute inset-0 w-full h-full scale-x-[-1] overflow-hidden">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={(e) => {
                const vid = e.currentTarget;
                console.log("%c🎥 [CameraDebug] onLoadedMetadata event on <video>:", "color: #38bdf8; font-weight: bold;", {
                  videoWidth: vid.videoWidth,
                  videoHeight: vid.videoHeight,
                  readyState: vid.readyState,
                });
                vid.play().catch((err) => {
                  console.warn("🎥 [CameraDebug] onLoadedMetadata play() failed:", err);
                });
                setPreviewState("live");
              }}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Loading / Error / Retry Overlay */}
          {!isRecording && !isLive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-4">
              {isInitializing ? (
                <>
                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span className="text-white/70 text-sm">
                    Starting camera…
                  </span>
                </>
              ) : previewState === "error" ? (
                <>
                  <Camera className="w-10 h-10 text-white/30" />
                  <span className="text-white/70 text-sm text-center max-w-[260px] leading-relaxed">
                    {cameraError ?? "Camera unavailable"}
                  </span>
                  <div className="flex flex-col items-center gap-2 mt-2">
                    <button
                      onClick={() => {
                        invoke("open_camera_privacy_settings").catch(() => {});
                      }}
                      className="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Open System Settings →
                    </button>
                    <button
                      onClick={() => startCameraPreview()}
                      className="text-white/50 hover:text-white text-xs underline cursor-pointer mt-1"
                    >
                      Tap to retry
                    </button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => startCameraPreview()}
                  className="flex flex-col items-center gap-3 cursor-pointer group"
                >
                  <div className="w-16 h-16 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center group-hover:bg-white/20 transition-colors">
                    <Camera className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-white/70 text-sm group-hover:text-white transition-colors">
                    Tap to enable camera
                  </span>
                </button>
              )}
            </div>
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

          {/* Aspect ratio badge */}
          {!isRecording && isLive && (
            <div className="absolute top-4 right-4 px-2 py-1 rounded-lg bg-black/60 backdrop-blur-sm text-white/70 text-[11px] font-semibold border border-white/10">
              {selectedAspectRatio}
            </div>
          )}

          {/* Sensor Covered Warning Banner */}
          {sensorCoveredWarning && isLive && !isRecording && (
            <div className="absolute bottom-4 left-3 right-3 z-20 px-3 py-2 rounded-xl bg-amber-500/90 text-white text-xs text-center backdrop-blur-md shadow-xl border border-amber-400/50 flex items-center justify-center gap-2 animate-in fade-in">
              <span>⚠️ Camera sensor is receiving no light. Please check if your MacBook webcam cover / privacy slider is closed.</span>
            </div>
          )}
        </div>

        {/* ── Controls Row ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-5">
          {/* Mic toggle */}
          {!isRecording && (
            <button
              onClick={handleToggleMic}
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

          {/* Record / Stop button */}
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
              disabled={!isLive}
              className="w-20 h-20 rounded-full bg-red-500 hover:bg-red-400 border-4 border-white flex items-center justify-center shadow-2xl shadow-red-500/40 transition-all cursor-pointer active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title={isLive ? "Start recording" : "Camera not ready"}
            >
              <Circle className="w-7 h-7 fill-white text-white" />
            </button>
          )}

          {/* Flip camera */}
          {!isRecording && (
            <button
              onClick={handleFlipCamera}
              disabled={availableCameras.length < 2}
              className="p-3 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Switch camera"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* ── Mic level bar ─────────────────────────────────────────────── */}
        {micEnabled && !isRecording && isLive && (
          <div className="w-full max-w-xs h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              ref={micBarRef}
              className="h-full bg-green-400 rounded-full transition-[width] duration-75"
              style={{ width: "0%" }}
            />
          </div>
        )}

        {/* ── Device pickers ────────────────────────────────────────────── */}
        {!isRecording && isLive && (
          <div className="flex items-center gap-3 text-xs text-white/50">
            {/* Camera picker */}
            {availableCameras.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (availableCameras.length > 1) {
                      setCameraDropdownOpen((o) => !o);
                      setMicDropdownOpen(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 border border-white/10 transition-colors text-white/70 ${
                    availableCameras.length > 1 ? "hover:bg-white/12 cursor-pointer" : "cursor-default"
                  }`}
                >
                  <Camera className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">
                    {currentCamera?.label ?? availableCameras[0]?.label ?? "Camera"}
                  </span>
                  {availableCameras.length > 1 && <ChevronDown className="w-3 h-3 opacity-60" />}
                </button>
                {availableCameras.length > 1 && cameraDropdownOpen && (
                  <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[180px] rounded-xl border border-white/10 bg-[#1a1a1e] py-1 shadow-2xl">
                    {availableCameras.map((cam) => (
                      <button
                        key={cam.deviceId}
                        onClick={() => handleSwitchCamera(cam.deviceId)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/8 transition-colors cursor-pointer"
                      >
                        <Check
                          className={`w-3 h-3 shrink-0 ${
                            selectedCameraDeviceId === cam.deviceId
                              ? "opacity-100 text-white"
                              : "opacity-0"
                          }`}
                        />
                        <span className="truncate">{cam.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Mic picker */}
            {micEnabled && availableMics.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => {
                    if (availableMics.length > 1) {
                      setMicDropdownOpen((o) => !o);
                      setCameraDropdownOpen(false);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/8 border border-white/10 transition-colors text-white/70 ${
                    availableMics.length > 1 ? "hover:bg-white/12 cursor-pointer" : "cursor-default"
                  }`}
                >
                  <Mic className="w-3 h-3" />
                  <span className="max-w-[120px] truncate">
                    {currentMic?.label ?? availableMics[0]?.label ?? "Microphone"}
                  </span>
                  {availableMics.length > 1 && <ChevronDown className="w-3 h-3 opacity-60" />}
                </button>
                {availableMics.length > 1 && micDropdownOpen && (
                  <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[180px] rounded-xl border border-white/10 bg-[#1a1a1e] py-1 shadow-2xl">
                    {availableMics.map((mic) => (
                      <button
                        key={mic.deviceId}
                        onClick={() => {
                          setSelectedMicDeviceId(mic.deviceId);
                          setMicDropdownOpen(false);
                          startCameraPreview(selectedCameraDeviceId, mic.deviceId);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-white/80 hover:bg-white/8 transition-colors cursor-pointer"
                      >
                        <Check
                          className={`w-3 h-3 shrink-0 ${
                            selectedMicDeviceId === mic.deviceId
                              ? "opacity-100 text-white"
                              : "opacity-0"
                          }`}
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
