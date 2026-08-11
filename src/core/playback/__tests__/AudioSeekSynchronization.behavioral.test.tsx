import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreviewPlaybackScheduler } from "../PreviewPlaybackScheduler";
import type { MediaElementState } from "../PreviewPlaybackScheduler";
import type { Clip, MediaAsset } from "@/types";

describe("AudioSeekSynchronization — Behavioral Integration Test", () => {
  let scheduler: PreviewPlaybackScheduler;

  beforeEach(() => {
    scheduler = new PreviewPlaybackScheduler();
  });

  const mockClip: Clip = {
    id: "clip-audio-1",
    trackId: "track-a1",
    mediaId: "asset-a1",
    name: "Voiceover Track",
    kind: "audio",
    startTime: 0,
    duration: 30,
    trimIn: 0,
    trimOut: 30,
    volume: 1.0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    opacity: 1,
    rotation: 0,
  };

  const mockAsset: MediaAsset = {
    id: "asset-a1",
    name: "voiceover.mp3",
    path: "/media/voiceover.mp3",
    type: "audio",
    duration: 30,
    size: 1024,
  };

  it("issues an immediate seek action when playhead jumps (transport-jump) while paused", () => {
    const mediaStates = new Map<string, MediaElementState>([
      [
        "clip-audio-1",
        {
          clipId: "clip-audio-1",
          mediaId: "asset-a1",
          currentTime: 2.0, // Current position is 2.0s
          paused: true,
          seeking: false,
          readyState: 4,
          playbackRate: 1.0,
          duration: 30,
          lastSeekTimestamp: 0,
          playPromiseInFlight: false,
          autoplayBlocked: false,
          isActive: true,
          isPrimaryAudible: true,
          hasBeenSeeked: true,
        },
      ],
    ]);

    // Playhead jumps to 15.0s while paused
    const actions = scheduler.reconcile(
      { time: 15.0, state: "paused", volume: 100, muted: false, speed: 1.0, frameRate: 30 },
      mediaStates,
      [mockClip],
      [mockAsset],
      0 // active video clip count
    );

    const seekAction = actions.find((a) => a.type === "seek" && a.clipId === "clip-audio-1");
    expect(seekAction).toBeDefined();
    expect(seekAction?.time).toBe(15.0);
    expect(seekAction?.reason).toBe("transport-jump");
  });

  it("issues immediate seek action during timeline scrubbing", () => {
    const mediaStates = new Map<string, MediaElementState>([
      [
        "clip-audio-1",
        {
          clipId: "clip-audio-1",
          mediaId: "asset-a1",
          currentTime: 5.0,
          paused: false,
          seeking: false,
          readyState: 4,
          playbackRate: 1.0,
          duration: 30,
          lastSeekTimestamp: 0,
          playPromiseInFlight: false,
          autoplayBlocked: false,
          isActive: true,
          isPrimaryAudible: true,
          hasBeenSeeked: true,
        },
      ],
    ]);

    // User scrubs from 5.0s to 6.0s (1.0s drift: > 0.3s scrubbing threshold, < 2.0s post-throttling threshold)
    const actions = scheduler.reconcile(
      { time: 6.0, state: "playing", volume: 100, muted: false, speed: 1.0, frameRate: 30 },
      mediaStates,
      [mockClip],
      [mockAsset],
      0
    );

    const seekAction = actions.find((a) => a.type === "seek" && a.clipId === "clip-audio-1");
    expect(seekAction).toBeDefined();
    expect(seekAction?.time).toBe(6.0);
    expect(seekAction?.reason).toBe("scrubbing");
  });
});

