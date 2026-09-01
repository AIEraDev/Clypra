import type { NativeFrameRequest } from "@/lib/platform/nativeCore";

/**
 * Identity for the retained Rust render graph.
 *
 * Frame time, source time, placement, opacity, and transition progress are
 * demand values and must not reconfigure the session every frame. Immutable
 * resources are different: when a text raster finishes preparation, its
 * asset id must invalidate the retained snapshot so Native starts using it.
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
      projectRevision: project.projectRevision,
      frameRate: project.frameRate,
      canvasWidth: project.canvasWidth,
      canvasHeight: project.canvasHeight,
      clearColor: project.clearColor,
      videoLayers: project.videoLayers.map(({ sourceTime: _sourceTime, x: _x, y: _y, width: _width, height: _height, rotation: _rotation, opacity: _opacity, zIndex: _zIndex, ...layer }) => layer),
      // Asset ids are demand values: a prepared animated text bitmap can be
      // swapped through the compact demand without rebuilding the graph.
      // Presence/count remains structural. Asset identity and texture shape
      // are compact demand values and can change without rebuilding the graph.
      rasterLayers: (project.rasterLayers ?? []).map(({ assetId: _assetId, rgba: _rgba, width: _width, height: _height, displayWidth: _displayWidth, displayHeight: _displayHeight, x: _x, y: _y, rotation: _rotation, opacity: _opacity, zIndex: _zIndex, ...layer }) => layer),
      textLayers: (project.textLayers ?? []).map(({ x: _x, y: _y, rotation: _rotation, opacity: _opacity, zIndex: _zIndex, ...layer }) => layer),
      transition: project.transition
        ? (({ progress: _progress, ...transition }) => transition)(project.transition)
        : null,
    },
  });
}
