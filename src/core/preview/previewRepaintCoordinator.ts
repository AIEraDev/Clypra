/**
 * previewRepaintCoordinator
 *
 * Decouples preview render-invalidation and repaint requests from the React component tree.
 * Allows interaction layers, stores, menus, and overlays to request a repaint of the
 * active preview surface without importing NativeProgramPreview directly.
 */

type RepaintHandler = () => void;

let _repaintHandler: RepaintHandler | null = null;
let _pendingRepaint = false;

/**
 * Registers the active preview render loop's repaint handler.
 * If a repaint was requested before the render loop mounted, it is executed immediately.
 */
export function registerPreviewRepaintHandler(handler: RepaintHandler): () => void {
  _repaintHandler = handler;
  if (_pendingRepaint) {
    _pendingRepaint = false;
    try {
      handler();
    } catch (e) {
      console.warn("[previewRepaintCoordinator] Failed executing pending repaint:", e);
    }
  }
  return () => {
    if (_repaintHandler === handler) {
      _repaintHandler = null;
    }
  };
}

/**
 * Request an immediate or next-RAF repaint of the active program preview.
 * Safe to call at any time, even before the preview render loop is mounted.
 */
export function requestPreviewRepaint(): void {
  if (_repaintHandler) {
    _repaintHandler();
  } else {
    _pendingRepaint = true;
  }
}

/**
 * Check if a repaint is currently pending execution.
 * (Primarily useful for testing).
 */
export function isPreviewRepaintPending(): boolean {
  return _pendingRepaint;
}

/**
 * Reset coordinator state (for test isolation).
 */
export function resetPreviewRepaintCoordinator(): void {
  _repaintHandler = null;
  _pendingRepaint = false;
}

/**
 * Backward-compatible alias for existing callers.
 */
export const forceRepaintNativeProgramPreview = requestPreviewRepaint;
