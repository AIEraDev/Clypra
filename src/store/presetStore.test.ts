import { describe, expect, it } from "vitest";
import * as presetStore from "./presetStore";
import type { TextPreset } from "./presetStore";

const displayName = (preset: TextPreset) => {
  const helper = (presetStore as typeof presetStore & {
    getPresetDisplayName?: (value: TextPreset) => string;
  }).getPresetDisplayName;

  expect(helper).toBeTypeOf("function");
  return helper!(preset);
};

describe("getPresetDisplayName", () => {
  it("localizes built-in presets by stable ID without changing stored names", () => {
    const presets = presetStore.usePresetStore.getState().presets;

    expect(presets.map((preset) => [preset.id, preset.name, displayName(preset)])).toEqual([
      ["preset-neon", "Neon Glow", "霓虹光效"],
      ["preset-minimal", "Minimalist Sans", "极简无衬线"],
      ["preset-editorial", "Classic Editorial", "经典编辑风"],
      ["preset-subtitles", "Premium Subtitle", "高级字幕"],
    ]);
    expect(presets.map((preset) => preset.name)).toEqual([
      "Neon Glow",
      "Minimalist Sans",
      "Classic Editorial",
      "Premium Subtitle",
    ]);
  });

  it("preserves custom, unknown, and prototype-like names without mutation", () => {
    const base = presetStore.usePresetStore.getState().presets[0];
    const cases = [
      { ...base, id: "preset-neon", name: "My Neon", isCustom: true },
      { ...base, id: "unknown-id", name: "Unknown Name" },
      { ...base, id: "constructor", name: "constructor" },
      { ...base, id: "toString", name: "toString" },
      { ...base, id: "__proto__", name: "__proto__" },
    ] satisfies TextPreset[];
    const snapshots = cases.map((preset) => ({ ...preset }));

    expect(cases.map(displayName)).toEqual([
      "My Neon",
      "Unknown Name",
      "constructor",
      "toString",
      "__proto__",
    ]);
    expect(cases).toEqual(snapshots);
  });
});
