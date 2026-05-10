/**
 * Core NLE engine - compositor, timeline, and render modules.
 *
 * This is the foundation of the editor, separate from React/UI.
 * All rendering, validation, and timeline logic flows through here.
 *
 * Architecture:
 * - /compositor - Time-based frame resolution
 * - /timeline - Bridge between store and compositor
 * - /render - Fallback strategies and rendering utilities
 *
 * One source of truth for:
 * - Preview rendering
 * - Export rendering
 * - Thumbnail generation
 * - Proxy rendering
 * - Timeline validation
 */

// Compositor (core engine)
export * from "./compositor";

// Timeline (adapter layer)
export * from "./timeline";

// Render (fallback strategies)
export * from "./render";
