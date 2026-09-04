import { beforeEach, describe, expect, it } from "vitest";
import type { EvaluatedTextLayer } from "@/core/evaluation/types";
import { useEffectsStore } from "@/features/text-effects/store/effectsStore";
import {
  buildNativeTextLayoutKey,
  buildNativeTextRasterKey,
  resolveNativeTextEffectDefinition,
} from "../nativeTextPreview";

function makeTextLayer(
  overrides: Partial<EvaluatedTextLayer> = {},
): EvaluatedTextLayer {
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

  it("does not invalidate immutable pixels for compositor-only movement", () => {
    const layer = makeTextLayer();
    expect(buildNativeTextRasterKey(layer)).toBe(
      buildNativeTextRasterKey({
        ...layer,
        x: 420,
        y: 240,
        rotation: 0.25,
        opacity: 0.4,
      }),
    );
  });

  it("invalidates the raster asset when animated time changes", () => {
    const animated = { animation: { type: "pulse" } } as never;
    expect(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: animated, time: 0 }),
      ),
    ).not.toBe(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: animated, time: 1 / 30 }),
      ),
    );
  });

  it("invalidates the raster asset when Studio style data changes", () => {
    expect(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: { id: "a" } as never }),
      ),
    ).not.toBe(
      buildNativeTextRasterKey(
        makeTextLayer({ styleDefinition: { id: "b" } as never }),
      ),
    );
  });

  it("invalidates the raster asset when the text color changes", () => {
    expect(
      buildNativeTextRasterKey(makeTextLayer({ color: "#ffffff" })),
    ).not.toBe(buildNativeTextRasterKey(makeTextLayer({ color: "#ff3366" })));
  });

  it("keeps layout work cacheable when only a plain text color changes", () => {
    expect(buildNativeTextLayoutKey(makeTextLayer({ color: "#ffffff" }))).toBe(
      buildNativeTextLayoutKey(makeTextLayer({ color: "#ff3366" })),
    );
  });

  it("keeps a pinned clip definition ahead of a newer live catalog definition", () => {
    const pinned = { id: "neon", version: 1 } as never;
    const live = { id: "neon", version: 2 } as never;
    useEffectsStore.setState({ definitions: { neon: live } });

    expect(
      resolveNativeTextEffectDefinition(
        makeTextLayer({
          styleId: "neon",
          styleDefinition: pinned,
        }),
      ),
    ).toBe(pinned);
  });

  it("uses the live definition only for legacy layers without a pinned snapshot", () => {
    const live = { id: "neon", version: 2 } as never;
    useEffectsStore.setState({ definitions: { neon: live } });

    expect(
      resolveNativeTextEffectDefinition(makeTextLayer({ styleId: "neon" })),
    ).toBe(live);
  });
});

// ─── Text layout metrics cache invariants ─────────────────────────────────────

import { _clearTextLayoutMetricsCache } from "../nativeTextPreview";

describe("text layout metrics cache", () => {
  beforeEach(() => {
    useEffectsStore.setState({ definitions: {} });
    _clearTextLayoutMetricsCache();
  });

  it("buildNativeTextLayoutKey excludes color — same key for different colors", () => {
    const base = makeTextLayer({ color: "#ffffff" });
    const changed = makeTextLayer({ color: "#ff0000" });
    expect(buildNativeTextLayoutKey(base)).toBe(
      buildNativeTextLayoutKey(changed),
    );
  });

  it("buildNativeTextLayoutKey changes when font family changes", () => {
    const a = makeTextLayer({ fontFamily: "Inter Variable" });
    const b = makeTextLayer({ fontFamily: "Bebas Neue" });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when font size changes", () => {
    const a = makeTextLayer({ fontSize: 48 });
    const b = makeTextLayer({ fontSize: 96 });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when stroke changes", () => {
    const a = makeTextLayer({ stroke: undefined });
    const b = makeTextLayer({ stroke: { color: "#000", width: 2 } });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when shadow changes", () => {
    const a = makeTextLayer({ shadow: undefined });
    const b = makeTextLayer({
      shadow: { color: "#000", blur: 4, offsetX: 2, offsetY: 2 },
    });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("buildNativeTextLayoutKey changes when layer dimensions change", () => {
    const a = makeTextLayer({ width: 640, height: 120 });
    const b = makeTextLayer({ width: 800, height: 200 });
    expect(buildNativeTextLayoutKey(a)).not.toBe(buildNativeTextLayoutKey(b));
  });

  it("cache cleared between tests — _clearTextLayoutMetricsCache works", () => {
    // Just verifying the exported clear function doesn't throw
    expect(() => _clearTextLayoutMetricsCache()).not.toThrow();
  });
});
