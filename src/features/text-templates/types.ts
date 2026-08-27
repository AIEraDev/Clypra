/**
 * Text Template Architecture Contracts (§3)
 *
 * A template is a composition of:
 * - 1+ TemplateElements (Text, SolidBackground, Image)
 * - relative positions within template bounds
 * - ClipTextProperties / EffectDefinition references
 *
 * Instantiating a template creates a real timeline compound clip (§2),
 * with pinned properties (detach on instantiation, §3).
 */

export type TemplateCategory =
  | "lower-third"    // name + title bars — most used in creator content
  | "title-card"     // full-screen openers
  | "caption"        // subtitle-style, bottom of frame
  | "callout"        // arrow + label pointing to something
  | "social"         // follow/subscribe CTAs
  | "countdown";     // timer overlays

export const TEMPLATE_CATEGORIES = [
  "lower-third",
  "title-card",
  "caption",
  "callout",
  "social",
  "countdown",
] as const;

export type ElementKind = "text" | "solid" | "image";

export interface TemplateTextProperties {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  letterSpacing?: number;
  lineHeight?: number;
  styleId?: string; // Reference to EffectDefinition ID
  styleVersion?: number;
  parameterOverrides?: Record<string, any>;
  /** Optional embedded definition used to keep instantiated clips reproducible. */
  styleDefinition?: import("@clypra-studio/engine").TextEffectDefinition;
  animation?: {
    preset: "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "scale" | "zoom" | "none";
    duration: number;
  };
}

export interface TemplateSolidProperties {
  color: string;
  borderRadius?: number;
  opacity?: number;
}

export interface TemplateImageProperties {
  url?: string;
  assetId?: string;
  opacity?: number;
}

export interface TemplateElement {
  id: string;
  kind: ElementKind;
  /** Relative position (x, y) offset from template center or origin */
  relativePosition: { x: number; y: number };
  width: number;
  height: number;
  zIndex?: number;
  textProperties?: TemplateTextProperties;
  solidProperties?: TemplateSolidProperties;
  imageProperties?: TemplateImageProperties;
}

export interface TemplateDefinition {
  id: string;
  version?: number;
  displayName?: string;
  category: TemplateCategory;
  description?: string;
  thumbnailUrl?: string;
  previewVideoUrl?: string;
  canvasWidth: number;
  canvasHeight: number;
  defaultDuration?: number;
  elements?: TemplateElement[];

  // Compatibility fields for legacy templates
  name?: string;
  label?: string;
  thumbnail?: string;
  preview?: string;
  duration?: number;
  durationFrames?: number;
  thumbnailFrame?: number;
  layers?: any[];
  templateData?: any;
  lottieData?: any;
  tags?: string[];
  fps?: number;
  width?: number;
  height?: number;
  textLayers?: any[];
  defaultPlacement?: string;
  lottieFile?: string;
  [key: string]: any;
}

// Backwards compatibility alias
export type TextTemplate = TemplateDefinition;

export interface TemplateCustomization {
  primaryText: string;
  secondaryText?: string;
  accentText?: string;
  primaryColor?: string; // hex
  secondaryColor?: string;
  layerColors?: Record<string, string>;
  layerFontSizes?: Record<string, number>;
  layerFontWeights?: Record<string, string | number>;
  layerTexts?: Record<string, string>;
}

export interface RenderedFrameSequence {
  frames: Blob[]; // PNG blobs, one per frame
  fps: number;
  width: number;
  height: number;
  durationFrames: number;
}
