import { describe, it, expect } from "vitest";
import { instantiateTemplate, applyTemplateStyle } from "../instantiateTemplate";
import { expandCompoundClips } from "@/core/timeline/compoundClips";
import { normalizeTextTemplateArtifact } from "@clypra-studio/engine";
import type { TemplateDefinition } from "../types";
import type { TextClip } from "@/types";

describe("Template Instantiation via Compound Clip Reuse (§1, §2, §3)", () => {
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
          text: "DEFAULT HEADLINE",
          fontFamily: "Inter Variable",
          fontSize: 64,
          color: "#FFFFFF",
          align: "center",
          fontWeight: 700,
          styleId: "neon-glow",
          styleVersion: 1,
          parameterOverrides: { glowStrength: 0.75 },
          styleDefinition: { id: "neon-glow", version: "4" } as any,
        },
      },
    ],
  };

  const lowerThirdTemplate: TemplateDefinition = {
    id: "creator-lower-third-v1",
    version: 1,
    displayName: "Creator Lower Third",
    category: "lower-third",
    canvasWidth: 1920,
    canvasHeight: 1080,
    defaultDuration: 5.0,
    elements: [
      {
        id: "bg-solid",
        kind: "solid",
        relativePosition: { x: 100, y: 850 },
        width: 500,
        height: 90,
        zIndex: 0,
        solidProperties: {
          color: "#1E293B",
          opacity: 0.9,
        },
      },
      {
        id: "name-text",
        kind: "text",
        relativePosition: { x: 120, y: 865 },
        width: 460,
        height: 40,
        zIndex: 1,
        textProperties: {
          text: "Jane Doe",
          fontFamily: "Outfit Variable",
          fontSize: 32,
          color: "#FFFFFF",
          fontWeight: 700,
          align: "left",
        },
      },
      {
        id: "role-text",
        kind: "text",
        relativePosition: { x: 120, y: 905 },
        width: 460,
        height: 25,
        zIndex: 1,
        textProperties: {
          text: "Senior Architect",
          fontFamily: "Inter Variable",
          fontSize: 18,
          color: "#94A3B8",
          fontWeight: 400,
          align: "left",
        },
      },
    ],
  };

  it("instantiates single-element template as a compound clip with 1 child text clip", () => {
    const compoundClip = instantiateTemplate(singleElementTemplate, {
      trackId: "track-text-1",
      startTime: 3.5,
    });

    expect(compoundClip.kind).toBe("compound");
    expect(compoundClip.trackId).toBe("track-text-1");
    expect(compoundClip.startTime).toBe(3.5);
    expect(compoundClip.duration).toBe(4.0);
    expect(compoundClip.compoundChildren).toHaveLength(1);

    const childText = compoundClip.compoundChildren![0] as TextClip;
    expect(childText.kind).toBe("text");
    expect(childText.text).toBe("DEFAULT HEADLINE");
    expect(childText.fontFamily).toBe("Inter Variable");
    expect(childText.fontSize).toBe(64);
    expect(childText.styleId).toBe("neon-glow");
    expect(childText.styleVersion).toBe(1);
    expect(childText.parameterOverrides).toEqual({ glowStrength: 0.75 });
    expect(childText.templateId).toBe("minimal-title-v1");
    expect(childText.templateVersion).toBe(1);
    expect(compoundClip.templateId).toBe("minimal-title-v1");
    expect(compoundClip.templateVersion).toBe(1);
    expect(childText.startTime).toBe(0); // relative to parent
    expect(childText.duration).toBe(4.0);
  });

  it("pins template revision and snapshot on every instantiated child", () => {
    const revisionedTemplate = {
      ...singleElementTemplate,
      revision: {
        assetId: "minimal-title-v1",
        revisionId: "rev-17",
        contentHash: "fnv1a-template-17",
      },
      dependencies: [{
        effectId: "neon-glow",
        revisionId: "effect-rev-4",
        contentHash: "fnv1a-effect-4",
      }],
    } as any;

    const compoundClip = instantiateTemplate(revisionedTemplate, { trackId: "track-1", startTime: 0 });
    const childText = compoundClip.compoundChildren![0] as TextClip;

    expect(childText.templateRevisionId).toBe("rev-17");
    expect(childText.templateContentHash).toBe("fnv1a-template-17");
    expect(childText.templateSnapshot).toEqual(revisionedTemplate);
    expect(childText.templateDependencies).toEqual(revisionedTemplate.dependencies);
  });

  it("derives a child style version from its pinned definition when omitted", () => {
    const template: TemplateDefinition = {
      ...singleElementTemplate,
      id: "versioned-title",
      elements: [
        {
          ...singleElementTemplate.elements![0],
          textProperties: {
            ...singleElementTemplate.elements![0].textProperties!,
            styleVersion: undefined,
            styleDefinition: { id: "neon-glow", version: 9 } as any,
          },
        },
      ],
    };

    const compoundClip = instantiateTemplate(template, { trackId: "text-track", startTime: 0 });
    expect((compoundClip.compoundChildren![0] as TextClip).styleVersion).toBe(9);
  });

  it("instantiates multi-element template (solid + multiple texts) with exact hierarchy and zIndex", () => {
    const compoundClip = instantiateTemplate(lowerThirdTemplate, {
      trackId: "track-lower-third",
      startTime: 10.0,
      customization: {
        primaryText: "Alex Mercer",
        secondaryText: "Lead Developer",
      },
    });

    expect(compoundClip.kind).toBe("compound");
    expect(compoundClip.startTime).toBe(10.0);
    expect(compoundClip.duration).toBe(5.0);
    expect(compoundClip.compoundChildren).toHaveLength(3);

    const [solidChild, nameChild, roleChild] = compoundClip.compoundChildren!;
    expect(solidChild.kind).toBe("image");
    expect(solidChild.zIndex).toBe(0);

    expect((nameChild as TextClip).kind).toBe("text");
    expect((nameChild as TextClip).text).toBe("Alex Mercer"); // Applied primary customization
    expect((nameChild as TextClip).fontSize).toBe(32);

    expect((roleChild as TextClip).kind).toBe("text");
    expect((roleChild as TextClip).text).toBe("Lead Developer"); // Applied secondary customization
    expect((roleChild as TextClip).fontSize).toBe(18);
  });

  it("retains template image URLs when no media-library asset ID is provided", () => {
    const imageUrl = "https://cdn.example.com/brand-mark.png";
    const compoundClip = instantiateTemplate(
      {
        id: "image-title-v1",
        version: 2,
        category: "title-card",
        canvasWidth: 1920,
        canvasHeight: 1080,
        elements: [
          {
            id: "brand-mark",
            kind: "image",
            relativePosition: { x: 20, y: 20 },
            width: 160,
            height: 160,
            imageProperties: { url: imageUrl },
          },
        ],
      },
      { trackId: "track-image", startTime: 0 },
    );

    expect(compoundClip.compoundChildren?.[0]).toMatchObject({
      kind: "image",
      mediaUrl: imageUrl,
      templateVersion: 2,
    });
  });

  it("seamlessly expands via standard expandCompoundClips without any custom composition layer (§2)", () => {
    const compoundClip = instantiateTemplate(lowerThirdTemplate, {
      trackId: "track-1",
      startTime: 12.0,
    });

    // Run standard Clypra timeline compound clip expansion
    const expanded = expandCompoundClips([compoundClip]);

    expect(expanded).toHaveLength(3);
    // Every expanded child must resolve to the absolute timeline start time (12.0s)
    expanded.forEach((child) => {
      expect(child.startTime).toBe(12.0);
      expect(child.duration).toBe(5.0);
      expect(child.trackId).toBe("track-1");
    });
  });

  it("detaches on instantiation: mutations to template definition do not affect existing clip (§3)", () => {
    const templateCopy = JSON.parse(JSON.stringify(singleElementTemplate));
    const compoundClip = instantiateTemplate(templateCopy, {
      trackId: "track-1",
      startTime: 0,
    });

    // Mutate source template definition
    templateCopy.elements[0].textProperties.fontSize = 120;
    templateCopy.elements[0].textProperties.color = "#FF0000";

    const childText = compoundClip.compoundChildren![0] as TextClip;
    expect(childText.fontSize).toBe(64); // Preserved pinned creation-time value
    expect(childText.color).toBe("#FFFFFF");
  });

  it("applies template style to an existing text clip while preserving user text content (§1)", () => {
    const userExistingClip: TextClip = {
      id: "clip-user-1",
      name: "Custom Note",
      kind: "text",
      trackId: "track-1",
      startTime: 2.0,
      duration: 3.0,
      trimIn: 0,
      trimOut: 0,
      mediaId: "clip-user-1",
      text: "MY CUSTOM USER TEXT THAT MUST NOT BE LOST",
      fontFamily: "Arial",
      fontSize: 20,
      color: "#00FF00",
      align: "center",
      valign: "middle",
      paddingX: 0,
      paddingY: 0,
      lineHeight: 1.2,
      x: 100,
      y: 100,
      width: 400,
      height: 60,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
    };

    const restyledClip = applyTemplateStyle(userExistingClip, singleElementTemplate);

    // Text content is untouched
    expect(restyledClip.text).toBe("MY CUSTOM USER TEXT THAT MUST NOT BE LOST");
    // Typography and style adopted from template
    expect(restyledClip.fontFamily).toBe("Inter Variable");
    expect(restyledClip.fontSize).toBe(64);
    expect(restyledClip.color).toBe("#FFFFFF");
    expect(restyledClip.styleId).toBe("neon-glow");
    expect(restyledClip.fontWeight).toBe(700);
    expect(restyledClip.styleVersion).toBe(1);
    expect(restyledClip.parameterOverrides).toEqual({ glowStrength: 0.75 });
    expect(restyledClip.styleDefinition).toEqual({ id: "neon-glow", version: "4" });
  });

  it("preserves multi-line user text and existing clip IDs when applying a multi-element template style", () => {
    const multiLineClip: TextClip = {
      id: "clip-multiline-42",
      name: "Speaker Quote",
      kind: "text",
      trackId: "track-2",
      startTime: 5.0,
      duration: 4.0,
      trimIn: 0,
      trimOut: 0,
      mediaId: "clip-multiline-42",
      text: "Line 1: Special Keynote\nLine 2: Product Announcement\nLine 3: 2026 Roadmap",
      fontFamily: "Times New Roman",
      fontSize: 16,
      color: "#FF5500",
      align: "right",
      valign: "middle",
      paddingX: 0,
      paddingY: 0,
      lineHeight: 1.2,
      x: 200,
      y: 300,
      width: 500,
      height: 120,
      rotation: 0,
      opacity: 1,
      zIndex: 2,
    };

    const restyled = applyTemplateStyle(multiLineClip, lowerThirdTemplate);

    // Identity and user-authored multi-line text are strictly preserved
    expect(restyled.id).toBe("clip-multiline-42");
    expect(restyled.text).toBe("Line 1: Special Keynote\nLine 2: Product Announcement\nLine 3: 2026 Roadmap");
    // Style from primary text element of lowerThirdTemplate ("Outfit Variable", 32px, #FFFFFF, 700) is applied
    expect(restyled.fontFamily).toBe("Outfit Variable");
    expect(restyled.fontSize).toBe(32);
    expect(restyled.color).toBe("#FFFFFF");
    expect(restyled.fontWeight).toBe(700);
    expect(restyled.align).toBe("left");
  });

  it("keeps canonical template instances as one pinned clip through runtime evaluation", () => {
    const artifact = normalizeTextTemplateArtifact({
      id: "canonical-title",
      label: "Canonical Title",
      category: "title-card",
      duration: 3,
      nodes: [{ id: "headline", name: "Headline", type: "text", x: 0, y: 0, width: 800, height: 120, text: "Hello", style: { fontFamily: "Inter", fontSize: 64, textColor: "#fff" } }],
    });
    const clip = instantiateTemplate(artifact as any, { trackId: "track-1", startTime: 0 });
    expect(clip.kind).toBe("text-template");
    expect(clip.compoundChildren).toBeUndefined();
    expect(expandCompoundClips([clip])[0]).toMatchObject({ kind: "text-template", templateId: "canonical-title" });
  });
});
