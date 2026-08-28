import { beforeEach, describe, expect, it } from "vitest";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import {
  buildNativeTextRasterKey,
  resolveNativeTextEffectDefinition,
} from "../nativeTextPreview";

function makeTextLayer(overrides: Partial<EvaluatedTextLayer> = {}): EvaluatedTextLayer {
  return {
    layerId: "title-1",
    clipId: "title-1",
    role: "text",
    clipKind: "text",
    zIndex: 1,
    trackIndex: 0,
    layerType: "text",
    x: 100,
    y: 80,
    width: 640,
    height: 120,
    rotation: 0,
    opacity: 1,
    inTransition: false,
    blendMode: "normal",
    text: "Clypra",
    fontFamily: "Inter",
    fontSize: 64,
    color: "#ffffff",
    fontWeight: 700,
    fontStyle: "normal",
    textAlign: "center",
    verticalAlign: "middle",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...overrides,
  };
}

describe("native text raster compatibility", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
  });

  it("keeps identical Clypra Studio inputs cache-stable", () => {
    expect(buildNativeTextRasterKey(makeTextLayer())).toBe(
      buildNativeTextRasterKey(makeTextLayer()),
    );
  });

  it("invalidates the raster asset when animated time changes", () => {
    const animated = { animation: { type: "pulse" } } as never;
    expect(buildNativeTextRasterKey(makeTextLayer({ styleDefinition: animated, time: 0 }))).not.toBe(
      buildNativeTextRasterKey(makeTextLayer({ styleDefinition: animated, time: 1 / 30 })),
    );
  });

  it("invalidates the raster asset when Studio style data changes", () => {
    expect(buildNativeTextRasterKey(makeTextLayer({ styleDefinition: { id: "a" } as never }))).not.toBe(
      buildNativeTextRasterKey(makeTextLayer({ styleDefinition: { id: "b" } as never })),
    );
  });

  it("keeps a pinned clip definition ahead of a newer live catalog definition", () => {
    const pinned = { id: "neon", version: 1 } as never;
    const live = { id: "neon", version: 2 } as never;
    useEffectsStore.setState({ definitions: { neon: live } });

    expect(resolveNativeTextEffectDefinition(makeTextLayer({
      styleId: "neon",
      styleDefinition: pinned,
    }))).toBe(pinned);
  });

  it("uses the live definition only for legacy layers without a pinned snapshot", () => {
    const live = { id: "neon", version: 2 } as never;
    useEffectsStore.setState({ definitions: { neon: live } });

    expect(resolveNativeTextEffectDefinition(makeTextLayer({ styleId: "neon" }))).toBe(live);
  });
});
