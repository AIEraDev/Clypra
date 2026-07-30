import type {
  Clip,
  MediaAsset,
  Project,
  Track,
  TransitionTimelineItem,
} from "@/types";
import { toNativePath } from "@/lib/platform/pathConversion";

export interface NativeTimelineClipPlan {
  path: string;
  trimIn: number;
  duration: number;
  frameCount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  volume: number;
}

export interface NativeTimelineExportPlan {
  outputPath: string;
  width: number;
  height: number;
  frameRate: number;
  codec: "h264" | "h265" | "prores";
  preset: "ultrafast" | "fast" | "medium" | "slow" | "veryslow";
  crf: number;
  pixelFormat: "yuv420p" | "yuv444p" | "yuv422p10le";
  totalDuration: number;
  clips: NativeTimelineClipPlan[];
}

interface NativeTimelineExportInput {
  clips: Clip[];
  tracks: Track[];
  transitions: TransitionTimelineItem[];
  assets: MediaAsset[];
  project: Project | null;
  startTime: number;
  endTime: number;
  outputPath: string;
  width: number;
  height: number;
  frameRate: number;
  codec: NativeTimelineExportPlan["codec"];
  preset: NativeTimelineExportPlan["preset"];
  crf: number;
  pixelFormat: NativeTimelineExportPlan["pixelFormat"];
}

export type NativeTimelineExportEligibility =
  | { eligible: true; plan: NativeTimelineExportPlan }
  | { eligible: false; reasons: string[] };

interface NativeTimelineRunCallbacks {
  onProgress?: (progress: {
    currentFrame: number;
    totalFrames: number;
    progress: number;
    etaSeconds: number;
    fps: number;
  }) => void;
  onSessionReady?: (cancel: () => Promise<void>) => void;
}

export interface NativeTimelineRunResult {
  completedFrames: number;
  totalTimeMs: number;
  cancelled: boolean;
  peakRssBytes: number;
}

const roundPlacement = (value: number): number => Math.round(value);

/**
 * Finds cut-only timelines that Rust can normalize and encode without routing
 * every frame through WebKit and Pixi.
 */
export function analyzeNativeTimelineExport(
  input: NativeTimelineExportInput,
): NativeTimelineExportEligibility {
  const reasons: string[] = [];
  const { project, startTime, endTime, frameRate } = input;

  if (!project) {
    return { eligible: false, reasons: ["Project settings are unavailable"] };
  }

  const videoTracks = input.tracks.filter(
    (track) => track.type === "video" && track.visible,
  );
  if (videoTracks.length !== 1) {
    reasons.push("Native export requires exactly one visible video track");
  }

  if (input.transitions.length > 0) {
    reasons.push("Timeline transitions require compositor export");
  }

  const primaryTrackId = videoTracks[0]?.id;
  const activeClips = input.clips
    .filter(
      (clip) =>
        clip.startTime < endTime &&
        clip.startTime + clip.duration > startTime,
    )
    .sort((left, right) => left.startTime - right.startTime);
  const videoClips = activeClips.filter(
    (clip) => clip.trackId === primaryTrackId,
  );

  if (activeClips.length !== videoClips.length) {
    reasons.push("Additional visual or audio clips require compositor export");
  }
  if (videoClips.length === 0) {
    reasons.push("Timeline has no video clips to export");
  }

  const frameTolerance = 0.5 / frameRate;
  let expectedStart = startTime;
  for (const clip of videoClips) {
    if (Math.abs(clip.startTime - expectedStart) > frameTolerance) {
      reasons.push("Video clips must be sequential without gaps or overlaps");
      break;
    }
    expectedStart = clip.startTime + clip.duration;
  }
  if (
    videoClips.length > 0 &&
    Math.abs(expectedStart - endTime) > frameTolerance
  ) {
    reasons.push("Video clips must cover the complete export range");
  }

  for (const clip of videoClips) {
    const asset = input.assets.find((candidate) => candidate.id === clip.mediaId);
    if (!asset || asset.type !== "video" || !asset.path) {
      reasons.push(`Clip ${clip.id} does not reference a local video asset`);
    }
    if (
      clip.opacity !== 1 ||
      clip.rotation !== 0 ||
      (clip.effects?.length ?? 0) > 0 ||
      (clip.overlays?.length ?? 0) > 0 ||
      clip.filter
    ) {
      reasons.push(`Clip ${clip.id} uses compositor-only visual settings`);
    }
  }

  if (reasons.length > 0) {
    return { eligible: false, reasons: [...new Set(reasons)] };
  }

  const scaleX = input.width / project.canvasWidth;
  const scaleY = input.height / project.canvasHeight;
  const clips = videoClips.map((clip): NativeTimelineClipPlan => {
    const asset = input.assets.find(
      (candidate) => candidate.id === clip.mediaId,
    )!;
    const overlapStart = Math.max(startTime, clip.startTime);
    const overlapEnd = Math.min(endTime, clip.startTime + clip.duration);
    const firstFrame = Math.round((overlapStart - startTime) * input.frameRate);
    const endFrame = Math.round((overlapEnd - startTime) * input.frameRate);

    return {
      path: toNativePath(asset.path),
      trimIn: clip.trimIn + overlapStart - clip.startTime,
      duration: overlapEnd - overlapStart,
      frameCount: endFrame - firstFrame,
      x: roundPlacement(clip.x * scaleX),
      y: roundPlacement(clip.y * scaleY),
      width: Math.max(1, roundPlacement(clip.width * scaleX)),
      height: Math.max(1, roundPlacement(clip.height * scaleY)),
      volume: Math.max(0, Math.min(1, clip.volume ?? 1)),
    };
  });

  return {
    eligible: true,
    plan: {
      outputPath: toNativePath(input.outputPath),
      width: input.width,
      height: input.height,
      frameRate: input.frameRate,
      codec: input.codec,
      preset: input.preset,
      crf: input.crf,
      pixelFormat: input.pixelFormat,
      totalDuration: endTime - startTime,
      clips,
    },
  };
}

export async function runNativeTimelineExport(
  plan: NativeTimelineExportPlan,
  callbacks: NativeTimelineRunCallbacks,
): Promise<NativeTimelineRunResult> {
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  let completedFrames = 0;
  let cancelled = false;
  const progressChannel = new Channel<{
    currentFrame: number;
    totalFrames: number;
    progress: number;
    etaSeconds: number;
    fps: number;
  }>();
  progressChannel.onmessage = (progress) => {
    completedFrames = progress.currentFrame;
    callbacks.onProgress?.(progress);
  };

  const sessionId = await invoke<string>("start_native_timeline_export", {
    plan,
    onProgress: progressChannel,
  });
  callbacks.onSessionReady?.(async () => {
    cancelled = true;
    await invoke("cancel_native_timeline_export", { sessionId }).catch(() => {});
  });

  try {
    const completion = await invoke<{
      totalFrames: number;
      totalTimeMs: number;
      peakRssBytes: number;
    }>("finalize_native_timeline_export", { sessionId });
    return {
      completedFrames: completion.totalFrames,
      totalTimeMs: completion.totalTimeMs,
      cancelled: false,
      peakRssBytes: completion.peakRssBytes,
    };
  } catch (error) {
    if (cancelled) {
      return {
        completedFrames,
        totalTimeMs: 0,
        cancelled: true,
        peakRssBytes: 0,
      };
    }
    throw error;
  }
}
