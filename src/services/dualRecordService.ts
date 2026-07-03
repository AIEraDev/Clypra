import { platform } from "@/core/platform";

export interface DualRecordOptions {
  audio: boolean;
  webcam: boolean;
  screen: boolean;
  /** Optional specific audio input device id (from enumerateAudioDevices) */
  audioDeviceId?: string;
  /** Optional screen capture surface preference */
  screenType?: "entire" | "window";
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

  private isRecordingActive = false;
  private isPreviewActive = false;

  /** Callback for external stop events (track ended, recorder error) */
  private onRecordingStopped: RecordingStoppedCallback | null = null;

  // Microphone testing
  private micTestStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micLevelBuffer: Uint8Array | null = null;
  private isMicTestActive = false;

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
        this.webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: audioConstraints,
        });
        this.isPreviewActive = true;
        return { stream: this.webcamStream };
      } catch (err1) {
        console.warn("[DualRecordService] Camera request with ideal constraints failed, retrying with video: true...", err1);
        // Retry with simple video: true constraint for maximum WebKit / macOS AVVideoCaptureSource compatibility
        try {
          this.webcamStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: audioConstraints,
          });
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
              this.webcamStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: audioConstraints,
              });
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
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: audioConstraints,
      });
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

    try {
      // 1. Screen stream capture
      if (options.screen && !this.screenStream) {
        const videoConstraints: any = {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
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
              video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
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
                this.webcamStream = await navigator.mediaDevices.getUserMedia({
                  video: false,
                  audio: options.audioDeviceId
                    ? { deviceId: { exact: options.audioDeviceId } }
                    : true,
                });
              } else {
                throw err2;
              }
            }
          }
        } else if (options.audio) {
          this.webcamStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: options.audioDeviceId
              ? { deviceId: { exact: options.audioDeviceId } }
              : true,
          });
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
            combinedTracks.push(micAudioTracks[0]);
            console.log("[DualRecordService] Injecting mic audio track into screen recorder.");
          }
        }
        const screenRecordStream = new MediaStream(combinedTracks);

        this.screenRecorder = new MediaRecorder(
          screenRecordStream,
          selectedMime ? { mimeType: selectedMime } : undefined
        );
        this.screenRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) this.screenChunks.push(e.data);
        };
        this.screenRecorder.onerror = (e) => {
          console.error("[DualRecordService] Screen MediaRecorder error:", e);
          if (this.isRecordingActive) {
            this.onRecordingStopped?.("recorder_error", "Screen recorder encountered an error");
          }
        };
        this.screenRecorder.start(250);
      }

      // 4. Webcam recorder
      if (this.webcamStream && (options.webcam || options.audio)) {
        this.webcamRecorder = new MediaRecorder(
          this.webcamStream,
          selectedMime ? { mimeType: selectedMime } : undefined
        );
        this.webcamRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) this.webcamChunks.push(e.data);
        };
        this.webcamRecorder.onerror = (e) => {
          console.error("[DualRecordService] Webcam MediaRecorder error:", e);
          if (this.isRecordingActive) {
            this.onRecordingStopped?.("recorder_error", "Camera recorder encountered an error");
          }
        };
        this.webcamRecorder.start(250);
      }

      this.isRecordingActive = true;
    } catch (err) {
      this.cleanup();
      throw err;
    }
  }

  /** Stop recording and save screen and webcam as separate files. Returns file paths. */
  async stopRecording(): Promise<{ filePaths: string[] }> {
    if (!this.isRecordingActive) {
      throw new Error("No active recording session");
    }

    try {
      // Pass the chunks array explicitly to avoid fragile identity comparison
      // with `this.screenRecorder` which could be nulled by a concurrent cleanup.
      const stopRecorder = (
        recorder: MediaRecorder | null,
        chunks: Blob[]
      ): Promise<Blob | null> => {
        if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
        return new Promise((resolve) => {
          recorder.onstop = () => {
            const mimeType = recorder.mimeType || "video/webm";
            const blob = new Blob(chunks, { type: mimeType });
            resolve(blob);
          };
          recorder.stop();
        });
      };

      const [screenBlob, webcamBlob] = await Promise.all([
        stopRecorder(this.screenRecorder, this.screenChunks),
        stopRecorder(this.webcamRecorder, this.webcamChunks),
      ]);

      const timestamp = Date.now();
      const filePaths: string[] = [];

      // Save screen recording
      if (screenBlob && screenBlob.size > 0) {
        const mimeType = this.screenRecorder?.mimeType ?? "video/webm";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const fileName = `screen_${timestamp}.${ext}`;
        const arrayBuffer = await screenBlob.arrayBuffer();
        const path = await platform.saveRecording(fileName, new Uint8Array(arrayBuffer));
        filePaths.push(path);
      }

      // Save camera/audio recording
      if (webcamBlob && webcamBlob.size > 0) {
        const mimeType = this.webcamRecorder?.mimeType ?? "video/webm";
        const ext = mimeType.includes("mp4") ? "mp4" : "webm";
        const fileName = `camera_${timestamp}.${ext}`;
        const arrayBuffer = await webcamBlob.arrayBuffer();
        const path = await platform.saveRecording(fileName, new Uint8Array(arrayBuffer));
        filePaths.push(path);
      }

      return { filePaths };
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
    this.onRecordingStopped = null;

    this.stopMicTest();

    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    this.stopWebcamStream();

    this.screenRecorder = null;
    this.webcamRecorder = null;
    // Release recorded blob data to free memory
    this.screenChunks = [];
    this.webcamChunks = [];
  }

}
