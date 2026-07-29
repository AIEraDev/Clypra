import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FloatingWidget } from "../FloatingWidget";
import { DualRecordService } from "@/services/dualRecordService";
import { useRecordingStore } from "@/store/recordingStore";

class MockMediaStream {
  constructor(public tracks: any[] = []) {}
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}
globalThis.MediaStream = MockMediaStream as any;

vi.mock("@/services/dualRecordService", () => {
  const mockService = {
    getWebcamStream: vi.fn(),
    hasWebcamVideoTrack: vi.fn().mockReturnValue(true),
    stopRecording: vi.fn().mockResolvedValue({ filePaths: ["/tmp/screen.webm"] }),
    cleanup: vi.fn(),
  };
  return {
    DualRecordService: {
      getInstance: () => mockService,
    },
  };
});

describe("FloatingWidget", () => {
  const originalPlay = HTMLMediaElement.prototype.play;

  beforeEach(() => {
    vi.clearAllMocks();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    useRecordingStore.setState({
      isRecording: true,
      seconds: 5,
      hasWebcam: true,
      recordingError: null,
      previewRecording: null,
    });
  });

  it("attaches video-only stream to video element without calling track.stop", async () => {
    const mockTrack = { kind: "video", stop: vi.fn() };
    const mockStream = new MockMediaStream([
      mockTrack,
      { kind: "audio", stop: vi.fn() },
    ]);

    (DualRecordService.getInstance().getWebcamStream as any).mockReturnValue(mockStream);

    render(<FloatingWidget onProjectCreate={vi.fn()} />);

    // Fast-forward effect timer / stream attach
    await act(async () => {
      await new Promise((res) => setTimeout(res, 50));
    });

    expect(mockTrack.stop).not.toHaveBeenCalled();
  });

  it("allows stopping capture even when recordingError is present on first click", async () => {
    useRecordingStore.setState({ recordingError: "Screen track ended" });

    render(<FloatingWidget onProjectCreate={vi.fn()} />);

    const stopButton = screen.getByRole("button", { name: /Stop/i });
    expect(stopButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(stopButton);
    });

    expect(DualRecordService.getInstance().stopRecording).toHaveBeenCalledTimes(1);
    expect(useRecordingStore.getState().isRecording).toBe(false);
    expect(useRecordingStore.getState().recordingError).toBeNull();
  });
});
