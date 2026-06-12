import { describe, expect, it } from "vitest";
import type { Project, Track, Clip, MediaAsset, TextClip } from "../index";
import {
  toRustProject,
  fromRustProject,
  fromRustTrack,
  fromRustClip,
  toRustTrack,
  toRustClip,
  toRustMediaAsset,
  fromRustMediaAsset,
} from "../serialization";

describe("Project Serialization Layer", () => {
  it("converts a frontend Project to a RustProject with correct snake_case mapping", () => {
    const frontendProject: Project = {
      id: "project-1",
      name: "Test Project",
      createdAt: 1000,
      updatedAt: 2000,
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 12.5,
      timelineSchemaVersion: 1,
    };

    const tracks: Track[] = [
      {
        id: "track-1",
        type: "video",
        name: "Video Track",
        muted: false,
        locked: false,
        visible: true,
        height: 68,
      },
    ];

    const clips: Clip[] = [
      {
        id: "clip-1",
        trackId: "track-1",
        mediaId: "media-1",
        startTime: 0,
        duration: 5,
        trimIn: 0,
        trimOut: 5,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        opacity: 1.0,
        rotation: 0,
        aspectRatioLocked: true,
        sourceAspectRatio: 1.777,
        fitMode: "contain",
        volume: 0.8,
      },
    ];

    const mediaAssets: MediaAsset[] = [
      {
        id: "media-1",
        name: "test.mp4",
        path: "/path/to/test.mp4",
        type: "video",
        duration: 10,
        width: 1920,
        height: 1080,
        size: 5000000,
        posterFrame: "/path/to/poster.jpg",
        rotation: 90,
        contentBounds: {
          x: 10,
          y: 20,
          width: 1900,
          height: 1040,
        },
      },
    ];

    const rustProject = toRustProject(frontendProject, {
      tracks,
      clips,
      mediaAssets,
      transitions: [],
    });

    // Verify snake_case field mapping
    expect(rustProject.id).toBe("project-1");
    expect(rustProject.name).toBe("Test Project");
    expect(rustProject.created_at).toBe(1000);
    expect(rustProject.modified_at).toBeGreaterThan(0); // auto-updated to Date.now()
    expect(rustProject.aspect_ratio).toBe("16:9");
    expect(rustProject.canvas_width).toBe(1920);
    expect(rustProject.canvas_height).toBe(1080);
    expect(rustProject.frame_rate).toBe(30);
    expect(rustProject.duration).toBe(12.5);
    expect(rustProject.timeline_schema_version).toBe(1);

    // Verify tracks serialization
    expect(rustProject.tracks).toHaveLength(1);
    expect(rustProject.tracks![0]).toEqual({
      id: "track-1",
      type: "video",
      name: "Video Track",
      muted: false,
      locked: false,
      visible: true,
      height: 68,
    });

    // Verify clips serialization
    expect(rustProject.clips).toHaveLength(1);
    expect(rustProject.clips![0]).toEqual({
      id: "clip-1",
      trackId: "track-1",
      mediaId: "media-1",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      aspectRatioLocked: true,
      sourceAspectRatio: 1.777,
      fitMode: "contain",
      volume: 0.8,
    });

    // Verify mediaAssets serialization
    expect(rustProject.media_assets).toHaveLength(1);
    expect(rustProject.media_assets![0]).toEqual({
      id: "media-1",
      name: "test.mp4",
      path: "/path/to/test.mp4",
      type: "video",
      duration: 10,
      width: 1920,
      height: 1080,
      posterFrame: "/path/to/poster.jpg",
      size: 5000000,
      coverArt: undefined,
      rotation: 90,
      contentBounds: {
        x: 10,
        y: 20,
        width: 1900,
        height: 1040,
      },
    });

    // Verify round-trip deserialization
    const deserializedProject = fromRustProject(rustProject);
    const deserializedMediaAsset = fromRustMediaAsset(rustProject.media_assets![0]);
    const deserializedClip = fromRustClip(rustProject.clips![0]);

    expect(deserializedMediaAsset.rotation).toBe(90);
    expect(deserializedMediaAsset.contentBounds).toEqual({
      x: 10,
      y: 20,
      width: 1900,
      height: 1040,
    });

    expect(deserializedClip.fitMode).toBe("contain");
    expect(deserializedClip.volume).toBe(0.8);
  });

  it("handles TextClip specific properties and custom style definitions in serialization round-trip", () => {
    const textClip: TextClip = {
      id: "clip-text",
      kind: "text",
      trackId: "track-text",
      mediaId: "",
      startTime: 0,
      duration: 3,
      trimIn: 0,
      trimOut: 3,
      x: 100,
      y: 100,
      width: 500,
      height: 160,
      opacity: 1,
      rotation: 0,
      text: "Hello World",
      fontFamily: "Inter",
      fontSize: 48,
      color: "#ffffff",
      align: "center",
      valign: "middle",
      lineHeight: 1.2,
      paddingX: 16,
      paddingY: 16,
      styleDefinition: {
        id: "style-1",
        name: "Custom Style",
        schema: {} as any,
        keyframes: [],
      } as any,
    };

    const rustClip = toRustClip(textClip);
    expect(rustClip.style_definition).toEqual({
      id: "style-1",
      name: "Custom Style",
      schema: {},
      keyframes: [],
    });
    expect((rustClip as any).styleDefinition).toBeUndefined();
    expect((rustClip as any).text).toBe("Hello World");

    const roundTrippedClip = fromRustClip(rustClip) as TextClip;
    expect(roundTrippedClip.styleDefinition).toEqual({
      id: "style-1",
      name: "Custom Style",
      schema: {},
      keyframes: [],
    });
    expect((roundTrippedClip as any).style_definition).toBeUndefined();
    expect(roundTrippedClip.text).toBe("Hello World");
    expect(roundTrippedClip.fontFamily).toBe("Inter");
  });

  it("applies fallback default values during deserialization when fields are missing from Rust", () => {
    const incompleteRustProject = {
      id: "project-1",
      name: "Legacy Project",
      created_at: 1000,
      modified_at: 2000,
      // missing aspect_ratio, canvas_width, etc.
    };

    const project = fromRustProject(incompleteRustProject as any);

    expect(project.aspectRatio).toBe("16:9");
    expect(project.canvasWidth).toBe(1920);
    expect(project.canvasHeight).toBe(1080);
    expect(project.frameRate).toBe(30);
    expect(project.duration).toBe(0);
    expect(project.timelineSchemaVersion).toBe(1);
  });
});
