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

  // ── Legacy CSS path (backwards compatibility) ──────────────────────────
  swatch?: string; // CSS filter string: "brightness(1.1) saturate(1.2)"

  // ── New GLSL path (Filter Lab output) ──────────────────────────────────
  // When gradingParams is present, WebGL renderer uses these instead of swatch
  gradingParams?: {
    exposure?: number; // -1.0 to 1.0 → maps to uExposure
    brightness?: number; // -1.0 to 1.0 → maps to uBrightness
    contrast?: number; // -1.0 to 1.0 → maps to uContrast
    saturation?: number; // -1.0 to 1.0 → maps to uSaturation
    temperature?: number; // -1.0 to 1.0 → maps to uTemperature blend
    tint?: number; // -1.0 to 1.0 → maps to uTint blend
    sepia?: number; // 0.0 to 1.0
    grayscale?: number; // 0.0 to 1.0
    hueRotate?: number; // 0.0 to 6.28318 (radians)
    invert?: number; // 0.0 to 1.0
    vignette?: number; // 0.0 to 1.0 → maps to uVignette
    blur?: number; // 0.0 to 15.0 (pixels)
  };

  // ── V2 MPG path (Filter Lab / MPG Playground output) ─────────────────────
  pipeline?: "v2";
  effectStack?: Array<{ type: string; params?: Record<string, unknown> }>;

  url?: string;

  // LUT file
  lut?: string;

  // Metadata
  tags?: string[];
  isPremium?: boolean;

  // UI hints
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
