/**
 * Video Effects Type System
 *
 * Only Video Effects (renderer-based) and Body Effects
 */

export type EffectCategory = "video-effect" | "body-effect";

// ============================================================================
// EFFECT PRESETS (Behavior-driven: JSON definitions)
// ============================================================================

export type EffectRenderer =
  // Visual effects
  | "blur"
  | "motion_blur"
  | "radial_blur"
  | "zoom_blur"

  // Color/Style effects
  | "vhs"
  | "glitch"
  | "rgb_split"
  | "chromatic_aberration"
  | "film_grain"
  | "scanlines"
  | "crt"
  | "pixelate"

  // Distortion effects
  | "wave"
  | "ripple"
  | "bulge"
  | "twist"
  | "fisheye"

  // Light effects
  | "flash"
  | "flicker"
  | "vignette"
  | "glow"
  | "light_leak"
  | "light_leak_2"
  | "fire"
  | "particles"
  | "dust_particles"

  // Time effects
  | "speed_ramp"
  | "freeze_frame"
  | "echo"
  | "strobe"

  // Body-tracked effects
  | "body-segmentation-glow"
  | "body_glow"
  | "body_outline"
  | "body_particles";

export interface EffectPreset {
  id: string;
  name: string;
  type: "video-effect" | "body-effect";
  category: string; // "essentials", "glitch", "retro", "light", "motion", "color", "body" etc.
  description: string;
  thumbnail: string;

  // The renderer that generates this effect
  renderer: EffectRenderer;

  // Parameters for the renderer
  params: EffectParameters;

  // Metadata
  tags: string[];
  isPremium?: boolean;

  // UI hints
  intensity: {
    min: number;
    max: number;
    default: number;
    step: number;
  };

  requirements?: {
    bodySegmentation?: boolean;
    minConfidence?: number;
  };
}

// ============================================================================
// TRANSITIONS (Behavior-driven: JSON definitions)
// ============================================================================

export type TransitionRenderer =
  // Basic
  "fade" | "dissolve";

// ============================================================================
// SHARED TYPES
// ============================================================================

export type EasingFunction = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out" | "ease-in-quad" | "ease-out-quad" | "ease-in-out-quad" | "ease-in-cubic" | "ease-out-cubic" | "ease-in-out-cubic" | "ease-in-quart" | "ease-out-quart" | "ease-in-out-quart" | "spring" | "bounce";

// ============================================================================
// PARAMETER TYPES (for runtime rendering)
// ============================================================================

export interface EffectParameters {
  // Effect intensity
  intensity?: number; // 0-100
  frequency?: number; // Hz

  // Blur
  blurAmount?: number; // pixels
  direction?: number; // degrees for motion blur

  // VHS/Glitch
  glitchIntensity?: number;
  scanlineCount?: number;
  noiseAmount?: number;
  colorOffset?: number;

  // RGB Split
  splitDistance?: number;
  angle?: number;

  // Speed ramp
  startSpeed?: number;
  endSpeed?: number;
  curve?: EasingFunction;

  // Zoom
  scale?: number;
  centerX?: number; // 0-1
  centerY?: number; // 0-1

  // Flash
  flashColor?: string;
  flashIntensity?: number;

  // Film grain
  grainSize?: number;
  grainIntensity?: number;

  // Fire
  fireHeight?: number;
  particleCount?: number;
  fireColor1?: string;
  fireColor2?: string;
  fireColor3?: string;

  // Particles
  particleSize?: number;
  particleColor?: string;
  driftSpeed?: number;
  fadeEffect?: boolean;

  // Generic
  [key: string]: any;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export type VideoEffectItem = EffectPreset;

export interface VideoEffectCategory {
  id: string;
  name: string;
  type: EffectCategory;
  description: string;
  thumbnail: string;
  itemCount: number;
}

export interface VideoEffectManifest {
  categories: VideoEffectCategory[];
  featured: VideoEffectItem[];
  version: string;
}

// ============================================================================
// APPLIED EFFECT TYPES (for timeline clips)
// ============================================================================

export interface AppliedEffect {
  id: string;
  effectId: string;
  type: "video-effect" | "body-effect";
  renderer: EffectRenderer;
  params: EffectParameters;

  // Timing
  startTime: number; // relative to clip
  duration: number;

  // Intensity envelope (for keyframing)
  intensity: number; // 0-1
  keyframes?: Array<{
    time: number;
    intensity: number;
    easing: EasingFunction;
  }>;
}

// ============================================================================
// STORE TYPES
// ============================================================================

export interface VideoEffectState {
  // Manifests
  manifest: VideoEffectManifest | null;
  categories: Record<string, VideoEffectItem[]>;

  // Loading states
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  // User favorites
  favorites: Set<string>;
}
