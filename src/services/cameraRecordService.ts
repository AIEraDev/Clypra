/**
 * CameraRecordService — high-performance, safe face camera recording
 *
 * Architecture:
 * - Preview uses a direct WebKit video stream (zero latency, no WKWebView compositing bugs).
 * - Mic VU meter uses Web Audio API on the stream's audio track (no duplicate getUserMedia).
 * - Recording captures via MediaRecorder directly from the active live stream (no restart hitch).
 * - Post-recording processing delegates to Clypra's native Rust FFmpeg backend
 *   (`process_camera_recording`) for instant hardware-accelerated aspect ratio cropping
 *   (9:16, 1:1, 4:3, 16:9), selfie-mirroring (hflip), and clean MP4 faststart export.
 */

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@/core/platform";

export type CameraAspectRatio = "9:16" | "16:9" | "1:1" | "4:3";
export type CameraResolution = "720p" | "1080p" | "4k";
export type CameraFrameRate = 30 | 60;

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface CameraRecordOptions {
  deviceId?: string;
  audioDeviceId?: string;
  aspectRatio: CameraAspectRatio;
  resolution?: CameraResolution;
  frameRate?: CameraFrameRate;
  audio: boolean;
}

export class CameraRecordService {
  private static _instance: CameraRecordService | null = null;

  private _mediaRecorder: MediaRecorder | null = null;
  private _recordedChunks: Blob[] = [];
  private _isRecordingActive = false;
  private _activeStream: MediaStream | null = null;

  private constructor() {}

  static getInstance(): CameraRecordService {
    if (typeof window !== "undefined") {
      const key = "__CameraRecordService__";
      if (!(window as any)[key]) {
        (window as any)[key] = new CameraRecordService();
      }
      return (window as any)[key];
    }
    if (!CameraRecordService._instance) {
      CameraRecordService._instance = new CameraRecordService();
    }
    return CameraRecordService._instance;
  }

  isRecording(): boolean {
    return this._isRecordingActive;
  }

  // ── Device Enumeration ───────────────────────────────────────────────────

  async enumerateCameras(): Promise<CameraDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "videoinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
    } catch (err) {
      console.warn("[CameraRecordService] enumerateCameras failed:", err);
      return [];
    }
  }

  async enumerateMics(): Promise<AudioDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${i + 1}`,
        }));
    } catch (err) {
      console.warn("[CameraRecordService] enumerateMics failed:", err);
      return [];
    }
  }

  // ── Recording ────────────────────────────────────────────────────────────

  /**
   * Start recording from the currently active live preview stream.
   * This avoids closing and reopening the camera hardware, guaranteeing zero startup delay.
   */
  async startRecording(
    stream: MediaStream,
    options: CameraRecordOptions,
  ): Promise<void> {
    if (this._isRecordingActive) {
      throw new Error("Camera recording is already in progress");
    }

    this._activeStream = stream;
    this._recordedChunks = [];

    // Find the best supported recording MIME type
    const mimeCandidates = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType =
      mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";

    const recorderOptions: MediaRecorderOptions = {
      videoBitsPerSecond: 6_000_000, // 6 Mbps for high clarity
    };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }

    const recorder = new MediaRecorder(stream, recorderOptions);

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        this._recordedChunks.push(e.data);
      }
    };

    recorder.start(1000); // chunk every second
    this._mediaRecorder = recorder;
    this._isRecordingActive = true;
  }

  /**
   * Stop the active recording, save raw video to disk, and run native FFmpeg
   * processing to crop to the target aspect ratio and mirror the video.
   */
  async stopRecording(aspectRatio: CameraAspectRatio): Promise<string> {
    const recorder = this._mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      this._isRecordingActive = false;
      throw new Error("No active recording to stop");
    }

    // Wait for recorder to stop and collect remaining data
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        if (recorder.state === "recording") {
          recorder.requestData();
        }
        recorder.stop();
      } catch {
        resolve();
      }
    });

    this._isRecordingActive = false;
    this._mediaRecorder = null;

    if (this._recordedChunks.length === 0) {
      throw new Error("No video data was captured during recording");
    }

    const mimeType = recorder.mimeType || "video/webm";
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const timestamp = Date.now();
    const rawFileName = `raw_cam_${timestamp}.${ext}`;
    const finalFileName = `camera_${timestamp}.mp4`;

    const blob = new Blob(this._recordedChunks, { type: mimeType });
    this._recordedChunks = [];
    const buffer = await blob.arrayBuffer();

    // 1. Save raw capture chunk using platform storage
    const rawPath = await platform.saveRecording(
      rawFileName,
      new Uint8Array(buffer),
    );

    // 2. Resolve destination path for the finalized aspect-ratio cropped MP4
    let finalPath: string;
    try {
      finalPath = await platform.joinPaths(
        await platform.appDataDir(),
        "recordings",
        finalFileName,
      );
    } catch {
      finalPath = rawPath.replace(rawFileName, finalFileName);
    }

    // 3. Native Rust post-processing: center crop to target ratio, mirror horizontally, and export MP4
    try {
      const processedPath = await invoke<string>("process_camera_recording", {
        inputPath: rawPath,
        outputPath: finalPath,
        aspectRatio,
        mirror: true, // front camera natural selfie orientation
      });
      return processedPath;
    } catch (err) {
      console.warn(
        "[CameraRecordService] Native crop processing failed, returning raw file:",
        err,
      );
      return rawPath;
    }
  }

  cleanup(): void {
    if (this._mediaRecorder && this._mediaRecorder.state !== "inactive") {
      try {
        this._mediaRecorder.stop();
      } catch {}
    }
    this._mediaRecorder = null;
    this._recordedChunks = [];
    this._isRecordingActive = false;
    this._activeStream = null;
  }
}
