import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioPreviewSyncEngine, type ManagedAudioTrackElement, type AudioSyncState } from "../AudioPreviewSyncEngine";
import type { Clip, Track } from "@/types";

describe("AudioPreviewSyncEngine — Unit Tests", () => {
  let engine: AudioPreviewSyncEngine;

  beforeEach(() => {
    engine = new AudioPreviewSyncEngine();
  });

  const createMockAudioElement = (): HTMLAudioElement => {
    const el = {
      currentTime: 0,
      paused: true,
      muted: false,
      volume: 1,
      playbackRate: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    } as unknown as HTMLAudioElement;
    return el;
  };

  it("executes instant seek on HTMLAudioElement without delay", () => {
    const audioEl = createMockAudioElement();
    const managed: ManagedAudioTrackElement = {
      clipId: "audio-clip-1",
      element: audioEl,
      lastSeekTime: 0,
      lastSeekTimestamp: 0,
      isPrimary: true,
      isMuted: false,
      isPlaying: false,
    };

    engine.executeInstantSeek(managed, 4.25, false);

    expect(audioEl.currentTime).toBe(4.25);
    expect(managed.lastSeekTime).toBe(4.25);
  });

  it("flushes and plays audio when seek occurs during active playback", () => {
    const audioEl = createMockAudioElement();
    const managed: ManagedAudioTrackElement = {
      clipId: "audio-clip-1",
      element: audioEl,
      lastSeekTime: 0,
      lastSeekTimestamp: 0,
      isPrimary: true,
      isMuted: false,
      isPlaying: true,
    };

    engine.executeInstantSeek(managed, 10.0, true);

    expect(audioEl.currentTime).toBe(10.0);
    expect(audioEl.play).toHaveBeenCalled();
  });

  it("calculates track and clip combined volume correctly", () => {
    const audioEl = createMockAudioElement();
    const managedMap = new Map<string, ManagedAudioTrackElement>([
      [
        "c1",
        {
          clipId: "c1",
          element: audioEl,
          lastSeekTime: 0,
          lastSeekTimestamp: 0,
          isPrimary: true,
          isMuted: false,
          isPlaying: false,
        },
      ],
    ]);

    const clips: Clip[] = [
      {
        id: "c1",
        trackId: "t1",
        mediaId: "m1",
        name: "Audio",
        kind: "audio",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        volume: 0.8,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 1,
        rotation: 0,
      },
    ];

    const tracks: Track[] = [
      {
        id: "t1",
        name: "Audio Track",
        type: "audio",
        muted: false,
        locked: false,
        visible: true,
        height: 52,
        volume: 0.5,
      },
    ];

    const syncState: AudioSyncState = {
      time: 2.0,
      isPlaying: false,
      isScrubbing: false,
      volume: 100, // global 100%
      muted: false,
      speed: 1.0,
      frameRate: 30,
    };

    engine.reconcileAudioTracks(managedMap, clips, tracks, syncState);

    // Combined volume = 1.0 * 0.8 * 0.5 = 0.4
    expect(audioEl.volume).toBeCloseTo(0.4);
    expect(audioEl.muted).toBe(false);
  });

  it("mutes audio element if track is muted", () => {
    const audioEl = createMockAudioElement();
    const managedMap = new Map<string, ManagedAudioTrackElement>([
      [
        "c1",
        {
          clipId: "c1",
          element: audioEl,
          lastSeekTime: 0,
          lastSeekTimestamp: 0,
          isPrimary: true,
          isMuted: false,
          isPlaying: false,
        },
      ],
    ]);

    const clips: Clip[] = [
      {
        id: "c1",
        trackId: "t1",
        mediaId: "m1",
        name: "Audio",
        kind: "audio",
        startTime: 0,
        duration: 10,
        trimIn: 0,
        trimOut: 10,
        volume: 1.0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        opacity: 1,
        rotation: 0,
      },
    ];

    const tracks: Track[] = [
      {
        id: "t1",
        name: "Audio Track",
        type: "audio",
        muted: true, // Track Muted!
        locked: false,
        visible: true,
        height: 52,
      },
    ];

    const syncState: AudioSyncState = {
      time: 2.0,
      isPlaying: false,
      isScrubbing: false,
      volume: 100,
      muted: false,
      speed: 1.0,
      frameRate: 30,
    };

    engine.reconcileAudioTracks(managedMap, clips, tracks, syncState);

    expect(audioEl.muted).toBe(true);
    expect(audioEl.volume).toBe(0);
  });
});
