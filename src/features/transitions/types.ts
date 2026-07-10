/**
 * Transitions Types
 * Source of truth for transition data shapes in the editor app.
 *
 * Transitions are served via the Clypra API (GET /transitions/:category).
 * The engine package provides the renderer/shader logic; all preset *data*
 * lives in Cloudflare R2 and is fetched through the API.
 */

// Legacy compatibility re-exports for timeline/playback code that uses the engine's runtime types
export type { TransitionPreset, TransitionParameters, EasingFunction, AppliedTransition } from "@clypra/engine/transitions";

// Legacy type for backwards compatibility with timeline
export type TransitionType = "fade" | "dissolve" | "slide" | "wipe" | "zoom" | "creative";

/**
 * A transition asset as returned by the Clypra API.
 * Renderer is a plain string ID (e.g. "cross-dissolve", "glitch-warp") that the
 * TransitionRenderer engine looks up when applying the effect — no engine type coupling here.
 */
export interface TransitionAsset {
  id: string;
  name: string;
  type: "transition";
  category: string;
  description: string;
  thumbnail: string;
  preview: string;
  /** Renderer identifier — resolved by the engine's TransitionRenderer at playback time */
  renderer: string;
  params?: Record<string, any>;
  easing?: string;
  duration?: {
    min: number;
    max: number;
    default: number;
    step?: number;
  };
  tags?: string[];
  isPremium?: boolean;
  published?: boolean;
}

export interface TransitionCategory {
  id: string;
  name: string;
  description: string;
}
