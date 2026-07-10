/**
 * Filters Types
 * Type definitions for color grading filters
 */

export interface FilterAsset {
  id: string;
  name: string;
  type: "filter";
  category: string;
  description: string;
  thumbnail: string;

  // ── GPU GLSL path — primary renderer (ColorAdjustmentsEffect uniforms) ──
  gradingParams?: {
    exposure?:       number;
    brightness?:     number;
    contrast?:       number;
    saturation?:     number;
    temperature?:    number;
    tint?:           number;
    sepia?:          number;
    grayscale?:      number;
    hueRotate?:      number;
    invert?:         number;
    vignette?:       number;
    blur?:           number;
    lift?:           number;
    vibrance?:       number;
    grainIntensity?: number;
    grainSize?:      number;
    crossProcess?:   number;
  };

  // ── V2 MPG path (MPG Playground output) ────────────────────────────────
  pipeline?: "v2";
  effectStack?: Array<{ type: string; params?: Record<string, unknown> }>;

  url?: string;
  lut?: string;
  tags?: string[];
  isPremium?: boolean;
  intensity?: {
    min: number;
    max: number;
    default: number;
    step: number;
  };
}

export interface FilterCategory {
  id: string;
  name: string;
  description: string;
}

export interface AppliedFilter {
  id: string;
  filterId: string;
  intensity: number;
  params?: Record<string, any>;
}
