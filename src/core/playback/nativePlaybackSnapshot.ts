import type { NativeFrameRequest } from "@/lib/platform/nativeCore";

/**
 * Identity for the retained Rust render graph.
 *
 * The structural key decides "does the native worker need to restart".
 * It captures the hardware video stream decoding configuration, canvas
 * format, project revision, and transition graph.
 *
 * Overlay layers (text, stickers, and dynamic rasters) are composited on
 * top of decoded video frames and are driven dynamically per-frame via
 * NativePlaybackFrameDemand. They must NOT invalidate or restart the
 * persistent playback worker, as doing so purges the lookahead video queue
 * and causes cold decode freezes when clips enter or exit.
 */
export function buildNativePlaybackSnapshotKey(request: NativeFrameRequest): string {
  const project = request.project;

  return JSON.stringify({
    contractVersion: request.contractVersion,
    renderGraphVersion: request.renderGraphVersion,
    outputWidth: request.outputWidth,
    outputHeight: request.outputHeight,
    quality: request.quality,
    colorPolicy: request.colorPolicy,
    project: {
      schemaVersion: project.schemaVersion,
      frameRate: project.frameRate,
      canvasWidth: project.canvasWidth,
      canvasHeight: project.canvasHeight,
      clearColor: project.clearColor,
      videoLayers: project.videoLayers.map((layer) => ({
        layerId: layer.layerId,
        assetId: layer.assetId,
        videoPath: layer.videoPath,
      })),
      transition: project.transition
        ? {
            outgoingLayer: project.transition.outgoingLayer,
            incomingLayer: project.transition.incomingLayer,
            transitionType: project.transition.transitionType,
          }
        : null,
    },
  });
}
