import { platform } from "@/core/platform";

export type RecordingResolution = "720p" | "1080p" | "4k";
export type RecordingFrameRate = 30 | 60;

export interface DualRecordOptions {
  audio: boolean;
  webcam: boolean;
  screen: boolean;
  /** Optional specific audio input device id (from enumerateAudioDevices) */
  audioDeviceId?: string;
  /** Optional screen capture surface preference */
  screenType?: "entire" | "window";
  /** Optional recording resolution preference */
  resolution?: RecordingResolution;
  /** Optional recording frame rate preference */
  frameRate?: RecordingFrameRate;
}

export function getResolutionDimensions(res: RecordingResolution = "1080p"): { width: number; height: number } {
  switch (res) {
    case "720p":
      return { width: 1280, height: 720 };
    case "4k":
      return { width: 3840, height: 2160 };
    case "1080p":
    default:
      return { width: 1920, height: 1080 };
  }
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface VideoDevice {
  deviceId: string;
  label: string;
}

/**
 * Callback fired when recording is stopped externally (e.g. user clicks
 * OS "Stop Sharing", or a MediaRecorder error occurs).
 */
export type RecordingStoppedCallback = (reason: "track_ended" | "recorder_error", error?: string) => void;

export interface RecordingMetadata {
  screenStartPerfTime?: number;
  webcamStartPerfTime?: number;
  cameraOffsetSeconds: number;
}

export class DualRecordService {
  private static instance: DualRecordService | null = null;

  // Recording streams
  private screenStream: MediaStream | null = null;
  private webcamStream: MediaStream | null = null;

  // Separate recorders for screen and camera
  private screenRecorder: MediaRecorder | null = null;
  private webcamRecorder: MediaRecorder | null = null;
  private screenChunks: Blob[] = [];
  private webcamChunks: Blob[] = [];

  // Disk-streamed chunk files
  private screenTempFileName: string | null = null;
  private cameraTempFileName: string | null = null;
  private screenFinalFileName: string | null = null;
  private cameraFinalFileName: string | null = null;

  // High-precision start timestamps
  private screenStartPerfTime: number | null = null;
  private webcamStartPerfTime: number | null = null;

  private isRecordingActive = false;
  private isPreviewActive = false;
  private isPausedState = false;
  private isMicMutedState = false;

  /** Callback for external stop events (track ended, recorder error) */
  private onRecordingStopped: RecordingStoppedCallback | null = null;

  /** Cloned tracks created for injected mic stream to ensure isolated track lifecycles */
  private injectedClonedTracks: MediaStreamTrack[] = [];

  // Microphone testing
  private micTestStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micLevelBuffer: Uint8Array | null = null;
  private isMicTestActive = false;
  private _previewGeneration = 0;

  private constructor() {}

  static getInstance(): DualRecordService {
    if (typeof window !== "undefined") {
      const globalKey = "__DualRecordService_instance__";
      if (!(window as any)[globalKey]) {
        (window as any)[globalKey] = new DualRecordService();
      }
      return (window as any)[globalKey];
    }

    if (!DualRecordService.instance) {
      DualRecordService.instance = new DualRecordService();
    }
    return DualRecordService.instance;
  }

  isRecording(): boolean {
    return this.isRecordingActive;
  }

  isPaused(): boolean {
    return this.isPausedState;
  }

  isMicMuted(): boolean {
    return this.isMicMutedState;
  }

  pauseRecording(): void {
    if (!this.isRecordingActive || this.isPausedState) return;
    if (this.screenRecorder && this.screenRecorder.state === "recording") {
      this.screenRecorder.pause();
    }
    if (this.webcamRecorder && this.webcamRecorder.state === "recording") {
      this.webcamRecorder.pause();
    }
    this.isPausedState = true;
  }

  resumeRecording(): void {
    if (!this.isRecordingActive || !this.isPausedState) return;
    if (this.screenRecorder && this.screenRecorder.state === "paused") {
      this.screenRecorder.resume();
    }
    if (this.webcamRecorder && this.webcamRecorder.state === "paused") {
      this.webcamRecorder.resume();
    }
    this.isPausedState = false;
  }

  setMicMuted(muted: boolean): void {
    this.isMicMutedState = muted;
    if (this.webcamStream) {
      this.webcamStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
    if (this.screenStream) {
      this.screenStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  isMicTesting(): boolean {
    return this.isMicTestActive;
  }

  /**
   * Returns the raw webcam stream — use this for the live preview <video> element.
   */
  getWebcamStream(): MediaStream | null {
    return this.webcamStream;
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  /**
   * Returns true if webcamStream exists and contains at least one active video track.
   */
  hasWebcamVideoTrack(): boolean {
    return !!(this.webcamStream && this.webcamStream.getVideoTracks().length > 0);
  }

  // ─── Device Enumeration ──────────────────────────────────────────────────────

  /**
   * Returns all available audio input devices (built-in, USB, Bluetooth, etc).
   */
  async enumerateAudioDevices(): Promise<AudioDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `Microphone ${i + 1}`,
      }));
  }

  /**
   * Returns all available video input devices (webcams, capture cards, etc).
   */
  async enumerateVideoDevices(): Promise<VideoDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
    } catch {
      return [];
    }
  }

  // ─── Microphone Test ─────────────────────────────────────────────────────────

  /**
   * Start mic level monitoring for a specific device.
   */
  async startMicTest(deviceId?: string): Promise<void> {
    this.stopMicTest();

    // Use the existing webcam/mic preview stream if it exists and has audio
    let stream = this.webcamStream;
    const hasAudio = stream && stream.getAudioTracks().length > 0;

    if (!hasAudio) {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };

      try {
        this.micTestStream = await navigator.mediaDevices.getUserMedia(constraints);
        stream = this.micTestStream;
      } catch (err) {
        console.error("[DualRecordService] Failed to start mic test getUserMedia:", err);
        this.stopMicTest();
        throw err;
      }
    }

    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.micSourceNode = this.audioContext.createMediaStreamSource(stream!);
      this.micSourceNode.connect(this.analyserNode);

      this.micLevelBuffer = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.isMicTestActive = true;
    } catch (err) {
      console.error("[DualRecordService] Failed to start mic test AudioContext setup:", err);
      this.stopMicTest();
      throw err;
    }
  }

  /**
   * Returns current microphone level (amplitude range: 0.0 - 1.0).
   */
  getMicLevel(): number {
    if (!this.isMicTestActive || !this.analyserNode || !this.micLevelBuffer) return 0;
    this.analyserNode.getByteFrequencyData(this.micLevelBuffer);
    let sum = 0;
    for (let i = 0; i < this.micLevelBuffer.length; i++) {
      sum += this.micLevelBuffer[i];
    }
    const average = sum / this.micLevelBuffer.length;
    return Math.min(1.0, average / 128.0);
  }

  /** Stop microphone test and release streams. */
  stopMicTest(): void {
    this.isMicTestActive = false;
    if (this.micSourceNode) {
      this.micSourceNode.disconnect();
      this.micSourceNode = null;
    }
    if (this.analyserNode) {
      this.analyserNode = null;
    }
    if (this.audioContext) {
      if (this.audioContext.state !== "closed") {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }
    if (this.micTestStream) {
      this.micTestStream.getTracks().forEach((t) => t.stop());
      this.micTestStream = null;
    }
    this.micLevelBuffer = null;
  }

  // ─── Camera Preview ──────────────────────────────────────────────────────────

  /**
   * Start preview of the webcam camera and microphone.
   * Gracefully handles missing camera hardware or camera permission rejection by falling back to audio-only if audio is enabled.
   */
  async startPreview(
    options: Pick<DualRecordOptions, "webcam" | "audio">,
    audioDeviceId?: string
  ): Promise<{ stream: MediaStream | null; cameraError?: string }> {
    const currentGeneration = ++this._previewGeneration;

    if (this.isRecordingActive) return { stream: this.webcamStream };

    if (this.webcamStream) {
      this.stopWebcamStream();
    }

    if (!options.webcam && !options.audio) {
      return { stream: null };
    }

    const audioConstraints = options.audio
      ? audioDeviceId
        ? { deviceId: { exact: audioDeviceId } }
        : true
      : false;

    let cameraError: string | undefined;

    // Try combined video + audio first if webcam is requested
    if (options.webcam) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: audioConstraints,
        });
        if (currentGeneration !== this._previewGeneration) {
          stream.getTracks().forEach(t => t.stop());
          return { stream: null };
        }
        this.webcamStream = stream;
        this.isPreviewActive = true;
        return { stream: this.webcamStream };
      } catch (err1) {
        console.warn("[DualRecordService] Camera request with ideal constraints failed, retrying with video: true...", err1);
        // Retry with simple video: true constraint for maximum WebKit / macOS AVVideoCaptureSource compatibility
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: audioConstraints,
          });
          if (currentGeneration !== this._previewGeneration) {
            stream.getTracks().forEach(t => t.stop());
            return { stream: null };
          }
          this.webcamStream = stream;
          this.isPreviewActive = true;
          return { stream: this.webcamStream };
        } catch (err2: any) {
          console.warn("[DualRecordService] Camera request with video: true also failed:", err2);
          const errMessage = err2?.message || String(err2);
          const isCameraMissing =
            err2?.name === "NotFoundError" ||
            err2?.name === "DevicesNotFoundError" ||
            errMessage.includes("No AVVideoCaptureSource") ||
            errMessage.includes("sandbox extension");

          cameraError = isCameraMissing
            ? "No camera hardware detected or permission pending."
            : "Camera access was denied or unavailable.";

          // If audio was also requested, fall back to audio-only so mic test works
          if (options.audio) {
            try {
              const stream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints,
              });
              if (currentGeneration !== this._previewGeneration) {
                stream.getTracks().forEach(t => t.stop());
                return { stream: null, cameraError };
              }
              this.webcamStream = stream;
              this.isPreviewActive = true;
              return { stream: this.webcamStream, cameraError };
            } catch (audioErr) {
              console.error("[DualRecordService] Audio fallback failed:", audioErr);
              this.stopWebcamStream();
              throw new Error("Could not access camera or microphone. Check macOS System Settings → Privacy & Security.");
            }
          } else {
            this.stopWebcamStream();
            throw new Error(cameraError);
          }
        }
      }
    }

    // Audio-only preview
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: audioConstraints,
      });
      if (currentGeneration !== this._previewGeneration) {
        stream.getTracks().forEach(t => t.stop());
        return { stream: null };
      }
      this.webcamStream = stream;
      this.isPreviewActive = true;
      return { stream: this.webcamStream };
    } catch (err) {
      console.error("[DualRecordService] Audio preview failed:", err);
      this.stopWebcamStream();
      throw new Error("Could not access microphone. Check system permissions.");
    }
  }

  /** Stop preview camera. */
  stopPreview(): void {
    if (!this.isRecordingActive) {
      this.stopWebcamStream();
      this.isPreviewActive = false;
    }
  }

  /**
   * Start preview of the screen share.
   */
  async startScreenPreview(screenType?: "entire" | "window"): Promise<MediaStream> {
    if (this.screenStream) return this.screenStream;

    const videoConstraints: any = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    };
    if (screenType === "entire") {
      videoConstraints.displaySurface = "monitor";
    } else if (screenType === "window") {
      videoConstraints.displaySurface = "window";
    }

    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: false,
      });
      return this.screenStream;
    } catch (err) {
      console.error("[DualRecordService] startScreenPreview failed:", err);
      this.stopScreenPreview();
      throw err;
    }
  }

  /** Stop preview of the screen share. */
  stopScreenPreview(): void {
    if (!this.isRecordingActive && this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
  }

  // ─── Recording ───────────────────────────────────────────────────────────────

  /**
   * Start recording. Records screen and camera to separate files.
   *
   * @param options        Recording source options
   * @param onStopped      Optional callback fired if recording stops externally
   *                        (e.g. user clicks OS "Stop Sharing", or MediaRecorder error)
   */
  async startRecording(
    options: DualRecordOptions,
    onStopped?: RecordingStoppedCallback
  ): Promise<void> {
    if (this.isRecordingActive) throw new Error("Recording already in progress");

    // Validate: at least one source must be enabled
    if (!options.screen && !options.webcam && !options.audio) {
      throw new Error("At least one recording source must be enabled (screen, webcam, or audio)");
    }

    this.onRecordingStopped = onStopped ?? null;

    this.stopMicTest();
    this.stopWebcamStream(); // Stop webcam preview to get a fresh recording stream
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }

    this.screenChunks = [];
    this.webcamChunks = [];

    const mimePreference = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    const selectedMime = mimePreference.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

    const timestamp = Date.now();
    const ext = selectedMime.includes("mp4") ? "mp4" : "webm";
    this.screenTempFileName = options.screen ? `screen_temp_${timestamp}.part` : null;
    this.cameraTempFileName = (options.webcam || (options.audio && !options.screen)) ? `camera_temp_${timestamp}.part` : null;
    this.screenFinalFileName = options.screen ? `screen_${timestamp}.${ext}` : null;
    this.cameraFinalFileName = (options.webcam || (options.audio && !options.screen)) ? `camera_${timestamp}.${ext}` : null;

    try {
      const targetDims = getResolutionDimensions(options.resolution);
      const targetFps = options.frameRate ?? 30;

      // 1. Screen stream capture
      if (options.screen && !this.screenStream) {
        try {
          const videoConstraints: any = {
            width: { ideal: targetDims.width },
            height: { ideal: targetDims.height },
            frameRate: { ideal: targetFps },
          };
          if (options.screenType === "entire") {
            videoConstraints.displaySurface = "monitor";
          } else if (options.screenType === "window") {
            videoConstraints.displaySurface = "window";
          }

          this.screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: false, // Mic audio is added from webcamStream below
          });
        } catch (displayErr) {
          console.warn("[DualRecordService] getDisplayMedia with constraints failed, retrying with video: true...", displayErr);
          this.screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
        }

        // Listen for the OS "Stop Sharing" event on the screen video track.
        const screenVideoTrack = this.screenStream.getVideoTracks()[0];
        if (screenVideoTrack) {
          screenVideoTrack.addEventListener("ended", () => {
            console.warn("[DualRecordService] Screen track ended externally (user stopped sharing)");
            if (this.isRecordingActive) {
              this.onRecordingStopped?.("track_ended", "Screen sharing was stopped");
            }
          });
        }
      }

      // 2. Webcam + mic stream — acquire BEFORE building screen recorder so we
      //    can inject the mic audio track into the screen recording as well.
      if ((options.webcam || options.audio) && !this.webcamStream) {
        if (options.webcam) {
          try {
            this.webcamStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: Math.min(1920, targetDims.width) }, height: { ideal: Math.min(1080, targetDims.height) }, frameRate: { ideal: targetFps } },
              audio: options.audio
                ? options.audioDeviceId
                  ? { deviceId: { exact: options.audioDeviceId } }
                  : true
                : false,
            });
          } catch (err1) {
            console.warn("[DualRecordService] Camera start failed with ideal constraints, retrying with video: true...", err1);
            try {
              this.webcamStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: options.audio
                  ? options.audioDeviceId
                    ? { deviceId: { exact: options.audioDeviceId } }
                    : true
                  : false,
              });
            } catch (err2) {
              console.warn("[DualRecordService] Camera start failed with video: true, falling back to audio-only:", err2);
              if (options.audio) {
                try {
                  this.webcamStream = await navigator.mediaDevices.getUserMedia({
                    video: false,
                    audio: options.audioDeviceId
                      ? { deviceId: { exact: options.audioDeviceId } }
                      : true,
                  });
                } catch (audioErr) {
                  console.warn("[DualRecordService] Camera and audio acquisition both failed:", audioErr);
                  if (!options.screen) throw audioErr;
                }
              } else {
                console.warn("[DualRecordService] Camera acquisition failed:", err2);
                if (!options.screen) throw err2;
              }
            }
          }
        } else if (options.audio) {
          try {
            this.webcamStream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: options.audioDeviceId
                ? { deviceId: { exact: options.audioDeviceId } }
                : true,
            });
          } catch (audioErr) {
            console.warn("[DualRecordService] Audio acquisition failed:", audioErr);
            if (!options.screen) throw audioErr;
          }
        }
      }

      // 3. Screen recorder — combine screen video + mic audio so the screen
      //    recording file has sound even when webcam is also recording.
      if (this.screenStream && options.screen) {
        // Build a combined stream: screen video track(s) + mic audio track (if available)
        const combinedTracks: MediaStreamTrack[] = [
          ...this.screenStream.getVideoTracks(),
        ];
        if (options.audio && this.webcamStream) {
          const micAudioTracks = this.webcamStream.getAudioTracks();
          if (micAudioTracks.length > 0) {
            const clonedMicTrack = micAudioTracks[0].clone();
            this.injectedClonedTracks.push(clonedMicTrack);
            combinedTracks.push(clonedMicTrack);
            console.log("[DualRecordService] Injecting cloned mic audio track into screen recorder.");
          }
        }
        const screenRecordStream = new MediaStream(combinedTracks);

        this.screenRecorder = new MediaRecorder(
          screenRecordStream,
          selectedMime ? { mimeType: selectedMime } : undefined
        );
        this.screenRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.screenChunks.push(e.data);
          }
        };
        this.screenRecorder.onerror = (e) => {
          console.error("[DualRecordService] Screen MediaRecorder error:", e);
          if (this.isRecordingActive) {
            this.onRecordingStopped?.("recorder_error", "Screen recorder encountered an error");
          }
        };
        this.screenStartPerfTime = performance.now();
        this.screenRecorder.start(250);
      }

      // 4. Webcam recorder
      // REC-03 fix: Only record webcam separately if webcam is enabled, or if audio-only (no screen).
      // When screen+audio (no webcam), mic audio is already injected into the screen recorder.
      if (this.webcamStream && (options.webcam || (options.audio && !options.screen))) {
        this.webcamRecorder = new MediaRecorder(
          this.webcamStream,
          selectedMime ? { mimeType: selectedMime } : undefined
        );
        this.webcamRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.webcamChunks.push(e.data);
          }
        };
        this.webcamRecorder.onerror = (e) => {
          console.error("[DualRecordService] Webcam MediaRecorder error:", e);
          if (this.isRecordingActive) {
            this.onRecordingStopped?.("recorder_error", "Camera recorder encountered an error");
          }
        };
        this.webcamStartPerfTime = performance.now();
        this.webcamRecorder.start(250);
      }

      this.isRecordingActive = true;
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  /** Stop recording and save screen and webcam as separate files. Returns file paths and metadata. */
  async stopRecording(): Promise<{ filePaths: string[]; metadata: RecordingMetadata }> {
    if (!this.isRecordingActive) {
      throw new Error("No active recording session");
    }

    try {
      const stopRecorderInstance = (recorder: MediaRecorder | null): Promise<void> => {
        if (!recorder || recorder.state === "inactive") return Promise.resolve();
        return new Promise((resolve) => {
          let resolved = false;
          const done = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };

          const timeout = setTimeout(() => {
            console.warn("[DualRecordService] MediaRecorder onstop timeout hit, forcing resolution.");
            done();
          }, 1000);

          recorder.onstop = () => {
            clearTimeout(timeout);
            done();
          };

          recorder.onerror = () => {
            clearTimeout(timeout);
            done();
          };

          try {
            if (recorder.state === "recording" || recorder.state === "paused") {
              recorder.requestData();
            }
            recorder.stop();
          } catch (err) {
            console.warn("[DualRecordService] Error requesting data or stopping recorder:", err);
            clearTimeout(timeout);
            done();
          }
        });
      };

      await Promise.all([
        stopRecorderInstance(this.screenRecorder),
        stopRecorderInstance(this.webcamRecorder),
      ]);

      const filePaths: string[] = [];

      // Save Screen Recording
      if (this.screenChunks.length > 0) {
        const mimeType = this.screenRecorder?.mimeType || "video/webm";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const fileName = this.screenFinalFileName || `screen_${Date.now()}.${ext}`;
        const blob = new Blob(this.screenChunks, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength > 0) {
          const path = await platform.saveRecording(fileName, new Uint8Array(arrayBuffer));
          filePaths.push(path);
        }
      }

      // Save Camera Recording
      if (this.webcamChunks.length > 0) {
        const mimeType = this.webcamRecorder?.mimeType || "video/webm";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const fileName = this.cameraFinalFileName || `camera_${Date.now()}.${ext}`;
        const blob = new Blob(this.webcamChunks, { type: mimeType });
        const arrayBuffer = await blob.arrayBuffer();
        if (arrayBuffer.byteLength > 0) {
          const path = await platform.saveRecording(fileName, new Uint8Array(arrayBuffer));
          filePaths.push(path);
        }
      }

      if (filePaths.length === 0) {
        throw new Error("Screen recording ended before video data was captured. Please verify screen capture permissions.");
      }

      let cameraOffsetSeconds = 0;
      if (this.screenStartPerfTime !== null && this.webcamStartPerfTime !== null) {
        const deltaMs = this.webcamStartPerfTime - this.screenStartPerfTime;
        cameraOffsetSeconds = Math.max(0, deltaMs / 1000);
      }

      const metadata: RecordingMetadata = {
        screenStartPerfTime: this.screenStartPerfTime ?? undefined,
        webcamStartPerfTime: this.webcamStartPerfTime ?? undefined,
        cameraOffsetSeconds,
      };

      return { filePaths, metadata };
    } finally {
      this.cleanup();
    }
  }

  private stopWebcamStream(): void {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach((t) => t.stop());
      this.webcamStream = null;
    }
  }

  cleanup(): void {
    this.isRecordingActive = false;
    this.isPreviewActive = false;
    this.isPausedState = false;
    this.isMicMutedState = false;
    this.onRecordingStopped = null;

    this.stopMicTest();

    if (this.injectedClonedTracks.length > 0) {
      this.injectedClonedTracks.forEach((t) => t.stop());
      this.injectedClonedTracks = [];
    }

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.stopWebcamStream();

    this.screenRecorder = null;
    this.webcamRecorder = null;
    this.screenChunks = [];
    this.webcamChunks = [];
    this.screenTempFileName = null;
    this.cameraTempFileName = null;
    this.screenFinalFileName = null;
    this.cameraFinalFileName = null;
    this.screenStartPerfTime = null;
    this.webcamStartPerfTime = null;
  }

}
