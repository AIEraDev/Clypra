import { describe, it, expect } from "vitest";
import type { TemplateDefinition, TemplateElement } from "../types";

describe("Text Template Schema Contracts (§3 Architecture Plan)", () => {
  it("defines a valid single-element template definition", () => {
    const singleElementTemplate: TemplateDefinition = {
      id: "minimal-title-v1",
      version: 1,
      displayName: "Minimalist Title",
      category: "title-card",
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 4.0,
      elements: [
        {
          id: "main-title",
          kind: "text",
          relativePosition: { x: 960, y: 540 },
          width: 800,
          height: 120,
          zIndex: 1,
          textProperties: {
            text: "YOUR HEADLINE",
            fontFamily: "Inter Variable",
            fontSize: 64,
            color: "#FFFFFF",
            align: "center",
            fontWeight: 700,
            styleId: "clean-outline",
            styleVersion: 1,
          },
        },
      ],
    };

    expect(singleElementTemplate.elements).toHaveLength(1);
    expect(singleElementTemplate.elements![0].kind).toBe("text");
    expect(singleElementTemplate.elements![0].textProperties?.styleId).toBe("clean-outline");
  });

  it("defines a valid multi-element template definition (Lower Third with Background)", () => {
    const backgroundElement: TemplateElement = {
      id: "bg-bar",
      kind: "solid",
      relativePosition: { x: 100, y: 850 },
      width: 500,
      height: 90,
      zIndex: 0,
      solidProperties: {
        color: "#0F172A",
        borderRadius: 8,
        opacity: 0.9,
      },
    };

    const nameElement: TemplateElement = {
      id: "speaker-name",
      kind: "text",
      relativePosition: { x: 120, y: 865 },
      width: 460,
      height: 40,
      zIndex: 1,
      textProperties: {
        text: "Jane Doe",
        fontFamily: "Inter Variable",
        fontSize: 32,
        color: "#F8FAFC",
        fontWeight: 700,
        align: "left",
      },
    };

    const titleElement: TemplateElement = {
      id: "speaker-title",
      kind: "text",
      relativePosition: { x: 120, y: 905 },
      width: 460,
      height: 25,
      zIndex: 1,
      textProperties: {
        text: "Executive Producer",
        fontFamily: "Inter Variable",
        fontSize: 18,
        color: "#94A3B8",
        fontWeight: 400,
        align: "left",
      },
    };

    const lowerThirdTemplate: TemplateDefinition = {
      id: "clean-lower-third-v1",
      version: 1,
      displayName: "Clean Creator Lower Third",
      category: "lower-third",
      canvasWidth: 1920,
      canvasHeight: 1080,
      defaultDuration: 5.0,
      elements: [backgroundElement, nameElement, titleElement],
    };

    expect(lowerThirdTemplate.elements).toHaveLength(3);
    expect(lowerThirdTemplate.elements!.filter((e) => e.kind === "text")).toHaveLength(2);
    expect(lowerThirdTemplate.elements!.filter((e) => e.kind === "solid")).toHaveLength(1);
  });
});
