/**
 * Transitions Feature
 * Public exports for transition functionality
 */

export { TransitionRenderer } from "./TransitionRenderer";
export { TransitionsApi } from "./api/transitionsApi";
export { transitionCacheManager } from "./cache/transitionCache";
export type { TransitionType, TransitionAsset, TransitionCategory, AppliedTransition } from "./types";
export type { CachedTransition, TransitionDownloadProgress } from "./cache/transitionCache";
