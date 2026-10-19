/**
 * Determines whether a paused preview frame may use the retained native
 * surface. The native child surface is above WebView DOM, so it cannot be
 * shown while an editor overlay needs to remain visible.
 */
export interface PausedNativeSurfaceEligibilityInput {
  surfaceUsable: boolean;
  qualificationForcesWebView: boolean;
  hasSelectedClip: boolean;
  hasSelectedTransition: boolean;
  hasSelectedGap: boolean;
  safeOverlayVisible: boolean;
  karaokeOverlayVisible: boolean;
  previewMenuOpen: boolean;
}

/**
 * A paused native frame is safe only for a clean program monitor. This keeps
 * transform handles, captions, safe areas, and menus on the established
 * WebView/canvas route rather than allowing a child window to cover them.
 */
export function canPresentPausedFrameOnNativeSurface(
  input: PausedNativeSurfaceEligibilityInput,
): boolean {
  return (
    input.surfaceUsable &&
    !input.qualificationForcesWebView &&
    !input.hasSelectedClip &&
    !input.hasSelectedTransition &&
    !input.hasSelectedGap &&
    !input.safeOverlayVisible &&
    !input.karaokeOverlayVisible &&
    !input.previewMenuOpen
  );
}

/**
 * A selected clip (or another DOM overlay) requires the canvas presenter, but
 * it must not create a black interval while the exact paused readback is in
 * flight. The retained native image remains the visual continuity layer until
 * the canvas reports its first paint.
 */
export function shouldRetainNativeSurfaceForPausedCanvasHandover(input: {
  isPaused: boolean;
  surfaceShown: boolean;
  surfaceUsable: boolean;
  hasNativeRequest: boolean;
  nativeDirectSurfacePath: boolean;
}): boolean {
  return (
    input.isPaused &&
    input.surfaceShown &&
    input.surfaceUsable &&
    input.hasNativeRequest &&
    !input.nativeDirectSurfacePath
  );
}

/** Canvas rendering is allowed behind a still-visible native child surface
 * during a pause handover; it becomes the replacement before the child is
 * hidden. */
export function shouldRenderPausedCanvasDuringNativeHandover(
  pendingHandoverSurfaceHide: boolean,
): boolean {
  return pendingHandoverSurfaceHide;
}
