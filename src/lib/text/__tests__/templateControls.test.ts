import { describe, it, expect } from "vitest";
import { resolveTemplateControlValues } from "../templateControls";
import type { TextTemplateArtifact } from "@clypra-studio/engine";

describe("resolveTemplateControlValues", () => {
  const mockArtifact: TextTemplateArtifact = {
    id: "tpl-test",
    version: 1,
    timing: { duration: 3, fps: 30 },
    document: {
      canvas: { width: 1920, height: 1080 },
      nodes: [
        { id: "node-primary", type: "text", role: "primary" },
        { id: "node-sub", type: "text", role: "secondary" },
        { id: "node-accent", type: "text", role: "accent" },
        { id: "node-other", type: "text" },
      ],
    },
    controls: [
      {
        id: "ctrl-title",
        label: "Title",
        type: "text",
        target: { nodeId: "node-primary", property: "text" },
        defaultValue: "Default Title",
      },
      {
        id: "ctrl-subtitle",
        label: "Subtitle",
        type: "text",
        target: { nodeId: "node-sub", property: "text" },
        defaultValue: "Default Sub",
      },
      {
        id: "ctrl-accent",
        label: "Accent Text",
        type: "text",
        target: { nodeId: "node-accent", property: "text" },
        defaultValue: "Default Accent",
      },
      {
        id: "ctrl-primary-color",
        label: "Primary Color",
        type: "color",
        target: { nodeId: "node-primary", property: "color" },
        defaultValue: "#ffffff",
      },
      {
        id: "ctrl-secondary-color",
        label: "Secondary Color",
        type: "color",
        target: { nodeId: "node-sub", property: "color" },
        defaultValue: "#ff0000",
      },
    ],
  } as any;

  it("returns default values when customization is empty", () => {
    const values = resolveTemplateControlValues(mockArtifact, {});
    expect(values["ctrl-title"]).toBe("Default Title");
    expect(values["ctrl-subtitle"]).toBe("Default Sub");
    expect(values["ctrl-accent"]).toBe("Default Accent");
    expect(values["ctrl-primary-color"]).toBe("#ffffff");
    expect(values["ctrl-secondary-color"]).toBe("#ff0000");
  });

  it("resolves role-based text and color customization", () => {
    const values = resolveTemplateControlValues(mockArtifact, {
      primaryText: "Hello World",
      secondaryText: "Sub World",
      accentText: "Accent World",
      primaryColor: "#00ff00",
      secondaryColor: "#0000ff",
    });
    expect(values["ctrl-title"]).toBe("Hello World");
    expect(values["ctrl-subtitle"]).toBe("Sub World");
    expect(values["ctrl-accent"]).toBe("Accent World");
    expect(values["ctrl-primary-color"]).toBe("#00ff00");
    expect(values["ctrl-secondary-color"]).toBe("#0000ff");
  });

  it("prioritizes explicit layerTexts and layerColors over role defaults", () => {
    const values = resolveTemplateControlValues(mockArtifact, {
      primaryText: "Role Primary",
      layerTexts: {
        "node-primary": "Explicit Primary Overwrite",
      },
      primaryColor: "#ffffff",
      layerColors: {
        "node-primary": "#123456",
      },
    });
    expect(values["ctrl-title"]).toBe("Explicit Primary Overwrite");
    expect(values["ctrl-primary-color"]).toBe("#123456");
  });

  it("falls back to fallbackText for the first text node when role text is missing", () => {
    const values = resolveTemplateControlValues(mockArtifact, {
      customization: {} as any,
      fallbackText: "Fallback Text For Clip",
    });
    expect(values["ctrl-title"]).toBe("Fallback Text For Clip");
    expect(values["ctrl-subtitle"]).toBe("Default Sub");
  });

  it("preserves explicit templateControlValues overrides", () => {
    const values = resolveTemplateControlValues(mockArtifact, {
      templateControlValues: {
        "ctrl-title": "Preserved Control Override",
      },
    });
    expect(values["ctrl-title"]).toBe("Preserved Control Override");
  });
});
