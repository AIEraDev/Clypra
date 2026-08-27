import { describe, it, expect, beforeEach } from "vitest";
import { verifyExportDependencies, ExportBlockedError } from "../exportPreflight";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import type { Clip } from "@/types";

describe("Export Preflight Dependency Verification (§1.2 Architecture Contract)", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
  });

  it("permits export when all text clips have no special effect or default style", async () => {
    const clips: Clip[] = [
      {
        id: "clip-1",
        kind: "text",
        text: "Plain Title",
        styleId: undefined,
        startTime: 0,
        duration: 5,
        trackIndex: 0,
      } as any,
    ];

    const result = await verifyExportDependencies(clips, { isOnline: false });
    expect(result.ready).toBe(true);
    expect(result.missingEffects).toHaveLength(0);
  });

  it("permits export when online even if effect is not yet cached locally", async () => {
    const clips: Clip[] = [
      {
        id: "clip-2",
        kind: "text",
        text: "Neon Text",
        styleId: "neon-glow-v1",
        startTime: 0,
        duration: 5,
        trackIndex: 0,
      } as any,
    ];

    const result = await verifyExportDependencies(clips, { isOnline: true });
    expect(result.ready).toBe(true);
    expect(result.missingEffects).toHaveLength(0);
  });

  it("blocks export when offline and text effect is not resident in memory or cache", async () => {
    const clips: Clip[] = [
      {
        id: "clip-3",
        kind: "text",
        text: "Uncached Glitch",
        styleId: "glitch-retro-v2",
        startTime: 0,
        duration: 5,
        trackIndex: 0,
      } as any,
    ];

    const result = await verifyExportDependencies(clips, { isOnline: false });
    expect(result.ready).toBe(false);
    expect(result.missingEffects).toHaveLength(1);
    expect(result.missingEffects[0]).toEqual({
      clipId: "clip-3",
      clipName: "Uncached Glitch",
      styleId: "glitch-retro-v2",
    });
  });

  it("permits export when offline if effect definition is already resident in store", async () => {
    useEffectsStore.setState({
      definitions: {
        "neon-glow-v1": {
          id: "neon-glow-v1",
          name: "Neon Glow",
          version: 1,
          passes: [],
        } as any,
      },
    });

    const clips: Clip[] = [
      {
        id: "clip-4",
        kind: "text",
        text: "Cached Neon",
        styleId: "neon-glow-v1",
        startTime: 0,
        duration: 5,
        trackIndex: 0,
      } as any,
    ];

    const result = await verifyExportDependencies(clips, { isOnline: false });
    expect(result.ready).toBe(true);
    expect(result.missingEffects).toHaveLength(0);
  });

  it("inspects nested children in compound clips and blocks export if template child effect is uncached offline (§4)", async () => {
    const compoundClip: Clip = {
      id: "compound-template-1",
      name: "Lower Third Template",
      kind: "compound",
      startTime: 2.0,
      duration: 5.0,
      trimIn: 0,
      trimOut: 0,
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      opacity: 1,
      rotation: 0,
      trackId: "track-1",
      mediaId: "compound-compound-template-1",
      compoundChildren: [
        {
          id: "child-solid",
          kind: "color" as any,
          startTime: 0,
          duration: 5.0,
          trackId: "track-1",
        } as any,
        {
          id: "child-text-1",
          kind: "text",
          name: "Speaker Name",
          text: "Speaker Name",
          styleId: "uncached-hologram-v2",
          startTime: 0,
          duration: 5.0,
          trackId: "track-1",
        } as any,
      ],
    };

    const result = await verifyExportDependencies([compoundClip], { isOnline: false });
    expect(result.ready).toBe(false);
    expect(result.missingEffects).toHaveLength(1);
    expect(result.missingEffects[0].styleId).toBe("uncached-hologram-v2");
    expect(result.missingEffects[0].clipName).toBe("Speaker Name");
  });

  it("blocks offline export when a template image asset is missing", async () => {
    const result = await verifyExportDependencies(
      [
        {
          id: "template-image-1",
          name: "Brand Mark",
          kind: "image",
          mediaId: "brand-mark-asset",
        } as any,
      ],
      { isOnline: false, assets: [] },
    );

    expect(result.ready).toBe(false);
    expect(result.missingImageAssets).toEqual([
      {
        clipId: "template-image-1",
        clipName: "Brand Mark",
        assetId: "brand-mark-asset",
      },
    ]);
  });

  it("allows a self-contained template image URL without a media asset", async () => {
    const result = await verifyExportDependencies(
      [
        {
          id: "template-image-2",
          kind: "image",
          mediaId: "generated-image",
          mediaUrl: "data:image/png;base64,AAAA",
        } as any,
      ],
      { isOnline: false, assets: [] },
    );

    expect(result.ready).toBe(true);
    expect(result.missingImageAssets).toHaveLength(0);
  });

  it("blocks an audio clip whose media asset is unavailable", async () => {
    const result = await verifyExportDependencies(
      [
        {
          id: "voiceover-1",
          name: "Voiceover",
          kind: "audio",
          mediaId: "missing-voiceover",
        } as any,
      ],
      { isOnline: false, assets: [] },
    );

    expect(result.ready).toBe(false);
    expect(result.missingAudioAssets).toEqual([
      {
        clipId: "voiceover-1",
        clipName: "Voiceover",
        assetId: "missing-voiceover",
      },
    ]);
  });

  it("formats actionable error message in ExportBlockedError", () => {
    const err = new ExportBlockedError([
      { clipId: "c1", clipName: "Title 1", styleId: "cyberpunk-glow" },
    ]);
    expect(err.name).toBe("ExportBlockedError");
    expect(err.message).toContain("cyberpunk-glow");
    expect(err.message).toContain("Title 1");
    expect(err.message).toContain("force-export confirmation");
  });

  it("includes missing image assets in the blocking error", () => {
    const err = new ExportBlockedError([], [
      { clipId: "image-1", clipName: "Brand Mark", assetId: "brand-mark" },
    ]);

    expect(err.missingImageAssets).toHaveLength(1);
    expect(err.message).toContain("brand-mark");
    expect(err.message).toContain("Restore the referenced media assets");
    expect(err.message).toContain("media cannot be force-exported");
    expect(err.message).not.toContain("force-export confirmation");
  });
});
