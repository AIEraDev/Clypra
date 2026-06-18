export interface TextLayer {
  layerName: string; // matches Lottie layer nm field
  defaultText: string; // placeholder shown before user types
  maxCharacters: number; // hard cap — longer text breaks layout
  role: "primary" | "secondary" | "accent";
}

export interface TemplateCustomization {
  primaryText: string;
  secondaryText?: string;
  accentText?: string;
  primaryColor?: string; // hex — overrides Lottie color if supported
  secondaryColor?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  tags: string[];

  // Animation properties
  durationFrames: number; // total frames
  fps: number; // frames per second (24 or 30)
  width: number; // canvas width in px
  height: number; // canvas height in px

  // Text injection points
  textLayers: TextLayer[];

  // Where this template sits on video
  defaultPlacement: "lower-third" | "center" | "top" | "full-frame";

  // File reference
  lottieFile: string; // relative path to .json

  // Preview thumbnail (first frame or keyframe)
  thumbnailFrame: number; // which frame to use as picker thumbnail
  thumbnail?: string; // URL to thumbnail image (from API)
  thumbnailUrl?: string; // Alternative field name for thumbnail URL

  lottieData?: any; // The imported JSON payload for the animation
}

export const TEMPLATE_CATEGORIES = ["title", "lower-third", "caption", "callout", "social", "outro"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export interface RenderedFrameSequence {
  frames: Blob[]; // PNG blobs, one per frame
  fps: number;
  width: number;
  height: number;
  durationFrames: number;
}
