/**
 * Body Effects Feature
 * Public exports for ML-powered body segmentation effects
 */

export { segmentBodyMask, makeBodyMaskCacheKey, createCutoutCanvas } from "./segmentation/bodySegmentationWorkerClient";
export { bodyMaskCache, BodyMaskCache } from "./segmentation/maskCache";

export type { BodySegmentationOptions, BodySegmentationRequest, BodySegmentationResponse } from "./segmentation/types";

export * from "./bake/clymatteClient";
export * from "./bake/clymatteStore";
export * from "./capabilities";
export * from "./capture/cadenceDecimator";
export * from "./capture/hybridJoinCoordinator";
export * from "./capture/bodyCaptureClient";
export * from "./cache/assetBundleManager";

