import { DEFAULT_STILL_DURATION_SECONDS } from "../constants/config";
import type { Clip, MediaAsset } from "../types";

export const resolveClipDuration = (asset: MediaAsset): number => {
  if (asset.type === "image") return DEFAULT_STILL_DURATION_SECONDS;
  if (asset.duration > 0) return asset.duration;
  return DEFAULT_STILL_DURATION_SECONDS;
};

interface CreateClipFromAssetParams {
  asset: MediaAsset;
  trackId: string;
  startTime: number;
  width: number;
  height: number;
}

export const createClipFromAsset = ({ asset, trackId, startTime, width, height }: CreateClipFromAssetParams): Clip => {
  const duration = resolveClipDuration(asset);

  return {
    id: `clip-${Date.now()}-${Math.random()}`,
    trackId,
    mediaId: asset.id,
    startTime,
    duration,
    trimIn: 0,
    trimOut: duration,
    x: 0,
    y: 0,
    width,
    height,
    opacity: 1,
    rotation: 0,
  };
};
