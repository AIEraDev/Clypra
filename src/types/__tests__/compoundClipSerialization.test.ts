import { describe, expect, it } from "vitest";
import { fromRustClip, toRustClip, toRustProject, validateAndMigrateProjectPayload } from "../serialization";
import type { Clip, Project, Track } from "@/types";

describe("Compound Clip Nested Serialization & Deserialization", () => {
  const createBaseClip = (id: string, kind: Clip["kind"], startTime = 0, duration = 5): Clip => ({
    id,
    kind,
    trackId: "track-1",
    mediaId: `media-${id}`,
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    opacity: 1,
    rotation: 0,
  });

  it("recursively transforms compoundChildren in toRustClip (mapping styleDefinition -> style_definition)", () => {
    const textChild: any = {
      ...createBaseClip("text-child", "text", 0, 3),
      text: "Pinned Title",
      fontSize: 48,
      styleId: "neon-glow",
      styleDefinition: {
        id: "neon-glow",
        name: "Neon Glow",
        category: "presets",
        version: "2.1.0",
        font: { family: "Inter", weight: 700 },
        fills: [{ type: "solid", color: "#ff00ff" }],
        strokes: [],
        glows: [],
        shadows: [],
      },
    };

    const audioChild: any = {
      ...createBaseClip("audio-child", "audio", 1, 4),
      audio: {
        gainDb: 6,
        pan: 0.5,
        speed: { speed: 1.2, preservePitch: true },
      },
    };

    const grandchildText: any = {
      ...createBaseClip("grandchild-text", "text", 0, 2),
      text: "Nested Grandchild",
      styleId: "cyber-glitch",
      styleDefinition: {
        id: "cyber-glitch",
        name: "Cyber Glitch",
        category: "cyber",
        version: "1.0",
      },
    };

    const nestedCompoundChild: Clip = {
      ...createBaseClip("nested-compound", "compound", 0, 2),
      compoundChildren: [grandchildText],
    };

    const parentCompound: Clip = {
      ...createBaseClip("parent-compound", "compound", 0, 5),
      compoundChildren: [textChild, audioChild, nestedCompoundChild],
    };

    const rustParent = toRustClip(parentCompound);

    expect(rustParent.kind).toBe("compound");
    expect(rustParent.compoundChildren).toBeDefined();
    expect(rustParent.compoundChildren!.length).toBe(3);

    // Verify Child 0 (text): styleDefinition is mapped to style_definition
    const rustTextChild = rustParent.compoundChildren![0];
    expect(rustTextChild.style_definition).toBeDefined();
    expect((rustTextChild.style_definition as any).id).toBe("neon-glow");
    expect((rustTextChild as any).styleDefinition).toBeUndefined();

    // Verify Child 2 (nested compound): grandchild also mapped recursively
    const rustNestedCompound = rustParent.compoundChildren![2];
    expect(rustNestedCompound.compoundChildren).toBeDefined();
    expect(rustNestedCompound.compoundChildren!.length).toBe(1);
    const rustGrandchild = rustNestedCompound.compoundChildren![0];
    expect(rustGrandchild.style_definition).toBeDefined();
    expect((rustGrandchild.style_definition as any).id).toBe("cyber-glitch");
    expect((rustGrandchild as any).styleDefinition).toBeUndefined();
  });

  it("recursively transforms compoundChildren in fromRustClip (restoring styleDefinition and normalizing audio)", () => {
    const rawRustCompound = {
      id: "parent-compound",
      kind: "compound",
      trackId: "track-1",
      mediaId: "media-parent",
      startTime: 0,
      duration: 10,
      trimIn: 0,
      trimOut: 10,
      compoundChildren: [
        {
          id: "child-text",
          kind: "text",
          trackId: "track-1",
          mediaId: "media-text",
          startTime: 0,
          duration: 4,
          trimIn: 0,
          trimOut: 4,
          text: "My Text",
          styleId: "retro-wave",
          style_definition: {
            id: "retro-wave",
            name: "Retro Wave",
            version: "3.0.0",
          },
        },
        {
          id: "child-audio",
          kind: "audio",
          trackId: "track-2",
          mediaId: "media-audio",
          startTime: 2,
          duration: 5,
          trimIn: 0,
          trimOut: 5,
          audio: {
            gainDb: 3,
          },
        },
        {
          id: "child-nested-compound",
          kind: "compound",
          trackId: "track-1",
          mediaId: "media-nested",
          startTime: 0,
          duration: 3,
          trimIn: 0,
          trimOut: 3,
          compoundChildren: [
            {
              id: "grandchild-text",
              kind: "text",
              trackId: "track-1",
              mediaId: "media-gc",
              startTime: 0,
              duration: 2,
              trimIn: 0,
              trimOut: 2,
              style_definition: {
                id: "grandchild-style",
                name: "Grandchild Style",
              },
            },
          ],
        },
      ],
    };

    const frontendParent = fromRustClip(rawRustCompound as any);

    expect(frontendParent.compoundChildren).toBeDefined();
    expect(frontendParent.compoundChildren!.length).toBe(3);

    // Verify Child 0 (text): styleDefinition is restored and snake_case deleted
    const textChild = frontendParent.compoundChildren![0] as any;
    expect(textChild.styleDefinition).toEqual({
      id: "retro-wave",
      name: "Retro Wave",
      version: "3.0.0",
    });
    expect(textChild.style_definition).toBeUndefined();

    // Verify Child 1 (audio): audio properties normalized
    const audioChild = frontendParent.compoundChildren![1] as any;
    expect(audioChild.audio).toBeDefined();
    expect(audioChild.audio.gainDb).toBe(3);

    // Verify Child 2 (nested compound): grandchild text restored
    const nestedCompound = frontendParent.compoundChildren![2];
    expect(nestedCompound.compoundChildren).toBeDefined();
    const grandchild = nestedCompound.compoundChildren![0] as any;
    expect(grandchild.styleDefinition).toEqual({
      id: "grandchild-style",
      name: "Grandchild Style",
    });
    expect(grandchild.style_definition).toBeUndefined();
  });

  it("handles legacy compound_children snake_case property during fromRustClip", () => {
    const rawLegacyRustCompound = {
      id: "parent-compound",
      kind: "compound",
      trackId: "track-1",
      mediaId: "media-parent",
      startTime: 0,
      duration: 5,
      trimIn: 0,
      trimOut: 5,
      compound_children: [
        {
          id: "legacy-child-text",
          kind: "text",
          trackId: "track-1",
          mediaId: "media-text",
          startTime: 0,
          duration: 3,
          trimIn: 0,
          trimOut: 3,
          style_definition: { id: "legacy-style", version: "1" },
        },
      ],
    };

    const frontend = fromRustClip(rawLegacyRustCompound as any);
    expect(frontend.compoundChildren).toBeDefined();
    expect(frontend.compoundChildren!.length).toBe(1);
    expect((frontend as any).compound_children).toBeUndefined();
    expect((frontend.compoundChildren![0] as any).styleDefinition).toEqual({
      id: "legacy-style",
      version: "1",
    });
  });

  it("preserves compound children text definitions and audio through full project round-trip", () => {
    const project: Project = {
      id: "proj-compound-roundtrip",
      name: "Compound Roundtrip Test",
      createdAt: 1000,
      updatedAt: 2000,
      aspectRatio: "16:9" as any,
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 10,
      timelineSchemaVersion: 1,
      audioModelVersion: 1,
    };

    const tracks: Track[] = [
      { id: "track-1", type: "video", name: "Video 1", locked: false, muted: false, solo: false, visible: true, height: 60 },
      { id: "track-2", type: "audio", name: "Audio 1", locked: false, muted: false, solo: false, visible: true, height: 60 },
    ];

    const compoundClip: Clip = {
      ...createBaseClip("compound-root", "compound", 0, 6),
      compoundChildren: [
        {
          ...createBaseClip("nested-text", "text", 0, 4),
          text: "Pinned Effect Text",
          styleId: "neon-v2",
          styleDefinition: {
            id: "neon-v2",
            name: "Neon V2",
            version: "2.0.0",
            category: "glow",
          } as any,
        } as any,
        {
          ...createBaseClip("nested-audio", "audio", 1, 5),
          trackId: "track-2",
          audio: {
            gainDb: -3,
            pan: -0.25,
            muted: false,
          } as any,
        },
      ],
    };

    const rustProject = toRustProject(project, {
      tracks,
      clips: [compoundClip],
      transitions: [],
      gaps: [],
      markers: [],
      mediaAssets: [],
    });

    const validated = validateAndMigrateProjectPayload(JSON.stringify(rustProject));

    expect(validated.clips.length).toBe(1);
    const restoredCompound = validated.clips[0];
    expect(restoredCompound.compoundChildren).toBeDefined();
    expect(restoredCompound.compoundChildren!.length).toBe(2);

    const restoredText = restoredCompound.compoundChildren![0] as any;
    expect(restoredText.styleDefinition).toEqual({
      id: "neon-v2",
      name: "Neon V2",
      version: "2.0.0",
      category: "glow",
    });
    expect(restoredText.style_definition).toBeUndefined();

    const restoredAudio = restoredCompound.compoundChildren![1] as any;
    expect(restoredAudio.audio).toBeDefined();
    expect(restoredAudio.audio.gainDb).toBe(-3);
  });
});
