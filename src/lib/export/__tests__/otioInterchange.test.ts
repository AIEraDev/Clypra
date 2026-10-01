import { describe, it, expect } from "vitest";
import { exportToOTIO, exportToOTIOJson } from "../otioExporter";
import { importFromOTIO } from "../otioImporter";
import type { Track, Clip, MediaAsset } from "@/types";

describe("OpenTimelineIO (OTIO) Interchange", () => {
  const tracks: Track[] = [
    {
      id: "track-v1",
      type: "video",
      name: "V1",
      muted: false,
      locked: false,
      visible: true,
      height: 64,
    },
    {
      id: "track-a1",
      type: "audio",
      name: "A1",
      muted: false,
      locked: false,
      visible: true,
      height: 48,
    },
  ];

  const mediaAssets: MediaAsset[] = [
    {
      id: "media-1",
      name: "interview.mp4",
      path: "/Users/dev/Videos/interview.mp4",
      type: "video",
      duration: 60,
      size: 1024 * 1024,
    },
    {
      id: "media-2",
      name: "b-roll.mp4",
      path: "/Users/dev/Videos/b-roll.mp4",
      type: "video",
      duration: 30,
      size: 1024 * 1024,
    },
    {
      id: "media-3",
      name: "music.wav",
      path: "/Users/dev/Audio/music.wav",
      type: "audio",
      duration: 120,
      size: 1024 * 1024,
    },
  ];

  const clips: Clip[] = [
    // Clip 1 on V1: starts at 0s, lasts 5s, trimIn 1s
    {
      id: "clip-1",
      name: "Intro Clip",
      trackId: "track-v1",
      mediaId: "media-1",
      startTime: 0,
      duration: 5,
      trimIn: 1,
      trimOut: 6,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1,
    },
    // Clip 2 on V1: starts at 7s (meaning a 2s gap from 5s to 7s), lasts 4s, 2x speed
    {
      id: "clip-2",
      name: "Fast Motion",
      trackId: "track-v1",
      mediaId: "media-2",
      startTime: 7,
      duration: 4,
      trimIn: 0,
      trimOut: 8,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      volume: 1,
      playbackMapping: { kind: "normal", speed: 2.0 },
    },
    // Clip 3 on A1: starts at 2s (meaning a 2s gap at start), lasts 10s
    {
      id: "clip-3",
      name: "Background Music",
      trackId: "track-a1",
      mediaId: "media-3",
      startTime: 2,
      duration: 10,
      trimIn: 5,
      trimOut: 15,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      opacity: 1,
      rotation: 0,
      volume: 0.8,
    },
  ];

  it("exports valid OTIO structure matching OpenTimelineIO schema specifications", () => {
    const otio = exportToOTIO({
      projectName: "Feature Film Cut",
      frameRate: 24,
      tracks,
      clips,
      mediaAssets,
    });

    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    expect(otio.name).toBe("Feature Film Cut");
    expect(otio.global_start_time?.rate).toBe(24);
    expect(otio.tracks.OTIO_SCHEMA).toBe("Stack.1");
    expect(otio.tracks.children).toHaveLength(2);

    // Track 1: Video
    const videoTrack = otio.tracks.children[0];
    expect(videoTrack.OTIO_SCHEMA).toBe("Track.1");
    expect(videoTrack.kind).toBe("Video");
    expect(videoTrack.name).toBe("V1");
    // Should have: Clip 1 (5s), Gap (2s), Clip 2 (4s)
    expect(videoTrack.children).toHaveLength(3);

    const firstClip = videoTrack.children[0] as any;
    expect(firstClip.OTIO_SCHEMA).toBe("Clip.2");
    expect(firstClip.name).toBe("Intro Clip");
    expect(firstClip.source_range.start_time.value).toBe(24); // 1s * 24 fps
    expect(firstClip.source_range.duration.value).toBe(120); // 5s * 24 fps
    expect(firstClip.media_reference.OTIO_SCHEMA).toBe("ExternalReference.1");
    expect(firstClip.media_reference.target_url).toBe("file:///Users/dev/Videos/interview.mp4");

    const gap = videoTrack.children[1] as any;
    expect(gap.OTIO_SCHEMA).toBe("Gap.1");
    expect(gap.source_range.duration.value).toBe(48); // 2s * 24 fps

    const speedClip = videoTrack.children[2] as any;
    expect(speedClip.OTIO_SCHEMA).toBe("Clip.2");
    expect(speedClip.effects).toHaveLength(1);
    expect(speedClip.effects[0].OTIO_SCHEMA).toBe("LinearTimeWarp.1");
    expect(speedClip.effects[0].time_scalar).toBe(2.0);

    // Track 2: Audio
    const audioTrack = otio.tracks.children[1];
    expect(audioTrack.kind).toBe("Audio");
    expect(audioTrack.children).toHaveLength(2); // Initial Gap (2s) + Clip 3 (10s)
    expect(audioTrack.children[0].OTIO_SCHEMA).toBe("Gap.1");
    expect((audioTrack.children[0] as any).source_range.duration.value).toBe(48); // 2s * 24 fps
  });

  it("handles missing media assets gracefully with MissingReference.1", () => {
    const clipWithMissingAsset: Clip = {
      ...clips[0],
      mediaId: "non-existent-asset",
    };

    const otio = exportToOTIO({
      tracks: [tracks[0]],
      clips: [clipWithMissingAsset],
      mediaAssets: [],
    });

    const clip = otio.tracks.children[0].children[0] as any;
    expect(clip.media_reference.OTIO_SCHEMA).toBe("MissingReference.1");
  });

  it("exports valid formatted JSON via exportToOTIOJson", () => {
    const json = exportToOTIOJson({
      projectName: "JSON Project",
      tracks,
      clips,
      mediaAssets,
    });

    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.OTIO_SCHEMA).toBe("Timeline.1");
    expect(parsed.name).toBe("JSON Project");
  });

  it("performs full round-trip export and import preserving timeline integrity", () => {
    const otioJson = exportToOTIOJson({
      projectName: "RoundTrip Project",
      frameRate: 30,
      tracks,
      clips,
      mediaAssets,
    });

    const imported = importFromOTIO(otioJson);

    expect(imported.projectName).toBe("RoundTrip Project");
    expect(imported.frameRate).toBe(30);
    expect(imported.tracks).toHaveLength(2);
    expect(imported.clips).toHaveLength(3);

    // Check Clip 1 round-trip
    const importedClip1 = imported.clips.find((c) => c.name === "Intro Clip");
    expect(importedClip1).toBeDefined();
    expect(importedClip1?.startTime).toBe(0);
    expect(importedClip1?.duration).toBe(5);
    expect(importedClip1?.trimIn).toBe(1);
    expect(importedClip1?.trimOut).toBe(6);

    // Check Clip 2 round-trip (after 2s gap at 7s)
    const importedClip2 = imported.clips.find((c) => c.name === "Fast Motion");
    expect(importedClip2).toBeDefined();
    expect(importedClip2?.startTime).toBe(7);
    expect(importedClip2?.duration).toBe(4);
    expect(importedClip2?.speed).toBe(2.0);

    // Check Clip 3 round-trip (after 2s initial gap)
    const importedClip3 = imported.clips.find((c) => c.name === "Background Music");
    expect(importedClip3).toBeDefined();
    expect(importedClip3?.startTime).toBe(2);
    expect(importedClip3?.duration).toBe(10);
    expect(importedClip3?.trimIn).toBe(5);
    expect(importedClip3?.trimOut).toBe(15);

    // Check Media Assets preserved
    expect(imported.mediaAssets.length).toBeGreaterThanOrEqual(3);
    const mediaPaths = imported.mediaAssets.map((m) => m.path);
    expect(mediaPaths).toContain("/Users/dev/Videos/interview.mp4");
    expect(mediaPaths).toContain("/Users/dev/Videos/b-roll.mp4");
    expect(mediaPaths).toContain("/Users/dev/Audio/music.wav");
  });
});
