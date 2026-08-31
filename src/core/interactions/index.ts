/**
 * Interactions - Imperative interaction controllers
 *
 * High-frequency user interactions (transform, viewport) that operate
 * at >4Hz and should not trigger React re-renders on every update.
 */

export {
  TransformController,
  getTransformController,
  resetTransformController,
  type DragGeometry,
  type TransformListener,
} from "./TransformController";

export { ViewportController, getViewportController, resetViewportController, type Viewport, type ViewportListener } from "./ViewportController";

export { EditingActions } from "./EditingActions";

export {
  PreviewInteractionCoordinator,
  getPreviewInteractionCoordinator,
  resetPreviewInteractionCoordinator,
  type PreviewGeneration,
  type PreviewInteractionCancelReason,
  type PreviewInteractionKind,
  type PreviewInteractionOptions,
  type PreviewInteractionSnapshot,
  type PreviewInteractionToken,
  type PreviewTransportBridge,
} from "./PreviewInteractionCoordinator";

export {
  createLatestFrameQueue,
  createCoalescedPointerDrag,
  type CoalescedFrameQueue,
  type CoalescedPointerDrag,
} from "./coalescedPointerDrag";
