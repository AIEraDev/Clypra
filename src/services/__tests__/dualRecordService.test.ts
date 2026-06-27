import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DualRecordService } from "../dualRecordService";
import { platform } from "@/core/platform";

// Mock platform saveRecording
vi.mock("@/core/platform", () => {
  return {
    platform: {
      saveRecording: vi.fn().mockResolvedValue("/mock-recordings/rec_123.webm"),
      getMediaMetadata: vi.fn().mockResolvedValue({ duration: 5.0, width: 1920, height: 1080 }),
      extractPosterFrame: vi.fn().mockResolvedValue("data:image/jpeg;base64,mock"),
    },
  };
});

class MockMediaStreamTrack {
  constructor(public kind: string = "video") {}
  stop = vi.fn();
}

class MockMediaStream {
  constructor(public tracks: any[] = []) {}
  getTracks = vi.fn(() => this.tracks);
  getVideoTracks = vi.fn(() => this.tracks.filter((t) => t.kind === "video"));
  getAudioTracks = vi.fn(() => this.tracks.filter((t) => t.kind === "audio"));
}

globalThis.MediaStream = MockMediaStream as any;

class MockMediaRecorder {
  mimeType = "video/webm";
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;

  start = vi.fn();
  stop = vi.fn(() => {
    setTimeout(() => {
      if (this.ondataavailable) {
        this.ondataavailable({ data: new Blob(["chunk"], { type: "video/webm" }) });
      }
      if (this.onstop) {
        this.onstop();
      }
    }, 10);
  });
}

describe("DualRecordService", () => {
  const originalMediaDevices = globalThis.navigator.mediaDevices;
  const originalMediaRecorder = globalThis.MediaRecorder;
  const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;
  const originalPlay = HTMLVideoElement.prototype.play;

  beforeEach(() => {
    if (typeof window !== "undefined") {
      delete (window as any).__DualRecordService_instance__;
    }
    vi.clearAllMocks();
    (DualRecordService.getInstance() as any).cleanup();

    const mockDevices = [
      { kind: "audioinput", deviceId: "mic-1", label: "Internal Microphone" },
      { kind: "audioinput", deviceId: "mic-2", label: "External USB Mic" },
      { kind: "videoinput", deviceId: "cam-1", label: "FaceTime HD Camera" },
    ];

    (globalThis.navigator as any).mediaDevices = {
      getDisplayMedia: vi.fn().mockResolvedValue(new MockMediaStream([new MockMediaStreamTrack("video")])),
      getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream([new MockMediaStreamTrack("video"), new MockMediaStreamTrack("audio")])),
      enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any;

    globalThis.MediaRecorder = MockMediaRecorder as any;
    globalThis.MediaRecorder.isTypeSupported = vi.fn(() => true);

    HTMLCanvasElement.prototype.captureStream = vi.fn(() => new MockMediaStream() as any);
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);

    // Mock AudioContext
    const mockAnalyserNode = {
      fftSize: 256,
      smoothingTimeConstant: 0.6,
      frequencyBinCount: 128,
      connect: vi.fn(),
      disconnect: vi.fn(),
      getByteTimeDomainData: vi.fn((buf: Uint8Array) => {
        // Fill buffer with some variation to test RMS calculation
        for (let i = 0; i < buf.length; i++) {
          buf[i] = i % 2 === 0 ? 138 : 118; // 10 units away from 128 (silence)
        }
      }),
      getByteFrequencyData: vi.fn((buf: Uint8Array) => {
        for (let i = 0; i < buf.length; i++) {
          buf[i] = 64;
        }
      }),
    };
    const mockSourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    class MockAudioContext {
      createAnalyser = vi.fn(() => mockAnalyserNode);
      createMediaStreamSource = vi.fn(() => mockSourceNode);
      close = vi.fn().mockResolvedValue(undefined);
    }
    (globalThis as any).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    (DualRecordService.getInstance() as any).cleanup();
    if (typeof window !== "undefined") {
      delete (window as any).__DualRecordService_instance__;
    }
    (globalThis.navigator as any).mediaDevices = originalMediaDevices;
    globalThis.MediaRecorder = originalMediaRecorder;
    HTMLCanvasElement.prototype.captureStream = originalCaptureStream;
    HTMLVideoElement.prototype.play = originalPlay;
    delete (globalThis as any).AudioContext;
  });

  it("should initialize capture streams and start recording", async () => {
    const service = DualRecordService.getInstance();
    expect(service.isRecording()).toBe(false);

    await service.startRecording({
      screen: true,
      webcam: true,
      audio: true,
    });

    expect(service.isRecording()).toBe(true);
    expect(service.getWebcamStream()).toBeDefined();
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
  });

  it("should stop recording, save chunk outputs, and return file locations", async () => {
    const service = DualRecordService.getInstance();
    await service.startRecording({
      screen: true,
      webcam: true,
      audio: true,
    });

    const result = await service.stopRecording();
    expect(result.filePaths).toHaveLength(2);
    expect(result.filePaths[0]).toBe("/mock-recordings/rec_123.webm");
    expect(result.filePaths[1]).toBe("/mock-recordings/rec_123.webm");
    expect(service.isRecording()).toBe(false);
    expect(platform.saveRecording).toHaveBeenCalledTimes(2);
  });


  it("should enumerate audio devices correctly", async () => {
    const service = DualRecordService.getInstance();
    const devices = await service.enumerateAudioDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({ deviceId: "mic-1", label: "Internal Microphone" });
    expect(devices[1]).toEqual({ deviceId: "mic-2", label: "External USB Mic" });
  });

  it("should manage mic testing lifecycle and read input levels", async () => {
    const service = DualRecordService.getInstance();
    expect(service.isMicTesting()).toBe(false);

    await service.startMicTest("mic-2");
    expect(service.isMicTesting()).toBe(true);

    const level = service.getMicLevel();
    expect(level).toBeGreaterThan(0);

    service.stopMicTest();
    expect(service.isMicTesting()).toBe(false);
    expect(service.getMicLevel()).toBe(0);
  });
});
