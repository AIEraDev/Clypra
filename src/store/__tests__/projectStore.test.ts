import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import { useProjectStore } from "../projectStore";
import { useTimelineStore } from "../timelineStore";
import type { Project, TextClip, Track } from "@/types";

const defaultHydrateFromProject = useTimelineStore.getState().hydrateFromProject;

vi.mock("@/core/runtime/ProjectSession", () => ({
  disposeActiveSession: vi.fn(),
  createProjectSession: vi.fn(),
}));

// Mock fetchDefinitionOnlyById so preloadTextEffectDefinitionsFromClips
// populates the effects store without real network calls
vi.mock(
  "@/features/text-effects/store/effectsStore",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/features/text-effects/store/effectsStore")
      >();
    return {
      ...actual,
      useEffectsStore: {
        ...actual.useEffectsStore,
        getState: () => ({
          ...actual.useEffectsStore.getState(),
          fetchDefinitionOnlyById: vi.fn(async (id: string) => {
            actual.useEffectsStore.setState((state) => ({
              definitions: {
                ...state.definitions,
                [id]: {
                  id,
                  name: id,
                  category: "sticker",
                  font: { family: "Inter", weight: 700 },
                  fills: [],
                  strokes: [],
                  glows: [],
                  shadows: [],
                  tags: [],
                  description: "",
                } as any,
              },
            }));
          }),
        }),
        setState: actual.useEffectsStore.setState,
        subscribe: actual.useEffectsStore.subscribe,
      },
    };
  },
);

describe("projectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: null,
      mediaAssets: [],
      recentProjects: [],
      toastMessage: null,
      toastVariant: "success",
    });
    useTimelineStore.getState().hydrateFromProject({ tracks: [], clips: [] });
    useTimelineStore.setState({ hydrateFromProject: defaultHydrateFromProject });
    useEffectsStore.setState({
      index: {},
      indexLoading: false,
      indexError: null,
      definitions: {},
      loadingId: null,
      prefetchingIds: new Set(),
      selectedEffect: null,
      selectedCategory: null,
    });
  });

  it("preloads saved text effect definitions before hydrating timeline clips", async () => {
    const project: Project = {
      id: "project-1",
      name: "Loaded Project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 10,
    };
    const tracks: Track[] = [
      {
        id: "track-text",
        type: "text",
        name: "Text",
        muted: false,
        locked: false,
        visible: true,
        height: 30,
      },
    ];
    const clips: TextClip[] = [
      {
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
        text: "CLYPRA",
        fontFamily: "Inter",
        fontSize: 96,
        color: "#ffffff",
        align: "center",
        valign: "middle",
        lineHeight: 1.2,
        paddingX: 16,
        paddingY: 16,
        styleId: "premium-sticker",
      },
    ];

    const originalHydrate = useTimelineStore.getState().hydrateFromProject;
    const hydrateSpy = vi.fn((payload: { tracks?: any[]; clips?: any[] }) => {
      expect(
        useEffectsStore.getState().definitions["premium-sticker"],
      ).toBeDefined();
      originalHydrate(payload);
    });
    useTimelineStore.setState({ hydrateFromProject: hydrateSpy } as any);

    await useProjectStore
      .getState()
      .loadProject(project, { tracks, clips, mediaAssets: [] });

    expect(hydrateSpy).toHaveBeenCalledWith({
      tracks,
      clips,
      transitions: [],
      gaps: [],
      markers: [],
      cleanEmptyTracks: true,
    });
    expect(useTimelineStore.getState().clips[0]).toMatchObject({
      id: "clip-text",
      styleId: "premium-sticker",
    });
  });

  it("normalizes embedded flat text effect definitions before hydrating timeline clips", async () => {
    const project: Project = {
      id: "project-flat-effect",
      name: "Loaded Project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      aspectRatio: "16:9",
      canvasWidth: 1920,
      canvasHeight: 1080,
      frameRate: 30,
      duration: 10,
    };
    const tracks: Track[] = [
      {
        id: "track-text",
        type: "text",
        name: "Text",
        muted: false,
        locked: false,
        visible: true,
        height: 30,
      },
    ];
    const clips = [
      {
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
        text: "NEON",
        fontSize: 96,
        color: "#ffffff",
        styleId: "flat-neon",
        styleDefinition: {
          id: "flat-neon",
          name: "Flat Neon",
          category: "neon",
          fontFamily: "Bebas Neue",
          fontWeight: 700,
          fillType: "none",
          strokeEnabled: true,
          strokeColor: "#ffffff",
          strokeWidth: 10,
          glowLayers: [
            {
              enabled: true,
              color: "#ff1744",
              blur: 32,
              opacity: 85,
              type: "outer",
            },
          ],
        },
      },
    ] as any[];

    await useProjectStore
      .getState()
      .loadProject(project, { tracks, clips, mediaAssets: [] });

    const cached = useEffectsStore.getState().definitions["flat-neon"];
    expect(cached.font.family).toBe("Bebas Neue");
    expect(cached.fills).toEqual([]);
    expect(cached.strokes[0]).toMatchObject({ color: "#ffffff", width: 10 });
    expect(cached.glows?.[0]).toMatchObject({ color: "#ff1744", blur: 32 });
  });

  it("preloads embedded text effect definitions nested inside compoundChildren", async () => {
    const project: Project = {
      id: "project-compound-test",
      name: "Compound Preload Project",
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
    ];

    const compoundClip = {
      id: "compound-parent",
      kind: "compound",
      trackId: "track-1",
      mediaId: "media-compound",
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
      compoundChildren: [
        {
          id: "nested-text-clip",
          kind: "text",
          trackId: "track-1",
          mediaId: "media-nested-text",
          startTime: 0,
          duration: 3,
          trimIn: 0,
          trimOut: 3,
          text: "COMPOUND TEXT",
          fontSize: 72,
          styleId: "nested-cyber-neon",
          styleDefinition: {
            id: "nested-cyber-neon",
            name: "Nested Cyber Neon",
            category: "neon",
            font: { family: "Roboto", weight: 900 },
            fills: [{ type: "solid", color: "#00ffcc" }],
            strokes: [],
            glows: [],
            shadows: [],
          },
        },
      ],
    };

    await useProjectStore
      .getState()
      .loadProject(project, { tracks, clips: [compoundClip as any], mediaAssets: [] });

    const cached = useEffectsStore.getState().definitions["nested-cyber-neon"];
    expect(cached).toBeDefined();
    expect(cached.name).toBe("Nested Cyber Neon");
    expect(cached.font.family).toBe("Roboto");
  });
});
