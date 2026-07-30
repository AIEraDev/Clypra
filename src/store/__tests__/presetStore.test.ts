import { describe, it, expect, beforeEach } from "vitest";
import { usePresetStore } from "../presetStore";

describe("presetStore — Custom Property & Text Presets", () => {
  beforeEach(() => {
    usePresetStore.setState({
      presets: [
        {
          id: "preset-neon",
          name: "Neon Glow",
          fontFamily: "Outfit Variable",
          fontSize: 48,
          fontWeight: "bold",
          color: "#ff007f",
          align: "center",
          valign: "middle",
          lineHeight: 1.2,
        },
      ],
    });
  });

  it("saves custom text style preset with unique ID", () => {
    const { savePreset } = usePresetStore.getState();

    savePreset("Cyber Yellow", {
      fontFamily: "Bebas Neue",
      fontSize: 64,
      color: "#FFE600",
      align: "center",
      valign: "middle",
      lineHeight: 1.1,
    });

    const presets = usePresetStore.getState().presets;
    expect(presets.length).toBe(2);

    const cyber = presets.find((p) => p.name === "Cyber Yellow");
    expect(cyber).toBeDefined();
    expect(cyber?.isCustom).toBe(true);
    expect(cyber?.fontFamily).toBe("Bebas Neue");
  });

  it("deletes preset by ID", () => {
    const { savePreset, deletePreset } = usePresetStore.getState();

    savePreset("Temp Preset", {
      fontFamily: "Inter",
      fontSize: 32,
      color: "#FFFFFF",
      align: "left",
      valign: "top",
      lineHeight: 1.0,
    });

    const temp = usePresetStore.getState().presets.find((p) => p.name === "Temp Preset");
    expect(temp).toBeDefined();

    deletePreset(temp!.id);
    expect(usePresetStore.getState().presets.find((p) => p.id === temp!.id)).toBeUndefined();
  });
});
