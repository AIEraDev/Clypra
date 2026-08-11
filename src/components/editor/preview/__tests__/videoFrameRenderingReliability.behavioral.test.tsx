import { describe, it, expect, vi } from "vitest";
import { VideoTextureManager } from "@/core/render/VideoTextureManager";

describe("Video Frame Rendering & 2D Canvas Clearing — Reliability Tests", () => {
  it("guarantees HTMLVideoElement texture dirty flag resets correctly upon video frame arrival", () => {
    const manager = new VideoTextureManager(false); // Fallback mode for JSDOM
    const mockVideo = document.createElement("video");

    Object.defineProperty(mockVideo, "currentTime", { value: 2.5, writable: true });
    Object.defineProperty(mockVideo, "readyState", { value: 4, writable: true });

    manager.attachVideo("clip-video-1", mockVideo);

    // Initial state: currentTime is 2.5s
    mockVideo.currentTime = 2.5;

    // When currentTime changes to 5.0s (seek/play), shouldUpdate returns true
    mockVideo.currentTime = 5.0;
    expect(manager.shouldUpdate("clip-video-1", mockVideo)).toBe(true);

    // After updating, latestMediaTime matches currentTime
    expect(manager.shouldUpdate("clip-video-1", mockVideo)).toBe(false);

    // Scrubbing to 10.0s triggers shouldUpdate again
    mockVideo.currentTime = 10.0;
    expect(manager.shouldUpdate("clip-video-1", mockVideo)).toBe(true);
  });
});

