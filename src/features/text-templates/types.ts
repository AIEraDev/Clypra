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
  "countdown"
] as const;

export type AnimationPreset =
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale-in"
  | "scale-out"
  | "blur-in"
  | "blur-out"
  | "typewriter"
  | "none";

export interface LayerAnimation {
  in: AnimationPreset;
  out: AnimationPreset;
  inDuration: number;
  outDuration: number;
  hold: "full" | number;
}

export interface TextLayer {
  kind: "text";
  id: string;
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  x: number;
  y: number;
  width: number;
  height: number;
  role?: "primary" | "secondary" | "accent";
  overflow?: "wrap" | "shrink" | "expand-panel" | "clip";
  verticalAlign?: "top" | "middle" | "bottom";
  fontWeight: number;
  animation: LayerAnimation;
}

export interface ShapeLayer {
  kind: "shape";
  id: string;
  shape: "rect" | "line" | "circle";
  fill: string;
  stroke?: { color: string; width: number };
  x: number;
  y: number;
  width: number;
  height: number;
  animation: LayerAnimation;
}

export interface ImageLayer {
  kind: "image";
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  animation: LayerAnimation;
}

export type TemplateLayer = TextLayer | ShapeLayer | ImageLayer;

export interface TextTemplate {
  id: string;
  label: string;
  name?: string;             // backwards compatibility
  category: TemplateCategory;
  duration: number;          // seconds
  canvasWidth: number;       // design canvas (e.g. 1080)
  canvasHeight: number;      // design canvas (e.g. 1920 for 9:16)
  thumbnail: string;         // static preview URL
  preview: string;           // short loop video URL
  layers: TemplateLayer[];   // ordered bottom to top
  
  // Optional and legacy properties for backwards compatibility
  lottieData?: any;
  templateData?: any;
  thumbnailUrl?: string;
  thumbnailFrame?: number;
  durationFrames?: number;
  description?: string;
  tags?: string[];
  fps?: number;
  width?: number;
  height?: number;
  textLayers?: any[];
  defaultPlacement?: string;
  lottieFile?: string;
  published?: boolean;
  creatorName?: string;
  creatorLink?: string;
}

// Map TemplateDefinition to TextTemplate for backwards compatibility
export type TemplateDefinition = TextTemplate;

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
