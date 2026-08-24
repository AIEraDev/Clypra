import { describe, it, expect } from "vitest";
import { getActiveAudioClips } from "../audioClips";
import type { Clip, Track, MediaAsset } from "@/types";

describe("audioClips — getActiveAudioClips range export fades", () => {
  const mockTrack: Track = {
    id: "track-1",
    name: "Audio 1",
    type: "audio",
    muted: false,
    locked: false,
    visible: true,
    height: 52,
    volume: 1.0,
  };

  const mockAsset: MediaAsset = {
    id: "asset-1",
    name: "song.mp3",
    path: "/media/song.mp3",
    type: "audio",
    duration: 60,
    size: 1024,
  };


  it("should zero out fadeIn when export range starts after the clip's fade-in has finished", () => {
    // Clip starts at t=0, duration 10s, with a 2s fade-in (0s to 2s)
    const clip: Clip = {
      id: "c1",
      trackId: "track-1",
      mediaId: "asset-1",
      name: "Clip 1",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      kind: "audio",
      fadeIn: 2.0,
      fadeOut: 2.0,
    } as any;

    // Export range is t=3.0 to t=8.0 (after the 2.0s fade-in ended)
    const audioConfigs = getActiveAudioClips([clip], [mockTrack], [mockAsset], 3.0, 8.0);

    expect(audioConfigs.length).toBe(1);
    expect(audioConfigs[0].startTime).toBe(0); // 0 relative to export start (3.0)
    expect(audioConfigs[0].duration).toBe(5); // 8 - 3
    // fadeIn should be 0 because 3.0 >= 2.0 (fade-in already finished on timeline)
    expect(audioConfigs[0].fadeIn).toBe(0);
    // fadeOut should be 0 because export ends at 8.0 <= 8.0 (fade-out starts at 8.0 on timeline, i.e. 10 - 2)
    expect(audioConfigs[0].fadeOut).toBe(0);
  });

  it("should correctly compute partial fadeIn when export range overlaps the fade-in period", () => {
    const clip: Clip = {
      id: "c1",
      trackId: "track-1",
      mediaId: "asset-1",
      name: "Clip 1",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      kind: "audio",
      fadeIn: 4.0,
      fadeOut: 0,
    } as any;

    // Export range starts at t=1.0 and ends at t=6.0.
    // The fade-in was originally 0s to 4s.
    // Overlapping fade-in region is t=1.0 to t=4.0 (3.0 seconds duration remaining).
    const audioConfigs = getActiveAudioClips([clip], [mockTrack], [mockAsset], 1.0, 6.0);

    expect(audioConfigs.length).toBe(1);
    expect(audioConfigs[0].fadeIn).toBe(3.0);
  });

  it("should clamp combined fadeIn and fadeOut so they do not exceed relative duration", () => {
    const clip: Clip = {
      id: "c1",
      trackId: "track-1",
      mediaId: "asset-1",
      name: "Clip 1",
      startTime: 0,
      duration: 4,
      trimIn: 0,
      trimOut: 4,
      kind: "audio",
      fadeIn: 3.0,
      fadeOut: 3.0,
    } as any;

    // Full range 0 to 4s. Total clip duration = 4s. fadeIn=3s, fadeOut=3s. Total = 6s > 4s.
    const audioConfigs = getActiveAudioClips([clip], [mockTrack], [mockAsset], 0, 4);

    expect(audioConfigs.length).toBe(1);
    expect(audioConfigs[0].fadeIn + audioConfigs[0].fadeOut).toBeLessThanOrEqual(4);
  });

  it("expands compound children so grouped video audio reaches export mixing", () => {
    const videoTrack: Track = { ...mockTrack, id: "video-track", type: "video", name: "Video" };
    const videoAsset: MediaAsset = {
      id: "video-asset",
      name: "video.mp4",
      path: "/media/video.mp4",
      type: "video",
      duration: 20,
      width: 1920,
      height: 1080,
      size: 1,
    };
    const compound: Clip = {
      id: "compound-1",
      trackId: videoTrack.id,
      mediaId: "compound-compound-1",
      kind: "compound",
      startTime: 5,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      compoundChildren: [
        {
          id: "child-a",
          trackId: videoTrack.id,
          mediaId: videoAsset.id,
          kind: "video",
          startTime: 0,
          duration: 2,
          trimIn: 0,
          trimOut: 2,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        },
        {
          id: "child-b",
          trackId: videoTrack.id,
          mediaId: videoAsset.id,
          kind: "video",
          startTime: 3,
          duration: 2,
          trimIn: 2,
          trimOut: 4,
          x: 0,
          y: 0,
          width: 1920,
          height: 1080,
          opacity: 1,
          rotation: 0,
        },
      ],
    };

    const audioConfigs = getActiveAudioClips([compound], [videoTrack], [videoAsset], 0, 10);

    expect(audioConfigs.map((config) => ({ clipId: config.clipId, startTime: config.startTime, duration: config.duration, trimIn: config.trimIn }))).toEqual([
      { clipId: "child-a", startTime: 5, duration: 2, trimIn: 0 },
      { clipId: "child-b", startTime: 8, duration: 2, trimIn: 2 },
    ]);
  });
});
